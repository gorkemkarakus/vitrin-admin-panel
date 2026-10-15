import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { sha256Hex } from '../_shared/crypto.ts'
import { SLOT_MINUTES, isAvailable, rankEligibleByFairness } from '../_shared/availability.ts'
import { isValidTurkishPhone, validateScheduledAt } from '../_shared/validation.ts'

const PHONE_RATE_LIMIT_MAX_PER_HOUR = 5
const IP_RATE_LIMIT_MAX_PER_HOUR = 10

async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret) return true // Turnstile henüz kurulmadıysa doğrulamayı atla (geçici).
  if (!token) return false
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  const outcome = await res.json()
  return outcome.success === true
}

// Herkese açık yazma uç noktası — x-api-key YOK, internetten doğrudan POST
// edilebilir. book-appointment'ın aksine aradan n8n/LLM süzgeci geçmediği
// için TÜM doğrulamalar burada eksiksiz uygulanır. Müşteri belirli bir
// çalışan seçemez (employee_id sadece ileride kullanılmak üzere kabul
// edilir, v1 arayüzü hiç göndermez) — aksi halde chatbot için kurulmuş adil
// dağıtım bu kanaldan bypass edilirdi.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: {
    slug?: string
    service_id?: string
    employee_id?: string
    scheduled_at?: string
    customer_name?: string
    customer_phone?: string
    turnstile_token?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { slug, service_id, employee_id, scheduled_at, customer_name, customer_phone, turnstile_token } = body

  if (!slug || !service_id || !scheduled_at || !customer_name || !customer_phone) {
    return json(
      { error: 'slug, service_id, scheduled_at, customer_name ve customer_phone zorunlu' },
      400,
    )
  }

  if (!isValidTurkishPhone(customer_phone)) {
    return json({ error: 'Geçerli bir telefon numarası giriniz (ör. 0532 123 45 67)' }, 400)
  }

  const scheduledAtError = validateScheduledAt(scheduled_at)
  if (scheduledAtError) return json({ error: scheduledAtError }, 400)

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  const turnstileOk = await verifyTurnstile(turnstile_token, clientIp)
  if (!turnstileOk) {
    return json({ error: 'Doğrulama başarısız, lütfen sayfayı yenileyip tekrar deneyin.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: business } = await admin.from('businesses').select('*').eq('slug', slug).maybeSingle()
  if (!business) return json({ error: 'İşletme bulunamadı' }, 404)
  // Yonetici Ayarlar'dan online randevuyu kapattiysa. select('*'):
  // online_booking_enabled kolonu henuz yoksa (migration oncesi) sorgu
  // bozulmasin, sayfa acik kabul edilsin.
  if (business.online_booking_enabled === false) {
    return json({ error: 'Bu salon şu an online randevu almıyor.', closed: true }, 403)
  }

  // Kötüye kullanım koruması: aynı telefon numarasından saatte 5'ten, aynı
  // IP'den saatte 10'dan fazla deneme varsa reddet — bir script farklı sahte
  // telefon numaraları üretse bile aynı IP'den geldiği için yakalanır. Eski
  // satırları fırsatçı şekilde temizleyerek tabloyu küçük tutuyoruz (ayrı bir
  // cron/pg_cron gerekmiyor).
  const phoneDigits = customer_phone.replace(/\D/g, '')
  const ipHash = clientIp ? await sha256Hex(clientIp) : null
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await admin.from('public_booking_attempts').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const { count: recentPhoneAttempts } = await admin
    .from('public_booking_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', business.id)
    .eq('phone_digits', phoneDigits)
    .gte('created_at', oneHourAgo)
  if ((recentPhoneAttempts ?? 0) >= PHONE_RATE_LIMIT_MAX_PER_HOUR) {
    return json({ error: 'Çok fazla deneme yapıldı, lütfen daha sonra tekrar deneyin.' }, 429)
  }

  if (ipHash) {
    const { count: recentIpAttempts } = await admin
      .from('public_booking_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', business.id)
      .eq('ip_hash', ipHash)
      .gte('created_at', oneHourAgo)
    if ((recentIpAttempts ?? 0) >= IP_RATE_LIMIT_MAX_PER_HOUR) {
      return json({ error: 'Çok fazla deneme yapıldı, lütfen daha sonra tekrar deneyin.' }, 429)
    }
  }

  await admin.from('public_booking_attempts').insert({ business_id: business.id, phone_digits: phoneDigits, ip_hash: ipHash })

  const { data: service } = await admin
    .from('services')
    .select('id, name, duration_minutes')
    .eq('business_id', business.id)
    .eq('id', service_id)
    .eq('is_active', true)
    .eq('online_bookable', true)
    .maybeSingle()
  if (!service) return json({ error: 'Hizmet bulunamadı' }, 404)

  const duration = service.duration_minutes ?? SLOT_MINUTES

  const { data: activeProfiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('business_id', business.id)
    .eq('is_active', true)
    // Calisan ayarlarindaki 'Online randevuda gorunur' kapaliysa secilemez.
    .eq('online_bookable', true)

  // Bir hizmete hic kimse atanmamissa (bkz. Ekip sayfasi "Verebildigi
  // Hizmetler") o hizmete kimse randevu alamaz — kasitli, fallback yok.
  const { data: empSvcs } = await admin.from('employee_services').select('profile_id').eq('service_id', service.id)
  const assignedIds = new Set((empSvcs ?? []).map((e) => e.profile_id))
  let eligibleIds = (activeProfiles ?? []).map((p) => p.id).filter((id) => assignedIds.has(id))

  if (employee_id) {
    if (!eligibleIds.includes(employee_id)) {
      return json({ error: 'Belirtilen çalışan bu hizmeti verebilecek alanda değil' }, 400)
    }
    eligibleIds = [employee_id]
  }

  if (eligibleIds.length === 0) {
    return json({ error: 'Bu hizmeti verebilecek çalışan tanımlı değil' }, 400)
  }

  const { data: schedules } = await admin
    .from('employee_schedules')
    .select('profile_id, day_of_week, starts_at, ends_at')
    .in('profile_id', eligibleIds)
  const { data: timeBlocks } = await admin
    .from('employee_time_blocks')
    .select('profile_id, day_of_week, block_date, starts_at, ends_at')
    .in('profile_id', eligibleIds)
  const { data: appointments } = await admin
    .from('appointments')
    .select('employee_id, scheduled_at, duration_minutes, status, source')
    .eq('business_id', business.id)
    .neq('status', 'iptal')

  eligibleIds = rankEligibleByFairness(eligibleIds, appointments ?? [], ['chatbot', 'online_randevu'])

  const requestedStart = new Date(scheduled_at)
  const chosenEmployee = eligibleIds.find((id) =>
    isAvailable(id, requestedStart, duration, schedules ?? [], appointments ?? [], timeBlocks ?? []),
  )

  if (!chosenEmployee) {
    return json({ status: 'conflict' }, 200)
  }

  try {
    // customer_phone kanal kimliği (WhatsApp IGSID gibi) chatbot tarafında
    // farklı olabiliyor ama burada müşteri kendi numarasını tek bir alana
    // yazıyor — hem phone hem contact_phone'a aynı değeri yazıp, aynı
    // numarayla daha önce başka kanaldan (chatbot) gelen müşteriyle aynı
    // customers kaydına düşmesini sağlıyoruz (set-once birleştirme, aynı
    // book-appointment'taki mantık).
    const { data: existingCustomer } = await admin
      .from('customers')
      .select('id, full_name, contact_phone')
      .eq('business_id', business.id)
      .eq('phone', customer_phone)
      .maybeSingle()

    let customerId = existingCustomer?.id
    if (!customerId) {
      const { data: newCustomer, error: custErr } = await admin
        .from('customers')
        .insert({
          business_id: business.id,
          full_name: customer_name,
          phone: customer_phone,
          contact_phone: customer_phone,
        })
        .select('id')
        .single()
      if (custErr || !newCustomer) throw new Error(custErr?.message ?? 'Müşteri oluşturulamadı')
      customerId = newCustomer.id
    } else {
      const updates: Record<string, string> = {}
      if (!existingCustomer.contact_phone) updates.contact_phone = customer_phone
      if (!existingCustomer.full_name || existingCustomer.full_name === 'Müşteri') {
        updates.full_name = customer_name
      }
      if (Object.keys(updates).length > 0) {
        await admin.from('customers').update(updates).eq('id', customerId)
      }
    }

    const { data: appointment, error: apptErr } = await admin
      .from('appointments')
      .insert({
        business_id: business.id,
        customer_id: customerId,
        service_id: service.id,
        employee_id: chosenEmployee,
        created_by_user_id: null,
        scheduled_at: requestedStart.toISOString(),
        duration_minutes: duration,
        source: 'online_randevu',
      })
      .select('id, scheduled_at')
      .single()

    if (apptErr || !appointment) throw new Error(apptErr?.message ?? 'Randevu oluşturulamadı')

    return json(
      {
        status: 'booked',
        appointment: { id: appointment.id, scheduled_at: appointment.scheduled_at, service_name: service.name },
      },
      200,
    )
  } catch (e) {
    // Ayni calisan+saate iki musteri neredeyse ayni anda rezervasyon yaparsa
    // (exclusion constraint) veya mesai saatleri trigger'i reddederse
    // (trg_check_employee_schedule_hours), musteriye teknik hata yerine
    // sade bir "conflict" don — frontend o gunun slotlarini yeniden ceker.
    const msg = String(e instanceof Error ? e.message : e)
    if (/exclusion|duplicate key|deadlock|mesaide değil/i.test(msg)) {
      return json({ status: 'conflict' }, 200)
    }
    // Ham Postgres hatasi kimlik dogrulamasi olmayan bir internet
    // kullanicisina hic sizmasin — teshis icin sunucu logunda kalir.
    console.error('public-book-appointment insert error:', msg)
    return json({ error: 'Randevu oluşturulamadı, lütfen tekrar deneyin.' }, 500)
  }
})
