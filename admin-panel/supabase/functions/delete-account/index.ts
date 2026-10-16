import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'

// Kullanicinin KENDI hesabini silmesi (App Store 5.1.1(v) / Google Play
// hesap silme zorunlulugu). Uc durum:
//   - Calisan (role 'user') ya da baska yoneticisi olan bir yonetici:
//     yalnizca kendi auth hesabi silinir (profiles ve ona bagli saat/izin/
//     yetki satirlari CASCADE; gecmis randevular employee_id=NULL ile kalir).
//   - Isletmenin TEK yoneticisi: hesapla birlikte isletme ve tum verisi
//     silinir (musteriler, randevular, odemeler, calisan hesaplari). Bunun
//     icin istekte isletme adi birebir yazilmis olmali (confirm_business_name).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Yetkilendirme başlığı eksik' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Kimlik once cagiranin kendi JWT'siyle dogrulanir.
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'Geçersiz oturum' }, 401)
  const userId = userData.user.id

  let body: { confirm_business_name?: string; dry_run?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    // Govdesiz istek: sadece durum sorgusu gibi davranilir (dry_run).
    body = { dry_run: true }
  }

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: profile } = await admin.from('profiles').select('business_id, role').eq('id', userId).maybeSingle()

  // Profili olmayan (yarim kalmis) hesap: dogrudan silinir.
  if (!profile) {
    if (body.dry_run) return json({ data: { scope: 'account' } }, 200)
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return json({ error: 'Hesap silinemedi' }, 500)
    return json({ data: { scope: 'account' } }, 200)
  }

  let soleAdmin = false
  let businessName = ''
  if (profile.role === 'admin') {
    const [{ count: otherAdmins }, { data: biz }] = await Promise.all([
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', profile.business_id)
        .eq('role', 'admin')
        .eq('is_active', true)
        .neq('id', userId),
      admin.from('businesses').select('name').eq('id', profile.business_id).maybeSingle(),
    ])
    soleAdmin = (otherAdmins ?? 0) === 0
    businessName = biz?.name ?? ''
  }

  // Istemci once hangi kapsamda silinecegini sorar (onay ekranini dogru gostermek icin).
  if (body.dry_run) {
    return json({ data: { scope: soleAdmin ? 'business' : 'account', business_name: soleAdmin ? businessName : null } }, 200)
  }

  if (!soleAdmin) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) {
      console.error('delete-account user error:', error.message)
      return json({ error: 'Hesap silinemedi' }, 500)
    }
    return json({ data: { scope: 'account' } }, 200)
  }

  // Tek yonetici: isletme ve tum verisi.
  if ((body.confirm_business_name ?? '').trim().toLocaleLowerCase('tr') !== businessName.trim().toLocaleLowerCase('tr')) {
    return json({ error: 'Onay için işletme adını aynen yazın' }, 400)
  }
  const { data: members } = await admin.from('profiles').select('id').eq('business_id', profile.business_id)
  // Once diger calisanlarin giris hesaplari (profil satirlari CASCADE),
  // en son yoneticinin kendisi; ardindan isletme (geri kalan her sey CASCADE).
  for (const m of (members ?? []).filter((x) => x.id !== userId)) {
    const { error } = await admin.auth.admin.deleteUser(m.id)
    if (error) console.error('delete-account member error:', m.id, error.message)
  }
  const { error: selfErr } = await admin.auth.admin.deleteUser(userId)
  if (selfErr) {
    console.error('delete-account self error:', selfErr.message)
    return json({ error: 'Hesap silinemedi' }, 500)
  }
  const { error: bizErr } = await admin.from('businesses').delete().eq('id', profile.business_id)
  if (bizErr) console.error('delete-account business error:', bizErr.message)

  return json({ data: { scope: 'business' } }, 200)
})
