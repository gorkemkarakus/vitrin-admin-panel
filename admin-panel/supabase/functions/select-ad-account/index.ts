import { corsHeaders, json } from '../_shared/http.ts'
import { requireFeature } from '../_shared/plan.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { listAdAccounts } from '../_shared/metaAds.ts'

// meta-oauth-callback'ten dönen reklam hesabı listesinden işletme sahibinin
// seçtiğini kalıcı bağlantı olarak işaretler.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { userId, businessId, admin } = auth
  const planBlocked = await requireFeature(admin, businessId, 'ads')
  if (planBlocked) return planBlocked

  let body: { ad_account_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { ad_account_id } = body
  if (!ad_account_id) {
    return json({ error: 'ad_account_id zorunlu' }, 400)
  }

  const { data: pending, error: fetchErr } = await admin
    .from('business_ad_connections')
    .select('status, encrypted_access_token')
    .eq('business_id', businessId)
    .maybeSingle()

  if (fetchErr || !pending || pending.status !== 'pending' || !pending.encrypted_access_token) {
    return json({ error: 'Önce "Facebook ile Bağlan" ile bir hesap doğrulaması yapılmalı' }, 409)
  }

  const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!encryptionKey) {
    console.error('select-ad-account: TOKEN_ENCRYPTION_KEY eksik')
    return json({ error: 'Sunucu yapılandırması eksik' }, 500)
  }

  // Client'in gonderdigi ad_account_id/name'e KORKORUNE guvenilmez — Meta'ya
  // ayni token'la TEKRAR sorulup secilen hesabin gercekten bu token'in
  // erisebildigi hesaplardan biri oldugu dogrulanir, isim de Meta'nin kendi
  // cevabindan alinir (client'in gonderdigi isim asla kaydedilmez). Bu,
  // (kendi isletmesini etkileyecek olsa da) rastgele bir ad_account_id
  // enjekte edilmesini engeller.
  const accessToken = await decryptToken(pending.encrypted_access_token, encryptionKey)
  const accounts = await listAdAccounts(accessToken)
  if (!accounts.ok) return json({ error: accounts.error }, accounts.status)

  const matchedAccount = accounts.data.find((a) => a.id === ad_account_id)
  if (!matchedAccount) {
    return json({ error: 'Seçilen reklam hesabı bu bağlantıda bulunamadı' }, 400)
  }

  const { error: updateErr } = await admin
    .from('business_ad_connections')
    .update({
      ad_account_id: matchedAccount.id,
      ad_account_name: matchedAccount.name,
      status: 'connected',
      connected_by: userId,
      connected_at: new Date().toISOString(),
    })
    .eq('business_id', businessId)

  if (updateErr) {
    console.error('select-ad-account: güncellenemedi', updateErr.message)
    return json({ error: 'Reklam hesabı bağlanamadı' }, 500)
  }

  return json({ data: { ok: true } }, 200)
})
