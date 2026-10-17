import { corsHeaders, json } from '../_shared/http.ts'
import { requireOperator } from '../_shared/operatorAuth.ts'

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireOperator(req)
  if (!auth.ok) return auth.response
  const { admin } = auth

  let body: { action?: string; name?: string; admin_email?: string; admin_full_name?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  // Yeni isletme + ilk yonetici hesabini tek adimda olusturur. Oncesinde
  // her yeni beta isletmesi icin elle migration/SQL yazmak gerekiyordu —
  // artik operator panelinden yapiliyor. Ilk sifre burada rastgele
  // uretilip DONDURULUYOR (operator isletme sahibine iletir); isletme
  // sahibi kendi "Sifremi unuttum" akisiyla istedigi zaman degistirebilir.
  if (body.action === 'create') {
    const name = (body.name ?? '').trim()
    const adminEmail = (body.admin_email ?? '').trim().toLowerCase()
    const adminFullName = (body.admin_full_name ?? '').trim()

    if (!name || !adminEmail || !adminFullName) {
      return json({ error: 'İşletme adı, yönetici e-postası ve yönetici adı zorunlu' }, 400)
    }

    const { data: newBusiness, error: bizErr } = await admin
      .from('businesses')
      .insert({ name, signup_source: 'operator' })
      .select('id, name, slug')
      .single()
    if (bizErr || !newBusiness) {
      console.error('operator-businesses create error:', bizErr?.message)
      return json({ error: 'İşletme oluşturulamadı' }, 500)
    }

    const tempPassword = randomPassword()
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      password: tempPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) {
      // Yetim isletme kalmasin diye geri al. Ham GoTrue hatasi (ör. "User
      // already registered") dogrudan donmuyor — bu, auth.users tablosunun
      // proje genelinde benzersiz oldugu icin platform disindaki bir
      // e-postanin kayitli olup olmadigini sizdirabilecek bir enumeration
      // sinyali olurdu.
      console.error('operator-businesses admin user create error:', userErr?.message)
      await admin.from('businesses').delete().eq('id', newBusiness.id)
      return json({ error: 'Yönetici hesabı oluşturulamadı (e-posta zaten kullanılıyor olabilir)' }, 500)
    }

    const { error: profileErr } = await admin.from('profiles').insert({
      id: userData.user.id,
      business_id: newBusiness.id,
      role: 'admin',
      full_name: adminFullName,
    })
    if (profileErr) {
      console.error('operator-businesses profile insert error:', profileErr.message)
      await admin.auth.admin.deleteUser(userData.user.id)
      await admin.from('businesses').delete().eq('id', newBusiness.id)
      return json({ error: 'Yönetici profili oluşturulamadı' }, 500)
    }

    return json(
      {
        business: newBusiness,
        admin_email: adminEmail,
        temp_password: tempPassword,
      },
      200,
    )
  }

  // select('*') DEGIL — businesses.api_key_hash gibi hassas kolonlar bu
  // panelin ihtiyaci olmayan bir sekilde client'a sizmasin.
  const { data: businesses } = await admin
    .from('businesses')
    .select('id, name, slug, created_at')
    .order('name')

  return json({ businesses: businesses ?? [] }, 200)
})
