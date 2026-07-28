import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { json } from './http.ts'

// Operator-* fonksiyonlarinin HEPSI icin ortak, atlanmasi imkansiz kapi.
// Deseni create-team-member/index.ts'ten birebir aliyor: once ANON-key
// client + forward edilen Authorization header ile getUser() cagrilip
// caller'in kimligi KRIPTOGRAFIK olarak dogrulanir (bu adim service_role
// ile ATLANAMAZ — service_role hicbir JWT'yi dogrulamadan kabul eder).
// Ancak SONRA service_role client'a gecilip platform_admins kontrolu yapilir.
//
// platform_admins RLS'i acik ve HICBIR client policy yok — yani sadece
// service_role bu tabloyu okuyabilir, asagidaki kontrol atlanirsa (ör. bu
// fonksiyon cagrilmazsa) hicbir yol bu tabloyu dogrudan client'tan okuyamaz.
export async function requireOperator(
  req: Request,
): Promise<{ ok: true; userId: string; admin: SupabaseClient } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { ok: false, response: json({ error: 'Yetkilendirme başlığı eksik' }, 401) }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !userData.user) return { ok: false, response: json({ error: 'Geçersiz oturum' }, 401) }

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: adminRow } = await admin.from('platform_admins').select('id').eq('id', userData.user.id).maybeSingle()
  if (!adminRow) return { ok: false, response: json({ error: 'Bu panele erişim yetkiniz yok' }, 403) }

  return { ok: true, userId: userData.user.id, admin }
}

// business_id'nin gercekten var oldugunu dogrular — typo'lu/olmayan bir id
// sessizce bos sonuc donmesin, acikca 404 versin.
export async function requireBusiness(admin: SupabaseClient, businessId: string) {
  const { data } = await admin.from('businesses').select('id').eq('id', businessId).maybeSingle()
  return Boolean(data)
}

// employee_categories/employee_schedules/employee_time_blocks tablolarinin
// dogrudan business_id kolonu yok — bir profile_id'nin GERCEKTEN talep
// edilen business_id'ye ait oldugunu yazmadan ONCE dogrular.
export async function verifyProfileBelongsToBusiness(admin: SupabaseClient, profileId: string, businessId: string) {
  const { data } = await admin.from('profiles').select('business_id').eq('id', profileId).maybeSingle()
  return Boolean(data) && data!.business_id === businessId
}
