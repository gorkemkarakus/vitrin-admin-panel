import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { sha256Hex } from '../_shared/crypto.ts'
import { authorizeUrl, instagramRedirectUri } from '../_shared/instagram.ts'

// "Instagram'ı bağla": salon sahibi icin tek kullanimlik baglama oturumu acar
// ve Instagram'in giris penceresinin adresini doner. Instagram girisi bitince
// sitedeki /instagram-baglan sayfasina (?code&state) doner; sayfa kodu bu
// oturumla instagram-connect-complete'e iletir.
const SESSION_MINUTES = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!Deno.env.get('INSTAGRAM_APP_ID')) {
    console.error('instagram-connect-start: INSTAGRAM_APP_ID eksik')
    return json({ error: 'Instagram bağlantısı henüz açılmadı' }, 503)
  }

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, userId, admin } = auth

  const body = await req.json().catch(() => ({}))
  const returnTo = body?.return === 'app' ? 'app' : 'web'

  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

  await admin.from('instagram_connect_sessions').delete().lt('expires_at', new Date().toISOString())

  const { error } = await admin.from('instagram_connect_sessions').insert({
    token_hash: await sha256Hex(token),
    business_id: businessId,
    user_id: userId,
    return_to: returnTo,
    expires_at: new Date(Date.now() + SESSION_MINUTES * 60000).toISOString(),
  })
  if (error) {
    console.error('instagram-connect-start: oturum açılamadı', error.message)
    return json({ error: 'Bağlantı başlatılamadı, tekrar deneyin' }, 500)
  }

  // state = oturum kodu; Instagram donuste aynen geri verir
  return json({ data: { url: authorizeUrl(instagramRedirectUri(), token) } }, 200)
})
