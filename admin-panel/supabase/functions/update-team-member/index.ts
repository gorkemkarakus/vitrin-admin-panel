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

  let body: { id?: string; email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { id, email, password } = body
  if (!id) return json({ error: 'id zorunlu' }, 400)
  if (!email && !password) return json({ error: 'Güncellenecek e-posta veya şifre girin' }, 400)
  if (password && password.length < 6) return json({ error: 'Şifre en az 6 karakter olmalı' }, 400)

  // Hedef calisanin cagiranla AYNI isletmeye ait oldugunu dogrula — baska
  // isletmenin hesabini degistirmeyi engeller.
  const { data: targetProfile, error: targetErr } = await admin
    .from('profiles')
    .select('business_id')
    .eq('id', id)
    .maybeSingle()

  if (targetErr || !targetProfile || targetProfile.business_id !== callerProfile.business_id) {
    return json({ error: 'Çalışan bulunamadı' }, 404)
  }

  const updates: { email?: string; password?: string } = {}
  if (email) updates.email = email
  if (password) updates.password = password

  const { error: updateErr } = await admin.auth.admin.updateUserById(id, updates)

  if (updateErr) {
    console.error('update-team-member error:', updateErr.message)
    const msg = updateErr.message.toLowerCase()
    const isDupEmail = msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists')
    return json({ error: isDupEmail ? 'Bu e-posta zaten kullanılıyor' : 'Hesap güncellenemedi' }, 400)
  }

  return json({ data: { id } }, 200)
})
