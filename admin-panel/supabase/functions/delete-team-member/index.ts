import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { userId, businessId, admin } = auth

  let body: { id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const targetId = body.id
  if (!targetId) return json({ error: 'id zorunlu' }, 400)
  if (targetId === userId) return json({ error: 'Kendi hesabınızı silemezsiniz' }, 400)

  const { data: targetProfile, error: targetErr } = await admin
    .from('profiles')
    .select('business_id, role')
    .eq('id', targetId)
    .maybeSingle()

  if (targetErr || !targetProfile) return json({ error: 'Çalışan bulunamadı' }, 404)
  if (targetProfile.business_id !== businessId) {
    return json({ error: 'Bu çalışan işletmenize ait değil' }, 403)
  }
  if (targetProfile.role === 'admin') {
    return json({ error: 'Yönetici hesapları silinemez' }, 400)
  }

  // profiles.id -> auth.users(id) ON DELETE CASCADE: kullanicinin auth
  // hesabini silmek profiles satirini (ve employee_services/schedules/
  // time_blocks/commission_rates gibi ona bagli her seyi) otomatik temizler.
  // appointments.employee_id ON DELETE SET NULL oldugu icin gecmis
  // randevular silinmez, sadece calisan baglantisi bosa duser.
  const { error: deleteErr } = await admin.auth.admin.deleteUser(targetId)
  if (deleteErr) {
    console.error('delete-team-member error:', deleteErr.message)
    return json({ error: 'Çalışan silinemedi' }, 500)
  }

  return json({ data: { id: targetId } }, 200)
})
