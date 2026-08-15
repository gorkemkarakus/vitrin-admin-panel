import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'

// "Bağlantıyı Kaldır" — şifrelenmiş token dahil bağlantı satırını ve
// önbelleklenmiş tüm insight snapshot'larını siler. Meta tarafında token'ı
// iptal etmiyoruz (kullanıcı Meta hesabından da erişimi geri alabilir);
// burada sadece bizim tarafımızdaki kopyayı temizliyoruz.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  const { error: snapErr } = await admin.from('ad_insight_snapshots').delete().eq('business_id', businessId)
  if (snapErr) console.error('disconnect-ad-account: snapshot silme hatası', snapErr.message)

  const { error: connErr } = await admin.from('business_ad_connections').delete().eq('business_id', businessId)
  if (connErr) {
    console.error('disconnect-ad-account: bağlantı silinemedi', connErr.message)
    return json({ error: 'Bağlantı kaldırılamadı' }, 500)
  }

  return json({ data: { ok: true } }, 200)
})
