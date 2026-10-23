// cancel-appointment: istek isleyicisi. HTTP'den (index.ts) ve musteri asistanindan
// (whatsapp-webhook, dogrudan cagri) ayni kod calisir.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { resolveBusiness } from '../_shared/resolveBusiness.ts'

// Musteri/chatbot'un var olan bir randevuyu iptal etmesini saglayan tek
// mutasyon noktasi. book-appointment ile AYNI kimlik dogrulama deseni
// (x-api-key / phone_number_id, resolveBusiness) — n8n zaten bu iki header'i
// her cagrida gonderiyor.
const CANCELLABLE_STATUSES = ['bekliyor', 'onaylandi']

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  let body: { appointment_id?: string; customer_phone?: string; phone_number_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const business = await resolveBusiness(admin, req, body.phone_number_id)
  if (!business) return json({ error: 'Geçersiz API anahtarı' }, 401)

  const { appointment_id, customer_phone } = body
  if (!appointment_id || !customer_phone) {
    return json({ error: 'appointment_id ve customer_phone zorunlu' }, 400)
  }

  const { data: customer } = await admin
    .from('customers')
    .select('id')
    .eq('business_id', business.id)
    .eq('phone', customer_phone)
    .maybeSingle()
  // "yok" ile "sahibi degil" ayni 404 — hangisi oldugunu sizdirmiyoruz.
  if (!customer) return json({ error: 'Randevu bulunamadı' }, 404)

  const { data: appt } = await admin
    .from('appointments')
    .select('id, status, scheduled_at, service_id, employee_id, source_note')
    .eq('id', appointment_id)
    .eq('business_id', business.id)
    .eq('customer_id', customer.id)
    .maybeSingle()
  if (!appt) return json({ error: 'Randevu bulunamadı' }, 404)

  if (!CANCELLABLE_STATUSES.includes(appt.status)) {
    return json({ error: 'Bu randevu zaten iptal edilmiş veya tamamlanmış, iptal edilemez.' }, 409)
  }

  const combinedNote = [appt.source_note, 'İptal edildi (chatbot)'].filter(Boolean).join(' | ')
  const { data: updated, error } = await admin
    .from('appointments')
    .update({ status: 'iptal', source_note: combinedNote })
    .eq('id', appointment_id)
    .select('id, scheduled_at')
    .single()

  if (error || !updated) {
    console.error('cancel-appointment update error:', error?.message)
    return json({ error: 'Randevu iptal edilemedi, lütfen tekrar deneyin.' }, 500)
  }

  const [{ data: service }, { data: employee }] = await Promise.all([
    appt.service_id ? admin.from('services').select('name').eq('id', appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.employee_id ? admin.from('profiles').select('full_name').eq('id', appt.employee_id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  return json(
    {
      status: 'cancelled',
      appointment: {
        id: updated.id,
        scheduled_at: updated.scheduled_at,
        service_name: service?.name ?? null,
        employee_name: employee?.full_name ?? null,
      },
    },
    200,
  )
}
