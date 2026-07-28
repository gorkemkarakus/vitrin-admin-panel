import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { sendCustomerMessage } from '../_shared/notify.ts'

// pg_cron tarafindan her 15 dakikada bir cagirilir (bkz.
// 20260725000002_whatsapp_notifications.sql). Her isletmenin KENDI
// belirledigi reminder_hours_before'a gore ("2 saat once" / "1 gun once"
// gibi) hatirlatma penceresine giren, henuz hatirlatilmamis, iptal
// edilmemis randevulari bulup bildirim gonderir ve isaretler.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const webhookSecret = Deno.env.get('APPOINTMENT_WEBHOOK_SECRET')
  if (!webhookSecret || req.headers.get('x-webhook-secret') !== webhookSecret) {
    return json({ error: 'Yetkisiz' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: businesses } = await admin
    .from('businesses')
    .select('id, name, reminder_hours_before')
    .not('reminder_hours_before', 'is', null)
  if (!businesses || businesses.length === 0) return json({ ok: true, sent: 0 }, 200)

  const businessIds = businesses.map((b) => b.id)
  const businessById = new Map(businesses.map((b) => [b.id, b]))

  const nowIso = new Date().toISOString()
  const { data: candidates } = await admin
    .from('appointments')
    .select('id, business_id, customer_id, service_id, scheduled_at')
    .in('business_id', businessIds)
    .is('reminder_sent_at', null)
    .neq('status', 'iptal')
    .gt('scheduled_at', nowIso)

  let sent = 0
  for (const appt of candidates ?? []) {
    const business = businessById.get(appt.business_id)
    const hours = business?.reminder_hours_before
    if (!hours) continue

    const threshold = new Date(Date.now() + hours * 60 * 60 * 1000)
    if (new Date(appt.scheduled_at) > threshold) continue // hatirlatma penceresine henuz girmedi

    const [{ data: customer }, { data: service }] = await Promise.all([
      appt.customer_id
        ? admin.from('customers').select('full_name, phone, contact_phone').eq('id', appt.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
      appt.service_id ? admin.from('services').select('name').eq('id', appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    ])

    const phone = customer?.contact_phone || customer?.phone || null
    const d = new Date(appt.scheduled_at)
    const dateLabel = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' })
    const timeLabel = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
    const customerFirstName = (customer?.full_name ?? '').trim().split(/\s+/)[0] || 'Merhaba'

    const text = `Merhaba ${customerFirstName}, hatırlatma: ${business?.name ?? 'işletmemiz'}'deki randevunuz ${dateLabel} ${timeLabel} — ${service?.name ?? 'Hizmet'}.`

    const result = await sendCustomerMessage(admin, {
      businessId: appt.business_id,
      customerId: appt.customer_id,
      phone,
      kind: 'reminder',
      message: text,
    })
    if (result.ok) {
      await admin.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', appt.id)
      sent++
    }
  }

  return json({ ok: true, sent }, 200)
})
