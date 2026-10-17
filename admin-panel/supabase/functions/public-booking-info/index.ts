import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { clientKey, rateLimit } from '../_shared/limits.ts'
import { SLOT_MINUTES, eligibleDayHours, listOpenSlots, istanbulParts } from '../_shared/availability.ts'

// Herkese açık — x-api-key YOK. business_id, URL'de zaten görünür olan
// (dolayısıyla ifşası güvenli) slug'dan çözülür. Bu fonksiyon SADECE okuma
// yapar; hiçbir zaman gelir veya başka müşteri bilgisi döndürmez — sadece
// işletme adı, aktif hizmetler, (bir hizmet seçildiyse) o hizmeti
// verebilecek aktif personelin adı, ve (istenirse) bir günün boş saatleri.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { slug?: string; service_id?: string; employee_id?: string; date?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { slug, service_id, employee_id, date } = body
  if (!slug) return json({ error: 'slug zorunlu' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // Sayfa her hizmet/gun seciminde bunu cagirir; normal kullanim 10 dakikada
  // birkac on istegi gecmez. Slug taramasi ve kaba kuvvet icin IP basina sinir.
  const limited = await rateLimit(admin, 'public-booking-info', await clientKey(req), 120, 600)
  if (limited) return limited

  const { data: business } = await admin.from('businesses').select('*').eq('slug', slug).maybeSingle()
  if (!business) return json({ error: 'İşletme bulunamadı' }, 404)
  // Yonetici Ayarlar'dan online randevuyu kapattiysa. select('*'):
  // online_booking_enabled kolonu henuz yoksa (migration oncesi) sorgu
  // bozulmasin, sayfa acik kabul edilsin.
  if (business.online_booking_enabled === false) {
    return json({ error: 'Bu salon şu an online randevu almıyor.', closed: true }, 403)
  }

  const { data: services } = await admin
    .from('services')
    .select('id, name, price, duration_minutes, description')
    .eq('business_id', business.id)
    .eq('is_active', true)
    // Hizmet ayarlarindaki 'Online randevuda goster' kapaliysa listelenmez.
    .eq('online_bookable', true)
    .order('name')

  const response: Record<string, unknown> = {
    business: { name: business.name },
    services: services ?? [],
  }

  if (!service_id) return json(response, 200)

  const { data: service } = await admin
    .from('services')
    .select('id, duration_minutes')
    .eq('business_id', business.id)
    .eq('id', service_id)
    .eq('is_active', true)
    .eq('online_bookable', true)
    .maybeSingle()

  if (!service) return json({ error: 'Hizmet bulunamadı' }, 404)

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
  const eligibleIds = (activeProfiles ?? []).map((p) => p.id).filter((id) => assignedIds.has(id))

  if (!date) {
    // Sadece hizmet seçildi, tarih henüz seçilmedi — uzman listesini döndür.
    // "specialty" musterinin uydurma bir etiket degil, calisanin GERCEKTEN
    // verebildigi hizmetlerden (employee_services) turetiliyor.
    const { data: allEmpSvcs } = await admin
      .from('employee_services')
      .select('profile_id, service_id')
      .in('profile_id', eligibleIds)
    const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))

    response.employees = eligibleIds.map((id) => {
      const specialties = (allEmpSvcs ?? [])
        .filter((es) => es.profile_id === id)
        .map((es) => serviceNameById.get(es.service_id))
        .filter((name): name is string => Boolean(name))
      return {
        id,
        full_name: activeProfiles?.find((p) => p.id === id)?.full_name ?? 'Uzman',
        specialty: specialties.length > 0 ? specialties.join(', ') : null,
      }
    })
    return json(response, 200)
  }

  // Musteri belirli bir uzman sectiyse slotlari SADECE o kisiye gore hesapla.
  const slotEligibleIds = employee_id && eligibleIds.includes(employee_id) ? [employee_id] : eligibleIds
  const duration = service.duration_minutes ?? SLOT_MINUTES

  if (slotEligibleIds.length === 0) {
    response.date = date
    response.slots = []
    response.outside_hours = null
  } else {
    const { data: schedules } = await admin
      .from('employee_schedules')
      .select('profile_id, day_of_week, starts_at, ends_at')
      .in('profile_id', slotEligibleIds)
    const { data: timeBlocks } = await admin
      .from('employee_time_blocks')
      .select('profile_id, day_of_week, block_date, starts_at, ends_at')
      .in('profile_id', slotEligibleIds)
    const { data: appointments } = await admin
      .from('appointments')
      .select('employee_id, scheduled_at, duration_minutes, status, source')
      .eq('business_id', business.id)
      .neq('status', 'iptal')

    const day = new Date(`${date}T00:00:00+03:00`)
    const { dayOfWeek } = istanbulParts(day)
    const dayHours = eligibleDayHours(dayOfWeek, slotEligibleIds, schedules ?? [])

    response.date = date
    response.slots = listOpenSlots(day, slotEligibleIds, duration, schedules ?? [], appointments ?? [], timeBlocks ?? [])
    response.outside_hours = dayHours ? null : { starts_at: null, ends_at: null }
  }

  return json(response, 200)
})
