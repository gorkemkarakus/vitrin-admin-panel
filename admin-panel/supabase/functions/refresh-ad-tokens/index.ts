import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { decryptToken, encryptToken, timingSafeEqualString } from '../_shared/crypto.ts'
import { exchangeForLongLivedToken } from '../_shared/metaAds.ts'

// pg_cron tarafından günlük çağrılır (bkz. 20260810000001_ad_insights.sql).
// Süresi 7 gün içinde dolacak Meta token'larını, HÂLÂ GEÇERLİ olan token'ı
// tekrar fb_exchange_token ile değiştirerek yeniler (Meta'nın ayrı bir
// "refresh endpoint"i yok — bu resmi olarak dokümante edilen yöntem).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const webhookSecret = Deno.env.get('META_ADS_WEBHOOK_SECRET')
  const provided = req.headers.get('x-webhook-secret')
  if (!webhookSecret || !provided || !timingSafeEqualString(provided, webhookSecret)) {
    return json({ error: 'Yetkisiz' }, 401)
  }

  const appId = Deno.env.get('META_APP_ID')
  const appSecret = Deno.env.get('META_APP_SECRET')
  const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!appId || !appSecret || !encryptionKey) {
    console.error('refresh-ad-tokens: eksik ortam değişkeni')
    return json({ error: 'Sunucu yapılandırması eksik' }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const soon = new Date(Date.now() + 7 * 86400000).toISOString()
  const { data: connections } = await admin
    .from('business_ad_connections')
    .select('business_id, encrypted_access_token')
    .eq('status', 'connected')
    .lt('token_expires_at', soon)

  let refreshed = 0
  let failed = 0
  for (const conn of connections ?? []) {
    if (!conn.encrypted_access_token) continue
    try {
      const currentToken = await decryptToken(conn.encrypted_access_token, encryptionKey)
      const renewed = await exchangeForLongLivedToken(appId, appSecret, currentToken)
      if (!renewed.ok) {
        await admin
          .from('business_ad_connections')
          .update({ status: 'error', last_error: renewed.error })
          .eq('business_id', conn.business_id)
        failed++
        continue
      }
      const encrypted = await encryptToken(renewed.data.accessToken, encryptionKey)
      const expiresAt = renewed.data.expiresInSeconds
        ? new Date(Date.now() + renewed.data.expiresInSeconds * 1000).toISOString()
        : null
      await admin
        .from('business_ad_connections')
        .update({ encrypted_access_token: encrypted, token_expires_at: expiresAt, last_error: null })
        .eq('business_id', conn.business_id)
      refreshed++
    } catch (err) {
      console.error('refresh-ad-tokens: işletme için beklenmeyen hata', conn.business_id, err)
      await admin
        .from('business_ad_connections')
        .update({ status: 'error', last_error: 'Token yenilenirken beklenmeyen hata' })
        .eq('business_id', conn.business_id)
      failed++
    }
  }

  return json({ ok: true, refreshed, failed }, 200)
})
