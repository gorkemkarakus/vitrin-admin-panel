import { corsHeaders, json } from '../_shared/http.ts'
import { requireOperator, requireBusiness } from '../_shared/operatorAuth.ts'

// DashboardPage.tsx'in RLS'e biraktigi business_id filtresini burada elle uyguluyoruz.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireOperator(req)
  if (!auth.ok) return auth.response
  const { admin } = auth

  let body: { business_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }
  const { business_id } = body
  if (!business_id) return json({ error: 'business_id zorunlu' }, 400)
  if (!(await requireBusiness(admin, business_id))) return json({ error: 'İşletme bulunamadı' }, 404)

  const [{ data: appointments }, { data: services }, { data: profiles }] = await Promise.all([
    admin
      .from('appointments')
      .select('id, service_id, employee_id, created_by_user_id, status, source')
      .eq('business_id', business_id),
    admin.from('services').select('id, price').eq('business_id', business_id),
    admin.from('profiles').select('id, full_name').eq('business_id', business_id),
  ])

  return json({ appointments: appointments ?? [], services: services ?? [], profiles: profiles ?? [] }, 200)
})
