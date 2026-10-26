import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { instagramConnection, unsubscribeMessages } from '../_shared/instagram.ts'

// "Bağlantıyı kaldır": asistan bu Instagram hesabina gelen DM'lere artik
// cevap vermez. Instagram'daki abonelik kapatilir (basarisiz olursa yine de
// bizim taraf temizlenir); hesap Instagram'da oldugu gibi calismaya devam eder.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  const conn = await instagramConnection(admin, { businessId })
  if (conn) {
    const res = await unsubscribeMessages(conn.token)
    if (!res.ok) console.error('instagram-disconnect: abonelik kapatılamadı', res.error)
  }

  const { error: delErr } = await admin.from('business_instagram_connections').delete().eq('business_id', businessId)
  if (delErr) {
    console.error('instagram-disconnect: bağlantı silinemedi', delErr.message)
    return json({ error: 'Bağlantı kaldırılamadı' }, 500)
  }
  return json({ data: { ok: true } }, 200)
})
