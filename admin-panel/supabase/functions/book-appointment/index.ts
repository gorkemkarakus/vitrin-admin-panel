import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { resolveBusiness } from '../_shared/resolveBusiness.ts'
import {
  SLOT_MINUTES,
  toMinutes,
  istanbulParts,
  istanbulDateString,
  isAvailable,
  eligibleDayHours,
  rankEligibleByFairness,
} from '../_shared/availability.ts'
import { isValidTurkishPhone, validateScheduledAt } from '../_shared/validation.ts'

const SEARCH_DAYS = 14

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  let body: {
    customer_name?: string
    customer_phone?: string
    contact_phone?: string
    service_id?: string
    service_name?: string
    employee_id?: string
    employee_name?: string
    scheduled_at?: string
    source_note?: string
    date_warning?: string | null
    phone_number_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const business = await resolveBusiness(admin, req, body.phone_number_id)
  if (!business) return json({ error: 'Geçersiz API anahtarı' }, 401)

  const {
    customer_name,
    customer_phone,
    contact_phone,
    service_id,
    service_name,
    employee_id,
    employee_name,
    scheduled_at,
    source_note,
    date_warning,
  } = body

  // n8n tarafi musterinin yazdigi tarihin takvimde GERCEKTEN var olmadigini
  // (ör. "29 Şubat" bir artik olmayan yilda) tespit ederse bunu buraya
  // date_warning olarak gonderiyor — boyle bir durumda musterinin hic
  // istemedigi, sessizce kaydirilmis bir tarihe (ör. 1 Mart) randevu
  // OLUSTURMADAN once burada durup net bir hata donduruyoruz.
  if (date_warning) {
    return json({ error: date_warning }, 400)
  }

  if (!customer_name || !customer_phone || !contact_phone || !scheduled_at || (!service_id && !service_name)) {
    return json(
      {
        error:
          'customer_name, customer_phone, contact_phone, scheduled_at ve service_id/service_name zorunlu',
      },
      400,
    )
  }

  // contact_phone musteriye bilgilendirme icin kullanilan GERCEK numara —
  // LLM bazen "abc123" gibi anlamsiz bir deger uretip dogrudan buraya
  // gonderebiliyor (test edilip dogrulandi). isValidTurkishPhone rakam
  // olmayan karakterleri atip 10/11/12 haneli (90 ulke koduyla) bir Turkiye
  // cep telefonu formatina uyup uymadigini kontrol eder.
  if (!isValidTurkishPhone(contact_phone)) {
    return json(
      { error: 'Geçerli bir telefon numarası giriniz (ör. 0532 123 45 67)' },
      400,
    )
  }

  // scheduled_at icin butun sessiz-kayma korumalari (acik saat dilimi
  // zorunlulugu, "24:00" ve "30 Şubat" gibi JS Date'in sessizce bir SONRAKI
  // gun/aya kaydirdigi durumlar, gecmis tarih reddi) _shared/validation.ts'te.
  const scheduledAtError = validateScheduledAt(scheduled_at)
  if (scheduledAtError) return json({ error: scheduledAtError }, 400)

  // Kotuye kullanimi engellemek icin: ayni kanal kimliginden (customer_phone —
  // WhatsApp numarasi ya da Instagram IGSID) bir GUNDE en fazla 2 randevu
  // olusturulabilir. Musteri, bookWith()'teki AYNI eslemeyle (business_id +
  // phone) bulunur, boylece ayni kisinin farkli gunlerdeki mesru ihtiyaclari
  // (ör. bugun sac, yarin manikur icin randevu almasi) engellenmez.
  const { data: existingCustomerForCap } = await admin
    .from('customers')
    .select('id')
    .eq('business_id', business.id)
    .eq('phone', customer_phone)
    .maybeSingle()

  if (existingCustomerForCap) {
    const todayStartIstanbul = new Date(`${istanbulDateString(new Date())}T00:00:00+03:00`)
    const { count: todayCount } = await admin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', existingCustomerForCap.id)
      .gte('created_at', todayStartIstanbul.toISOString())
    if ((todayCount ?? 0) >= 2) {
      return json({ error: 'Bugün için randevu alma limitine ulaştınız, lütfen yarın tekrar deneyin.' }, 429)
    }
  }

  const requestedStart = new Date(scheduled_at)

  const serviceCols = 'id, name, duration_minutes'
  let service: { id: string; name: string; duration_minutes: number | null } | null = null

  if (service_id) {
    const { data } = await admin
      .from('services')
      .select(serviceCols)
      .eq('business_id', business.id)
      .eq('id', service_id)
      .maybeSingle()
    service = data
  } else {
    // LLM'in ürettiği hizmet adı bazen ekstra bilgi içerebilir (ör. "Saç Ekimi (Saç)"
    // gibi kategori eki) — önce sondaki parantezi temizleyip tam eşleşme dene,
    // olmazsa kısmi (ilike wildcard) eşleşmeye düş.
    const cleaned = service_name!.replace(/\s*\([^)]*\)\s*$/, '').trim()
    const { data: exact } = await admin
      .from('services')
      .select(serviceCols)
      .eq('business_id', business.id)
      .ilike('name', cleaned)
      .maybeSingle()
    service = exact
    if (!service) {
      const { data: fuzzy } = await admin
        .from('services')
        .select(serviceCols)
        .eq('business_id', business.id)
        .ilike('name', `%${cleaned}%`)
        .limit(1)
        .maybeSingle()
      service = fuzzy
    }
  }

  if (!service) return json({ error: 'Hizmet bulunamadı' }, 404)

  const duration = service.duration_minutes ?? SLOT_MINUTES

  const { data: allProfiles } = await admin.from('profiles').select('id, full_name').eq(
    'business_id',
    business.id,
  )
  let eligibleIds: string[]
  const { data: empSvcs } = await admin.from('employee_services').select('profile_id').eq('service_id', service.id)
  if (empSvcs && empSvcs.length > 0) {
    eligibleIds = empSvcs.map((e) => e.profile_id)
  } else {
    // Bu hizmete hic kimse atanmamissa herkes uygun sayilir (bkz.
    // EmployeeDetailPage.tsx "Verdigi Hizmetler").
    eligibleIds = (allProfiles ?? []).map((p) => p.id)
  }

  if (employee_id) {
    if (!eligibleIds.includes(employee_id)) {
      return json({ error: 'Belirtilen çalışan bu hizmeti verebilecek alanda değil' }, 400)
    }
    eligibleIds = [employee_id]
  } else if (employee_name) {
    const cleanedName = employee_name.trim().toLowerCase()
    const match = (allProfiles ?? []).find(
      (p) => eligibleIds.includes(p.id) && (p.full_name ?? '').trim().toLowerCase() === cleanedName,
    )
    if (!match) {
      return json({ error: 'Belirtilen çalışan bulunamadı veya bu hizmeti veremiyor' }, 400)
    }
    eligibleIds = [match.id]
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

  // Musteri ozel bir calisan istemediyse (eligibleIds birden fazla kisi
  // iceriyorsa), bot HER ZAMAN ayni calisani (listede ilk sirada olani) once
  // deniyordu — bu is yukunu esitsiz dagitiyordu: kendi cabasiyla (bot disinda)
  // musteri ceken bir calisan takvimde "meşgul" gorunup bottan hic yeni musteri
  // alamiyordu, digeri ise hep once denendigi icin butun bot trafigini tek
  // basina topluyordu (test edilip dogrulandi, kullanicidan geri bildirim:
  // prim/komisyon adaletsizligi yaratiyor). rankEligibleByFairness calisanlari
  // "en son NE ZAMAN bottan (source='chatbot') bir randevu aldiklarina" gore
  // siralayip en uzun suredir almamis olani once dener — calisanin KENDI
  // getirdigi musteriler (source != 'chatbot') bu siralamayi hic etkilemiyor.
  eligibleIds = rankEligibleByFairness(eligibleIds, appointments ?? [], ['chatbot'])

  const profileName = (id: string) => allProfiles?.find((p) => p.id === id)?.full_name ?? null

  async function bookWith(employeeId: string, start: Date) {
    // customer_phone kanal kimliği (Instagram'da IGSID, WhatsApp'ta ise zaten
    // gerçek numara olabilir) — müşteriyi eşleştirmek/konuşmayı takip etmek
    // için kullanılır. contact_phone ise botun sohbette sorup aldığı GERÇEK
    // iletişim numarasıdır; bilgilendirme mesajları için bu saklanır.
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
          contact_phone: contact_phone ?? null,
        })
        .select('id')
        .single()
      if (custErr || !newCustomer) throw new Error(custErr?.message ?? 'Müşteri oluşturulamadı')
      customerId = newCustomer.id
    } else {
      // Mevcut müşteri kaydını SADECE eksik alanları için güncelle (set-once).
      // Aksi halde bu kanaldan başka biri adına randevu alındığında (ör. "arkadaşım
      // için alıyorum") kanalın gerçek sahibinin adı/telefonu üçüncü kişinin
      // bilgileriyle üzerine yazılır ve müşteri kimliği bozulur.
      const updates: Record<string, string> = {}
      if (contact_phone && !existingCustomer.contact_phone) updates.contact_phone = contact_phone
      if (
        customer_name &&
        customer_name !== 'Müşteri' &&
        (!existingCustomer.full_name || existingCustomer.full_name === 'Müşteri')
      ) {
        updates.full_name = customer_name
      }
      if (Object.keys(updates).length > 0) {
        await admin.from('customers').update(updates).eq('id', customerId)
      }
    }

    // Randevuyu fiilen alan kişi (customer_name/contact_phone), kanalın kayıtlı
    // sahibinden farklı olabilir (ör. "arkadaşım için alıyorum"). Personelin kim
    // geleceğini görebilmesi için bunu her zaman source_note'a ekle.
    const recipientNote = `Randevu alan: ${customer_name}${contact_phone ? ' (' + contact_phone + ')' : ''}`
    const combinedNote = [source_note, recipientNote].filter(Boolean).join(' | ')

    const { data: appointment, error: apptErr } = await admin
      .from('appointments')
      .insert({
        business_id: business.id,
        customer_id: customerId,
        service_id: service.id,
        employee_id: employeeId,
        created_by_user_id: null,
        scheduled_at: start.toISOString(),
        duration_minutes: duration,
        source: 'chatbot',
        source_note: combinedNote,
      })
      .select('id, scheduled_at')
      .single()

    if (apptErr || !appointment) throw new Error(apptErr?.message ?? 'Randevu oluşturulamadı')
    return appointment
  }

  // Istenen saat doluysa (ya da asagida rezervasyon aninda yarisdan kaybedilirse):
  // ileri dogru en yakin musait slotu ara (rezervasyon YAPMADAN oner). "from"
  // her iki cagri yerinde de MUSTERININ ASIL istedigi saat (requestedStart) —
  // bu yuzden burada "outside_hours" sebebini de HEP o asil istenen saate
  // gore hesapliyoruz, ileri dogru aranan aday saatlere gore degil.
  function findNextAvailable(from: Date) {
    const { dayOfWeek, hours, minutes } = istanbulParts(from)
    const startMin = hours * 60 + minutes
    const dayHours = eligibleDayHours(dayOfWeek, eligibleIds, schedules ?? [])
    const isOutsideHours =
      !dayHours || startMin < toMinutes(dayHours.starts_at) || startMin + duration > toMinutes(dayHours.ends_at)
    // dayHours null ise (o gun HICBIR uygun calisan mesaide degil), musteriye
    // "kapaliyiz" diyebilmek icin outsideHours'u yine de dolduruyoruz (saat
    // bilgisi olmadan) — aksi halde bu durum sessizce "null" olup mevcut
    // belirsiz "dolu ya da disinda olabilir" mesajina geri duserdi.
    const outsideHours = isOutsideHours ? (dayHours ?? { starts_at: null, ends_at: null }) : null

    const stepMs = SLOT_MINUTES * 60000
    // Eskiden arama "from + stepMs"'den baslayip stepMs araliklarla
    // ilerliyordu — musteri OLAGANDISI/yuvarlak-olmayan bir saat istediginde
    // (ör. "18:01") TUM onerilen alternatif saatler de AYNI tuhaf dakika
    // ofsetini (ör. "11:01") tasiyordu, cunku hep o ozgun saatten sabit
    // adimlarla ilerleniyordu (canli testte gozlemlendi, musteriye tuhaf/
    // profesyonelce gorunmeyen bir saat oneriliyordu). UTC epoch'ta stepMs'e
    // yuvarlamak Istanbul'un +3 sabit farkiyla da hizali kaliyor (3 saat = 6
    // adet 30dk'lik dilim, tam bolunuyor) — bu yuzden asagidaki yuvarlama
    // Istanbul yerel saatinde de dogru 00/30 dakika izgarasina denk gelir.
    const searchStart = new Date(Math.ceil((from.getTime() + 1) / stepMs) * stepMs)
    const searchEnd = new Date(from.getTime() + SEARCH_DAYS * 24 * 60 * 60000)
    for (let t = searchStart; t <= searchEnd; t = new Date(t.getTime() + stepMs)) {
      const found = eligibleIds.find((id) =>
        isAvailable(id, t, duration, schedules ?? [], appointments ?? [], timeBlocks ?? []),
      )
      if (found) {
        return json(
          {
            status: 'unavailable',
            suggestion: { scheduled_at: t.toISOString(), employee_name: profileName(found) },
            outside_hours: outsideHours,
          },
          200,
        )
      }
    }
    return json({ status: 'no_availability' }, 200)
  }

  // 1) Tam istenen saatte uygun calisan var mi?
  const availableNow = eligibleIds.find((id) =>
    isAvailable(id, requestedStart, duration, schedules ?? [], appointments ?? [], timeBlocks ?? []),
  )

  if (availableNow) {
    try {
      const appointment = await bookWith(availableNow, requestedStart)
      return json(
        {
          status: 'booked',
          appointment: {
            id: appointment.id,
            scheduled_at: appointment.scheduled_at,
            employee_name: profileName(availableNow),
            service_name: service.name,
          },
        },
        200,
      )
    } catch (e) {
      // Ayni calisan+saate iki musteri neredeyse ayni anda rezervasyon yaparsa,
      // veritabanindaki exclusion constraint bunlardan birini reddeder (ya da
      // Postgres bir deadlock tespit edip iptal eder). Bu durumda musteriye
      // teknik bir hata yerine, saat gercekten dolmus gibi normal "en yakin
      // uygun saat" akisini sun.
      const msg = String(e instanceof Error ? e.message : e)
      if (/exclusion|duplicate key|deadlock/i.test(msg)) {
        return findNextAvailable(requestedStart)
      }
      // Ham Postgres hatasi n8n uzerinden dogrudan musteriye WhatsApp/
      // Instagram mesaji olarak gidiyordu (Build Reply From Booking, ham
      // errMsg'i sorgusuzca gosteriyor) — artik burada temizleniyor.
      console.error('book-appointment insert error:', msg)
      return json({ error: 'Randevu oluşturulamadı, lütfen tekrar deneyin.' }, 500)
    }
  }

  return findNextAvailable(requestedStart)
})
