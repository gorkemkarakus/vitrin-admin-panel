import { corsHeaders, json } from '../_shared/http.ts'
import { requireOperator, requireBusiness } from '../_shared/operatorAuth.ts'

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ServicesPage.tsx + ServiceDescriptionPage.tsx'in operatör karşılığı.
// ServiceDescriptionPage'in kaynak kodu id-only calisiyor (business_id
// filtresi yok, tamamen RLS'e guveniyor) — burada bunu HER action'da elle
// ekliyoruz, hicbir servis sorgusu business_id'siz calismiyor.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireOperator(req)
  if (!auth.ok) return auth.response
  const { admin } = auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const action = body.action as string | undefined
  const business_id = body.business_id as string | undefined
  if (!action || !business_id) return json({ error: 'action ve business_id zorunlu' }, 400)
  if (!(await requireBusiness(admin, business_id))) return json({ error: 'İşletme bulunamadı' }, 404)

  if (action === 'load') {
    const [{ data: services }, { data: appts }] = await Promise.all([
      admin
        .from('services')
        .select('id, name, duration_minutes, price, is_active, description')
        .eq('business_id', business_id)
        .order('is_active', { ascending: false })
        .order('name', { ascending: true }),
      admin
        .from('appointments')
        .select('service_id')
        .eq('business_id', business_id)
        .eq('status', 'tamamlandi')
        .gte('scheduled_at', `${firstOfMonth()}T00:00:00`),
    ])
    return json({ services: services ?? [], monthAppointments: appts ?? [] }, 200)
  }

  if (action === 'create') {
    const { name, duration_minutes, price } = body as { name?: string; duration_minutes?: number; price?: number | null }
    if (!name?.trim()) return json({ error: 'name zorunlu' }, 400)
    await admin.from('services').insert({
      business_id,
      name: name.trim(),
      duration_minutes: Math.max(5, duration_minutes || 60),
      price: price == null ? null : Math.max(0, price),
    })
    return json({ ok: true }, 200)
  }

  if (action === 'update') {
    const { service_id, patch } = body as { service_id?: string; patch?: Record<string, unknown> }
    if (!service_id || !patch) return json({ error: 'service_id ve patch zorunlu' }, 400)
    const { data: service } = await admin.from('services').select('business_id').eq('id', service_id).maybeSingle()
    if (!service || service.business_id !== business_id) return json({ error: 'Bu hizmet bu işletmeye ait değil' }, 403)
    await admin.from('services').update(patch).eq('id', service_id)
    return json({ ok: true }, 200)
  }

  if (action === 'delete') {
    const { service_id } = body as { service_id?: string }
    if (!service_id) return json({ error: 'service_id zorunlu' }, 400)
    const { data: service } = await admin.from('services').select('business_id').eq('id', service_id).maybeSingle()
    if (!service || service.business_id !== business_id) return json({ error: 'Bu hizmet bu işletmeye ait değil' }, 403)
    await admin.from('services').delete().eq('id', service_id)
    return json({ ok: true }, 200)
  }

  if (action === 'get_description') {
    const { service_id } = body as { service_id?: string }
    if (!service_id) return json({ error: 'service_id zorunlu' }, 400)
    const { data: service } = await admin
      .from('services')
      .select('id, name, description')
      .eq('id', service_id)
      .eq('business_id', business_id)
      .maybeSingle()
    if (!service) return json({ error: 'Hizmet bulunamadı' }, 404)
    return json({ service }, 200)
  }

  if (action === 'update_description') {
    const { service_id, description } = body as { service_id?: string; description?: string | null }
    if (!service_id) return json({ error: 'service_id zorunlu' }, 400)
    const { data: service } = await admin.from('services').select('business_id').eq('id', service_id).maybeSingle()
    if (!service || service.business_id !== business_id) return json({ error: 'Bu hizmet bu işletmeye ait değil' }, 403)
    await admin.from('services').update({ description: description?.trim() || null }).eq('id', service_id)
    return json({ ok: true }, 200)
  }

  return json({ error: 'Bilinmeyen action' }, 400)
})
