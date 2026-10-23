// reschedule-appointment: istek isleyicisi. HTTP'den (index.ts) ve musteri asistanindan
// (whatsapp-webhook, dogrudan cagri) ayni kod calisir.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { resolveBusiness } from '../_shared/resolveBusiness.ts'
import { validateScheduledAt } from '../_shared/validation.ts'
import { SLOT_MINUTES, isAvailable, eligibleDayHours, istanbulParts, toMinutes, findNextAvailable } from '../_shared/availability.ts'

// Musteri/chatbot'un var olan bir randevunun tarih/saatini degistirmesini
// saglar. AYNI satirin UPDATE'i — iptal+yeniden olusturma DEGIL, cunku
// payments.appointment_id ve paket seans baglantisi randevunun id'sine
// referans veriyor. v1 kapsami: SADECE tarih/saat, ayni calisan+hizmet
// (employee_id/service_id istekten degil, VAR OLAN satirdan okunur —
// LLM'in hicbir hallucination'i calisan/hizmet degistiremez).
const RESCHEDULABLE_STATUSES = ['bekliyor', 'onaylandi']
const SEARCH_DAYS = 14

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  let body: {
    appointment_id?: string
    customer_phone?: string
    new_scheduled_at?: string
    phone_number_id?: string
    date_warning?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const business = await resolveBusiness(admin, req, body.phone_number_id)
  if (!business) return json({ error: 'Geçersiz API anahtarı' }, 401)

  // book-appointment'taki AYNI erken-cikis: n8n musterinin yazdigi tarihin
  // takvimde GERCEKTEN var olmadigini (ör. "29 Şubat") tespit ederse bunu
  // buraya date_warning olarak gonderiyor — boyle durumda musterinin hic
  // istemedigi, sessizce kaydirilmis bir tarihe randevu TASINMADAN once
  // burada durup net bir hata donduruyoruz.
  if (body.date_warning) {
    return json({ error: body.date_warning }, 400)
  }

  const { appointment_id, customer_phone, new_scheduled_at } = body
  if (!appointment_id || !customer_phone || !new_scheduled_at) {
    return json({ error: 'appointment_id, customer_phone ve new_scheduled_at zorunlu' }, 400)
  }

  const scheduledAtError = validateScheduledAt(new_scheduled_at)
  if (scheduledAtError) return json({ error: scheduledAtError }, 400)

  const { data: customer } = await admin
    .from('customers')
    .select('id')
    .eq('business_id', business.id)
    .eq('phone', customer_phone)
    .maybeSingle()
  if (!customer) return json({ error: 'Randevu bulunamadı' }, 404)

  const { data: appt } = await admin
    .from('appointments')
    .select('id, status, employee_id, service_id, duration_minutes, source_note')
    .eq('id', appointment_id)
    .eq('business_id', business.id)
    .eq('customer_id', customer.id)
    .maybeSingle()
  if (!appt) return json({ error: 'Randevu bulunamadı' }, 404)

  if (!RESCHEDULABLE_STATUSES.includes(appt.status)) {
    return json({ error: 'Bu randevu iptal edilmiş veya tamamlanmış, tarihi değiştirilemez.' }, 409)
  }
  if (!appt.employee_id) {
    return json({ error: 'Bu randevunun tarihi değiştirilemiyor, lütfen işletmeyle iletişime geçin.' }, 409)
  }

  const duration = appt.duration_minutes ?? SLOT_MINUTES
  const [{ data: service }, { data: employee }, { data: schedules }, { data: timeBlocks }, { data: sameEmployeeAppts }] = await Promise.all([
    appt.service_id ? admin.from('services').select('name').eq('id', appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('profiles').select('full_name').eq('id', appt.employee_id).maybeSingle(),
    admin.from('employee_schedules').select('profile_id, day_of_week, starts_at, ends_at').eq('profile_id', appt.employee_id),
    admin.from('employee_time_blocks').select('profile_id, day_of_week, block_date, starts_at, ends_at').eq('profile_id', appt.employee_id),
    admin
      .from('appointments')
      .select('employee_id, scheduled_at, duration_minutes, status, source')
      .eq('business_id', business.id)
      .eq('employee_id', appt.employee_id)
      .neq('status', 'iptal')
      .neq('id', appointment_id), // kendi mevcut satirini cakisma kontrolunden haric tut
  ])

  const serviceName = service?.name ?? null
  const employeeName = employee?.full_name ?? null
  const newStart = new Date(new_scheduled_at)
  const scheds = schedules ?? []
  const blocks = timeBlocks ?? []
  const otherAppts = sameEmployeeAppts ?? []

  if (isAvailable(appt.employee_id, newStart, duration, scheds, otherAppts, blocks)) {
    const combinedNote = [appt.source_note, 'Tarih/saat değişikliği (chatbot)'].filter(Boolean).join(' | ')
    const { data: updated, error } = await admin
      .from('appointments')
      // reminder_sent_at sifirlanmazsa, eski saat icin zaten hatirlatma
      // almis bir musteri YENI saat icin HIC hatirlatma almaz (sessiz
      // regresyon — process-appointment-reminders sadece reminder_sent_at
      // IS NULL olanlari tarar).
      .update({ scheduled_at: newStart.toISOString(), source_note: combinedNote, reminder_sent_at: null })
      .eq('id', appointment_id)
      .select('id, scheduled_at')
      .single()

    if (!error && updated) {
      return json(
        { status: 'rescheduled', appointment: { id: updated.id, scheduled_at: updated.scheduled_at, service_name: serviceName, employee_name: employeeName } },
        200,
      )
    }
    // book-appointment'taki AYNI race-recovery deseni: exclusion constraint
    // ihlali (baska bir istek ayni araliga es zamanli yazdiysa) sessizce
    // findNextAvailable'a dusuyor, ham DB hatasi hic sizmiyor.
    const msg = error?.message ?? ''
    if (!/exclusion|duplicate key|deadlock/i.test(msg)) {
      console.error('reschedule-appointment update error:', msg)
      return json({ error: 'Randevu güncellenemedi, lütfen tekrar deneyin.' }, 500)
    }
  }

  const { dayOfWeek, hours, minutes } = istanbulParts(newStart)
  const startMin = hours * 60 + minutes
  const dayHours = eligibleDayHours(dayOfWeek, [appt.employee_id], scheds)
  const isOutsideHours = !dayHours || startMin < toMinutes(dayHours.starts_at) || startMin + duration > toMinutes(dayHours.ends_at)
  const outsideHours = isOutsideHours ? (dayHours ?? { starts_at: null, ends_at: null }) : null

  const next = findNextAvailable(newStart, [appt.employee_id], duration, scheds, otherAppts, blocks, SEARCH_DAYS)
  if (next) {
    return json(
      { status: 'unavailable', suggestion: { scheduled_at: next.scheduledAt.toISOString(), employee_name: employeeName }, outside_hours: outsideHours },
      200,
    )
  }
  return json({ status: 'no_availability' }, 200)
}
