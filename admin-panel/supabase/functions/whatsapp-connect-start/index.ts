import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { sha256Hex } from '../_shared/crypto.ts'

// "WhatsApp'ı bağla": salon sahibi icin tek kullanimlik baglama oturumu acar
// ve sitedeki baglama sayfasinin adresini doner. Meta'nin baglama penceresi
// yalnizca kayitli https alan adinda calisir (uygulamanin kendi ekraninda
// degil); sayfa salonun oturum anahtarini tasimaz, yalniz bu kodu tasir.
const SESSION_MINUTES = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, userId, admin } = auth

  const body = await req.json().catch(() => ({}))
  // app: sayfa bitince uygulamaya derin baglantiyla doner; web: sekmede kalir
  const returnTo = body?.return === 'app' ? 'app' : 'web'

  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

  // eski oturumlar temizlenir (kullanilmis ya da suresi gecmis)
  await admin.from('whatsapp_connect_sessions').delete().lt('expires_at', new Date().toISOString())

  const { error } = await admin.from('whatsapp_connect_sessions').insert({
    token_hash: await sha256Hex(token),
    business_id: businessId,
    user_id: userId,
    expires_at: new Date(Date.now() + SESSION_MINUTES * 60000).toISOString(),
  })
  if (error) {
    console.error('whatsapp-connect-start: oturum açılamadı', error.message)
    return json({ error: 'Bağlantı başlatılamadı, tekrar deneyin' }, 500)
  }

  const site = (Deno.env.get('PUBLIC_SITE_URL') ?? 'https://www.adapptivdigital.com').replace(/\/$/, '')
  return json({ data: { url: `${site}/whatsapp-baglan/?s=${token}&r=${returnTo}` } }, 200)
})
