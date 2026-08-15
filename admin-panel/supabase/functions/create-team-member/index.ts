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
  const { businessId, admin } = auth

  let body: { email?: string; password?: string; full_name?: string; gender?: string; phone?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { email, password, full_name, gender, phone } = body
  if (!email || !password || !full_name || !phone) {
    return json({ error: 'email, password, full_name ve phone zorunlu' }, 400)
  }
  if (password.length < 6) {
    return json({ error: 'Şifre en az 6 karakter olmalı' }, 400)
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

  const { data: business, error: bizErr } = await admin
    .from('businesses')
    .select('max_users')
    .eq('id', businessId)
    .maybeSingle()

  if (bizErr || !business) return json({ error: 'İşletme bulunamadı' }, 404)

  const { count, error: countErr } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
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
    business_id: businessId,
    role: 'user',
    full_name,
    is_active: true,
    gender: gender ?? null,
    whatsapp_phone: phoneDigits,
  })

  if (insertErr) {
    // Profil eklenemediyse yetim auth kullanıcısı kalmasın
    console.error('create-team-member profile insert error:', insertErr.message)
    await admin.auth.admin.deleteUser(created.user.id)
    const isDupPhone = insertErr.code === '23505' && insertErr.message.includes('whatsapp_phone')
    return json({ error: isDupPhone ? 'Bu telefon numarası başka bir çalışana kayıtlı' : 'Profil oluşturulamadı' }, 500)
  }

  return json(
    { data: { id: created.user.id, email, full_name, role: 'user', gender: gender ?? null, phone: phoneDigits } },
    200,
  )
})
