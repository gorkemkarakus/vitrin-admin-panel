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

  let body: { email?: string; password?: string; full_name?: string; gender?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { email, password, full_name, gender } = body
  if (!email || !password || !full_name) {
    return json({ error: 'email, password ve full_name zorunlu' }, 400)
  }
  if (password.length < 6) {
    return json({ error: 'Şifre en az 6 karakter olmalı' }, 400)
  }
  // gender opsiyonel — calisan bunu belirtmek istemeyebilir (ör. kurulumu
  // yoneticinin yaptigi durumlarda), boyle bir durumda NULL kalir ve chatbot
  // eski (tahmine dayali, "kesin bilmiyorum" uyarili) davranisina duser.
  if (gender !== undefined && gender !== null && gender !== 'kadin' && gender !== 'erkek') {
    return json({ error: "gender 'kadin' veya 'erkek' olmalı" }, 400)
  }

  const { data: business, error: bizErr } = await admin
    .from('businesses')
    .select('max_users')
    .eq('id', callerProfile.business_id)
    .maybeSingle()

  if (bizErr || !business) return json({ error: 'İşletme bulunamadı' }, 404)

  const { count, error: countErr } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', callerProfile.business_id)
    .eq('role', 'user')
    .eq('is_active', true)

  if (countErr) return json({ error: 'Kullanıcı sayısı hesaplanamadı' }, 500)

  if ((count ?? 0) >= business.max_users) {
    return json(
      {
        error: `Kullanıcı limiti doldu (${count}/${business.max_users}). Yeni hesap açmak için önce bir hesabı pasife alın.`,
      },
      403,
    )
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createErr || !created.user) {
    // Ham GoTrue hatasi (ör. "User already registered") dogrudan donmuyor —
    // auth.users proje genelinde benzersiz oldugu icin bu, cagiran isletme
    // disindaki bir e-postanin platformda kayitli olup olmadigini sizdiran
    // bir enumeration sinyali olurdu.
    console.error('create-team-member user create error:', createErr?.message)
    return json({ error: 'Kullanıcı oluşturulamadı (e-posta zaten kullanılıyor olabilir)' }, 400)
  }

  const { error: insertErr } = await admin.from('profiles').insert({
    id: created.user.id,
    business_id: callerProfile.business_id,
    role: 'user',
    full_name,
    is_active: true,
    gender: gender ?? null,
  })

  if (insertErr) {
    // Profil eklenemediyse yetim auth kullanıcısı kalmasın
    console.error('create-team-member profile insert error:', insertErr.message)
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: 'Profil oluşturulamadı' }, 500)
  }

  return json({ data: { id: created.user.id, email, full_name, role: 'user', gender: gender ?? null } }, 200)
})
