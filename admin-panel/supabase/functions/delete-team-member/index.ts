import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Yetkilendirme başlığı eksik' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Çağıranın kimliğini kendi JWT'siyle doğrula (RLS'e tabi, düşük yetkili client)
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'Geçersiz oturum' }, 401)

  // Buradan sonrası service_role ile — RLS'i bilerek atlıyoruz (admin işlemi)
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: callerProfile, error: profileErr } = await admin
    .from('profiles')
    .select('business_id, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileErr || !callerProfile || !callerProfile.is_active || callerProfile.role !== 'admin') {
    return json({ error: 'Bu işlemi sadece işletme yöneticisi yapabilir' }, 403)
  }

  let body: { id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const targetId = body.id
  if (!targetId) return json({ error: 'id zorunlu' }, 400)
  if (targetId === userData.user.id) return json({ error: 'Kendi hesabınızı silemezsiniz' }, 400)

  const { data: targetProfile, error: targetErr } = await admin
    .from('profiles')
    .select('business_id, role')
    .eq('id', targetId)
    .maybeSingle()

  if (targetErr || !targetProfile) return json({ error: 'Çalışan bulunamadı' }, 404)
  if (targetProfile.business_id !== callerProfile.business_id) {
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
