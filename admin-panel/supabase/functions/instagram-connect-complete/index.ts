import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { encryptToken, sha256Hex } from '../_shared/crypto.ts'
import { exchangeCode, getAccount, instagramRedirectUri, subscribeMessages } from '../_shared/instagram.ts'

// Sitedeki /instagram-baglan sayfasi cagirir: Instagram'in dondurdugu kodu
// (state = tek kullanimlik oturum) salona ozel 60 gunluk anahtara cevirir,
// hesabin DM'lerini webhook'a baglar ve baglantiyi kaydeder. Kimlik JWT degil
// oturum kodudur (sayfa salonun girisini tasimaz).

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const encKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!encKey || !Deno.env.get('INSTAGRAM_APP_SECRET')) {
    console.error('instagram-connect-complete: TOKEN_ENCRYPTION_KEY ya da INSTAGRAM_APP_SECRET eksik')
    return json({ error: 'Instagram bağlantısı henüz açılmadı' }, 503)
  }

  const body = await req.json().catch(() => null)
  const session = typeof body?.session === 'string' ? body.session : ''
  const code = typeof body?.code === 'string' ? body.code : ''
  if (!/^[0-9a-f]{64}$/.test(session) || !code) return json({ error: 'Eksik bilgi' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Oturum tek seferde ve atomik olarak kullanilir.
  const { data: sess } = await admin
    .from('instagram_connect_sessions')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', await sha256Hex(session))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('business_id, user_id, return_to')
    .maybeSingle()
  if (!sess) return json({ error: 'Bağlantının süresi doldu. Uygulamadan "Instagram\'ı bağla"ya yeniden basın.' }, 410)

  const exchanged = await exchangeCode(code, instagramRedirectUri())
  if (!exchanged.ok) {
    console.error('instagram-connect-complete: kod takas edilemedi', exchanged.error)
    return json({ error: 'Instagram bağlantısı tamamlanamadı, lütfen yeniden deneyin', return_to: sess.return_to }, 502)
  }
  const { accessToken, expiresAt } = exchanged.data

  const account = await getAccount(accessToken)
  if (!account.ok || !account.data.user_id) {
    console.error('instagram-connect-complete: hesap bilgisi alınamadı', account.ok ? 'user_id yok' : account.error)
    return json({ error: 'Instagram hesap bilgisi alınamadı, lütfen yeniden deneyin', return_to: sess.return_to }, 502)
  }
  const igUserId = String(account.data.user_id)

  // Ayni hesap baska bir salona bagliysa ikinci kez baglanamaz.
  const { data: other } = await admin
    .from('business_instagram_connections')
    .select('business_id')
    .eq('ig_user_id', igUserId)
    .neq('business_id', sess.business_id)
    .maybeSingle()
  if (other) return json({ error: 'Bu Instagram hesabı başka bir işletmeye bağlı', return_to: sess.return_to }, 409)

  const sub = await subscribeMessages(accessToken)
  if (!sub.ok) {
    console.error('instagram-connect-complete: mesaj aboneliği açılamadı', sub.error)
    return json({ error: 'Instagram mesaj bildirimleri açılamadı, lütfen yeniden deneyin', return_to: sess.return_to }, 502)
  }

  const { error: upErr } = await admin.from('business_instagram_connections').upsert(
    {
      business_id: sess.business_id,
      ig_user_id: igUserId,
      username: account.data.username ?? null,
      encrypted_access_token: await encryptToken(accessToken, encKey),
      token_expires_at: expiresAt,
      connected_by: sess.user_id,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'business_id' },
  )
  if (upErr) {
    console.error('instagram-connect-complete: bağlantı kaydedilemedi', upErr.message)
    return json({ error: 'Bağlantı kaydedilemedi, lütfen yeniden deneyin', return_to: sess.return_to }, 500)
  }

  console.log('instagram-connect-complete: bağlandı', { business_id: sess.business_id })
  return json({ data: { username: account.data.username ?? null, return_to: sess.return_to } }, 200)
})
