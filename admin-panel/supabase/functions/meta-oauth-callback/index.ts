import { corsHeaders, json } from '../_shared/http.ts'
import { requireFeature } from '../_shared/plan.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { encryptToken } from '../_shared/crypto.ts'
import { exchangeCodeForToken, exchangeForLongLivedToken, listAdAccounts } from '../_shared/metaAds.ts'

// Facebook Login for Business akışının ilk adımı: tarayıcı/uygulama Meta'dan
// dönen 'code'u buraya POST eder. Ham token İSTEMCİYE ASLA dönmez — sadece
// şifrelenmiş biçimde saklanır, client'a sadece seçilebilecek reklam hesabı
// listesi döner. client_secret de sadece burada, service_role tarafında
// kullanılır.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth
  const planBlocked = await requireFeature(admin, businessId, 'ads')
  if (planBlocked) return planBlocked

  let body: { code?: string; redirect_uri?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { code, redirect_uri } = body
  if (!code || !redirect_uri) {
    return json({ error: 'code ve redirect_uri zorunlu' }, 400)
  }

  const appId = Deno.env.get('META_APP_ID')
  const appSecret = Deno.env.get('META_APP_SECRET')
  const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!appId || !appSecret || !encryptionKey) {
    console.error('meta-oauth-callback: eksik ortam değişkeni (META_APP_ID/META_APP_SECRET/TOKEN_ENCRYPTION_KEY)')
    return json({ error: 'Sunucu yapılandırması eksik' }, 500)
  }

  const shortLived = await exchangeCodeForToken(appId, appSecret, code, redirect_uri)
  if (!shortLived.ok) return json({ error: shortLived.error }, shortLived.status)

  const longLived = await exchangeForLongLivedToken(appId, appSecret, shortLived.data.accessToken)
  if (!longLived.ok) return json({ error: longLived.error }, longLived.status)

  const accounts = await listAdAccounts(longLived.data.accessToken)
  if (!accounts.ok) return json({ error: accounts.error }, accounts.status)

  if (accounts.data.length === 0) {
    return json({ error: 'Bu Facebook hesabına bağlı hiç reklam hesabı bulunamadı' }, 404)
  }

  const encryptedToken = await encryptToken(longLived.data.accessToken, encryptionKey)
  const expiresAt = longLived.data.expiresInSeconds
    ? new Date(Date.now() + longLived.data.expiresInSeconds * 1000).toISOString()
    : null

  // status='pending' — kullanıcı henüz hangi reklam hesabını bağlayacağını
  // seçmedi. select-ad-account bunu 'connected'a çevirecek.
  const { error: upsertErr } = await admin.from('business_ad_connections').upsert({
    business_id: businessId,
    provider: 'meta',
    status: 'pending',
    ad_account_id: null,
    ad_account_name: null,
    encrypted_access_token: encryptedToken,
    token_expires_at: expiresAt,
    last_error: null,
  })
  if (upsertErr) {
    console.error('meta-oauth-callback: bağlantı kaydedilemedi', upsertErr.message)
    return json({ error: 'Bağlantı kaydedilemedi' }, 500)
  }

  return json({ data: { ad_accounts: accounts.data.map((a) => ({ id: a.id, name: a.name })) } }, 200)
})
