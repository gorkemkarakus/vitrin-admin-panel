import { corsHeaders, json } from '../_shared/http.ts'
import { planLimit, planLimitResponse, requireFeature } from '../_shared/plan.ts'
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
  const { businessId, admin } = auth

  let body: {
    email?: string
    password?: string
    full_name?: string
    gender?: string
    phone?: string
    // Hazir rol: 'user' (varsayilan) ya da 'admin' (Yonetici).
    role?: string
    // Ilk giriste kendi sifresini belirlesin.
    must_change_password?: boolean
    // Online randevu sayfasinda secilebilsin.
    online_bookable?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { email, password, full_name, gender, phone } = body
  const role = body.role === 'admin' ? 'admin' : 'user'
  if (!email || !password || !full_name || !phone) {
    return json({ error: 'email, password, full_name ve phone zorunlu' }, 400)
  }
  if (password.length < 8) {
    return json({ error: 'Şifre en az 8 karakter olmalı' }, 400)
  }
  const phoneDigits = phone.replace(/\D/g, '')
  if (phoneDigits.length < 10) {
    return json({ error: 'Geçerli bir telefon numarası girin' }, 400)
  }
  // gender opsiyonel — calisan bunu belirtmek istemeyebilir (ör. kurulumu
  // yoneticinin yaptigi durumlarda), boyle bir durumda NULL kalir ve chatbot
  // eski (tahmine dayali, "kesin bilmiyorum" uyarili) davranisina duser.
  if (gender !== undefined && gender !== null && gender !== 'kadin' && gender !== 'erkek') {
    return json({ error: "gender 'kadin' veya 'erkek' olmalı" }, 400)
  }

  // Paket: calisan ekleme ozelligi ve toplam kullanici siniri (sahip dahil).
  // Veritabani tetikleyicisi de ayni siniri uygular; burada kullaniciya
  // anlasilir mesaj icin once kontrol edilir.
  const planBlocked = await requireFeature(admin, businessId, 'staff')
  if (planBlocked) return planBlocked
  const maxUsers = await planLimit(admin, businessId, 'max_users')

  const { count, error: countErr } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('is_active', true)

  if (countErr) return json({ error: 'Kullanıcı sayısı hesaplanamadı' }, 500)

  // Sinir isletme sahibi DAHIL tum aktif hesaplari sayar (paketteki
  // "kullanici" sayisi). null = sinirsiz.
  const usedSeats = count ?? 0
  if (maxUsers !== null && usedSeats >= maxUsers) {
    return json(
      {
        error: `Paketinizdeki kullanıcı sınırı doldu (${usedSeats}/${maxUsers}). Paketinizi yükseltebilir ya da bir hesabı pasife alabilirsiniz.`,
        code: 'PLAN_LIMIT',
        limit: 'max_users',
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
    business_id: businessId,
    role,
    full_name,
    is_active: true,
    gender: gender ?? null,
    whatsapp_phone: phoneDigits,
    must_change_password: body.must_change_password === true,
    online_bookable: body.online_bookable !== false,
  })

  if (insertErr) {
    // Profil eklenemediyse yetim auth kullanıcısı kalmasın
    console.error('create-team-member profile insert error:', insertErr.message)
    await admin.auth.admin.deleteUser(created.user.id)
    const planErr = planLimitResponse(insertErr)
    if (planErr) {
      await admin.auth.admin.deleteUser(created.user.id)
      return planErr
    }
    const isDupPhone = insertErr.code === '23505' && insertErr.message.includes('whatsapp_phone')
    return json({ error: isDupPhone ? 'Bu telefon numarası başka bir çalışana kayıtlı' : 'Profil oluşturulamadı' }, 500)
  }

  return json(
    { data: { id: created.user.id, email, full_name, role, gender: gender ?? null, phone: phoneDigits } },
    200,
  )
})
