import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { sendCustomerMessage } from '../_shared/notify.ts'

const MAX_RECIPIENTS = 500
const RATE_LIMIT_MAX_PER_HOUR = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  // Her tetikleme artik gercek bir WhatsApp mesaji anlamina geliyor
  // (_shared/notify.ts) — calinmis/kotuye kullanilan bir admin oturumu
  // isletme basina saatte 10 kampanyayla sinirlandiriliyor
  // (parse-appointment-command/staff-whatsapp-webhook ile ayni desen).
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await admin.from('bulk_campaign_attempts').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  const { count: recentAttempts } = await admin
    .from('bulk_campaign_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('created_at', oneHourAgo)
  if ((recentAttempts ?? 0) >= RATE_LIMIT_MAX_PER_HOUR) {
    return json({ error: 'Çok fazla kampanya gönderildi, lütfen bir süre sonra tekrar deneyin.' }, 429)
  }
  await admin.from('bulk_campaign_attempts').insert({ business_id: businessId })

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const customerIds = Array.isArray(body.customerIds) ? body.customerIds.filter((v): v is string => typeof v === 'string') : []
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (customerIds.length === 0) return json({ error: 'Alıcı listesi boş' }, 400)
  if (customerIds.length > MAX_RECIPIENTS) return json({ error: `En fazla ${MAX_RECIPIENTS} alıcıya tek seferde gönderilebilir` }, 400)
  if (!message) return json({ error: 'Mesaj metni boş olamaz' }, 400)

  const { data: business } = await admin
    .from('businesses')
    .select('whatsapp_phone_number_id')
    .eq('id', businessId)
    .maybeSingle()

  // Sadece BU isletmeye ait musteriler — baska bir isletmenin customer_id'sini
  // gecirip veri sizdirmayi engeller (RLS zaten service_role ile bypass
  // ediliyor, bu filtre burada zorunlu).
  const { data: customers, error: custErr } = await admin
    .from('customers')
    .select('id, phone, contact_phone')
    .eq('business_id', businessId)
    .in('id', customerIds)

  if (custErr) {
    console.error('send-bulk-campaign: müşteri sorgusu hatası:', custErr.message)
    return json({ error: 'Alıcılar okunamadı' }, 500)
  }

  let sent = 0
  let failed = 0
  for (const c of customers ?? []) {
    const phone = c.contact_phone || c.phone || null
    const result = await sendCustomerMessage(admin, {
      businessId,
      customerId: c.id,
      phone,
      phoneNumberId: business?.whatsapp_phone_number_id ?? null,
      kind: 'bulk_campaign',
      message,
    })
    if (result.ok) sent += 1
    else failed += 1
  }

  return json({ data: { sent, failed, total: customers?.length ?? 0 } }, 200)
})
