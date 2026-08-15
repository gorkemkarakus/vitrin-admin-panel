import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { json } from './http.ts'

// create-team-member/delete-team-member/update-team-member'da 3 kez birebir
// kopyalanmis olan isletme-sahibi rol kontrolunu tek yerde toplar. Onemli:
// bu, _shared/operatorAuth.ts'teki requireOperator ile KARISTIRILMAMALI —
// o platform_admins tablosunu kontrol eder (Adapptiv'in kendi platform
// operatorleri), bu ise normal bir isletmenin SAHIBINI (profiles.role
// ='admin') dogrular. Ikisi tamamen ayri yetki katmanlari.
export async function requireAdmin(
  req: Request,
): Promise<
  | { ok: true; userId: string; businessId: string; admin: SupabaseClient }
  | { ok: false; response: Response }
> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { ok: false, response: json({ error: 'Yetkilendirme başlığı eksik' }, 401) }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Cagiranin kimligi ONCE kendi JWT'siyle (anon-key client, dusuk yetkili)
  // kriptografik olarak dogrulanir — bu adim service_role ile ATLANAMAZ,
  // service_role hicbir JWT'yi dogrulamadan kabul eder.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !userData.user) return { ok: false, response: json({ error: 'Geçersiz oturum' }, 401) }

  // Buradan sonrasi service_role ile — RLS'i bilerek atliyoruz (rol kontrolu
  // icin gerekli, ama caller kimligi yukarida zaten dogrulandi).
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('business_id, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileErr || !profile || !profile.is_active || profile.role !== 'admin') {
    return { ok: false, response: json({ error: 'Bu işlemi sadece işletme yöneticisi yapabilir' }, 403) }
  }

  return { ok: true, userId: userData.user.id, businessId: profile.business_id, admin }
}
