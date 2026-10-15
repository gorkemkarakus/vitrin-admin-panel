import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { sendCustomerMessage } from '../_shared/notify.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'

// Randevu HANGI yoldan olusursa olsun (chatbot, herkese acik randevu sayfasi,
// operator paneli, isletmenin kendi paneli, WhatsApp'tan personel) tek bir
// merkezi noktadan onay bildirimi gondermek icin: appointments'a INSERT
// sonrasi pg_net araciligiyla bu fonksiyonu asenkron cagiran bir trigger
// (bkz. 20260725000002_whatsapp_notifications.sql). Eskiden SMS gonderiyordu
// (send-appointment-confirmation) — artik notification_log'a yaziyor,
// WhatsApp baglaninca _shared/notify.ts degisecek, bu fonksiyon aynen kalacak.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const webhookSecret = Deno.env.get('APPOINTMENT_WEBHOOK_SECRET')
  const provided = req.headers.get('x-webhook-secret')
  if (!webhookSecret || !provided || !timingSafeEqualString(provided, webhookSecret)) {
    return json({ error: 'Yetkisiz' }, 401)
  }

  let body: { appointment_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }
  const { appointment_id } = body
  if (!appointment_id) return json({ error: 'appointment_id zorunlu' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: appt } = await admin
    .from('appointments')
    .select('id, business_id, customer_id, service_id, scheduled_at')
    .eq('id', appointment_id)
    .maybeSingle()
  if (!appt) return json({ error: 'Randevu bulunamadı' }, 404)

  const [{ data: customer }, { data: service }, { data: business }] = await Promise.all([
    appt.customer_id
      ? admin.from('customers').select('full_name, phone, contact_phone').eq('id', appt.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    appt.service_id ? admin.from('services').select('name').eq('id', appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('businesses').select('name, whatsapp_phone_number_id').eq('id', appt.business_id).maybeSingle(),
  ])

  const phone = customer?.contact_phone || customer?.phone || null

  const d = new Date(appt.scheduled_at)
  const dateLabel = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' })
  const timeLabel = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
  const customerFirstName = (customer?.full_name ?? '').trim().split(/\s+/)[0] || 'Merhaba'

  const text = `Merhaba ${customerFirstName}, ${business?.name ?? 'işletmemiz'} randevunuz oluşturuldu: ${service?.name ?? 'Hizmet'}, ${dateLabel} ${timeLabel}. Görüşmek üzere!`

  const result = await sendCustomerMessage(admin, {
    businessId: appt.business_id,
    customerId: appt.customer_id,
    phone,
    phoneNumberId: business?.whatsapp_phone_number_id ?? null,
    kind: 'confirmation',
    message: text,
  })
  return json({ ok: result.ok, error: result.error }, 200)
})
