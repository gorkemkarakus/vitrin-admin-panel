import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { resolveBusiness } from '../_shared/resolveBusiness.ts'
import { SLOT_MINUTES, isAvailable, rankEligibleByFairness } from '../_shared/availability.ts'
import { validateScheduledAt } from '../_shared/validation.ts'
import {
  buildExtractionSystemPrompt,
  extractAppointmentCommand,
  istanbulDateString,
  type ExtractedDraft,
} from '../_shared/appointmentExtraction.ts'

// Personelin WhatsApp'tan (şimdilik test-whatsapp-staff.html simülatöründen)
// yazdığı doğal dil komutlarıyla randevu oluşturmasını sağlayan, ÇOK TURLU
// (parse → özet göster → "evet"/düzeltme bekle → oluştur) uç nokta.
//
// Gerçek bir Supabase kullanıcı OTURUMU yok — kimlik gönderen telefon
// numarasından (profiles.whatsapp_phone) çözülüyor, tıpkı müşteri
// chatbot'unun customer_phone'a güvenmesi gibi (book-appointment). Bu yüzden
// --no-verify-jwt İLE deploy edilir. Bunu, sadece TELEFON NUMARASINI bilen
// herkesin (numara taranabilir/tahmin edilebilir) bu uc noktayi cagirip o
// personel adina randevu olusturmasina/numara enumerate etmesine acmamak
// icin, book-appointment ile AYNI x-api-key/resolveBusiness sarti burada da
// zorunlu — sadece n8n'in bildigi gizli anahtari bilen cagirabilir.
//
// Simülatörden gerçek WhatsApp'a geçişte DEĞİŞMESİ GEREKEN TEK ŞEY: bu
// fonksiyonu {phone, message} ile çağıran taraf (şimdi statik HTML sayfası,
// o zaman n8n/Meta webhook'u) — fonksiyonun kendisi hiç değişmez.
const ROTATION_SOURCES = ['chatbot', 'online_randevu', 'kullanici_uzerinden']

// Telefon klavyeleri/otomatik duzeltme "ı" yerine kolayca "i" yazdirabiliyor
// (ör. "onaylıyorum" -> "onayliyorum"), bu yuzden tam regex eslesmesi yerine
// once Turkce karakterleri sadelestirip SONRA 1 harflik yazim hatasina kadar
// tolere ediyoruz — kullanicinin "hafif yazim yanlisinda da anlasin" istegi.
function turkishFold(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

const CONFIRM_WORDS = ['evet', 'onayla', 'onayliyorum', 'onaylandi', 'tamam', 'olur', 'ok', 'okey', 'yes', 'aynen', 'kesinlikle']
const CANCEL_WORDS = ['hayir', 'olmaz', 'iptal', 'vazgec', 'no', 'gecelim', 'birak']

function matchesIntent(message: string, words: string[]): boolean {
  const firstWord = turkishFold(message).split(/\s+/)[0] ?? ''
  if (!firstWord) return false
  return words.some((w) => firstWord === w || levenshtein(firstWord, w) <= 1)
}

interface RequestBody {
  phone?: string
  message?: string
  // Mesajin geldigi isletme WhatsApp numarasinin Meta kimligi: x-bot-secret
  // ile birlikte gelirse isletme bundan bulunur (cok salonlu kullanim).
  phone_number_id?: string
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('90') ? digits : digits.startsWith('0') ? '9' + digits : '90' + digits
}

const REQUIRED_FIELDS = ['service_id', 'date', 'time', 'customer_name'] as const

// "hangi hizmet net değil" gibi belirsiz bir soru, personelin anlaşılmadığını
// düşünmesine yol açıyordu — oysa çoğu zaman sistem tam olarak ne istendiğini
// ANLADI, sadece o hizmet/çalışan bu işletmede TANIMLI DEĞİL. Her alan için
// SOMUT bir ipucu (mevcut seçenekleri listeleyen) döndürüyoruz.
function missingFieldHint(
  field: string,
  services: { name: string }[],
  employees: { full_name: string | null }[],
): string {
  switch (field) {
    case 'service_id':
      return services.length > 0
        ? `Hangi hizmet? Sunduğumuz hizmetler: ${services.map((s) => s.name).join(', ')}.`
        : 'Hangi hizmet? (Sistemde tanımlı aktif hizmet bulunamadı.)'
    case 'employee_id':
      return employees.length > 0
        ? `Belirttiğiniz çalışan bulunamadı. Çalışanlarımız: ${employees.map((e) => e.full_name).filter(Boolean).join(', ')} (ya da "fark etmez" diyebilirsiniz).`
        : 'Belirttiğiniz çalışan bulunamadı.'
    case 'date':
      return 'Hangi tarih?'
    case 'time':
      return 'Hangi saat?'
    case 'customer_name':
      return 'Müşterinin adı ne?'
    default:
      return field
  }
}

function draftSummaryText(draft: ExtractedDraft, serviceName: string | null, employeeName: string | null): string {
  const lines = [
    `Hizmet: ${serviceName ?? '(belirsiz)'}`,
    `Çalışan: ${employeeName ?? 'Fark etmez'}`,
    `Tarih: ${draft.date ?? '(belirsiz)'}`,
    `Saat: ${draft.time ?? '(belirsiz)'}`,
    `Müşteri: ${draft.customer_name ?? '(belirsiz)'}${draft.customer_phone ? ' — ' + draft.customer_phone : ''}`,
  ]
  return lines.join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) return json({ error: 'Yapay zeka servisi yapılandırılmamış' }, 500)

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const rawPhone = (body.phone ?? '').trim()
  const message = (body.message ?? '').trim()
  if (!rawPhone || !message) return json({ error: 'phone ve message zorunlu' }, 400)
  const phone = normalizePhone(rawPhone)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const business = await resolveBusiness(admin, req, body.phone_number_id)
  if (!business) return json({ error: 'Geçersiz API anahtarı' }, 401)

  const { data: staff } = await admin
    .from('profiles')
    .select('id, business_id, full_name')
    .eq('whatsapp_phone', phone)
    .eq('business_id', business.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!staff) {
    // handled:false — n8n'deki tek-numaralı WhatsApp yonlendirmesi bu
    // isareti gorunce musteri botuna (01-akilli-chatbot.json) devrediyor;
    // buradaki "reply" SADECE bu fonksiyonun dogrudan cagrildigi bagimsiz
    // test sayfasinda (test-whatsapp-staff.html) kullaniliyor.
    return json(
      { handled: false, reply: 'Bu numara sistemde tanımlı değil. İşletme yöneticinizle iletişime geçin.' },
      200,
    )
  }

  // Kayitli bir numarayi ogrenen biri sinirsiz istek atip her seferinde
  // gercek paraya mal olan OpenAI cagrisi tetiklemesin diye saatte 20
  // mesajla sinirlandiriliyor (public-book-appointment'taki rate-limit ile
  // ayni desen).
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await admin.from('staff_whatsapp_attempts').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  const { count: recentAttempts } = await admin
    .from('staff_whatsapp_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .gte('created_at', oneHourAgo)
  if ((recentAttempts ?? 0) >= 20) {
    return json({ handled: true, reply: 'Çok fazla mesaj gönderildi, lütfen bir süre sonra tekrar deneyin.' }, 200)
  }
  await admin.from('staff_whatsapp_attempts').insert({ phone })

  const { data: businessRow } = await admin.from('businesses').select('name').eq('id', staff.business_id).maybeSingle()
  const businessName = businessRow?.name ?? 'işletmeniz'

  const { data: session } = await admin
    .from('staff_command_sessions')
    .select('draft')
    .eq('phone', phone)
    .maybeSingle()
  const existingDraft = (session?.draft ?? null) as ExtractedDraft | null

  if (existingDraft && matchesIntent(message, CANCEL_WORDS)) {
    await admin.from('staff_command_sessions').delete().eq('phone', phone)
    return json({ handled: true, reply: 'İptal edildi. Yeni bir randevu için tekrar yazabilirsin.' }, 200)
  }

  if (existingDraft && matchesIntent(message, CONFIRM_WORDS)) {
    return await handleConfirm(admin, phone, staff, existingDraft)
  }

  // Yeni komut ya da mevcut taslağa düzeltme — ikisi de ayni kod yolu, tek
  // fark existingDraft'in prompt'a baglam olarak eklenip eklenmemesi.
  const { data: services } = await admin
    .from('services')
    .select('id, name, duration_minutes')
    .eq('business_id', staff.business_id)
    .eq('is_active', true)
  const { data: employees } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('business_id', staff.business_id)
    .eq('is_active', true)

  const today = istanbulDateString(new Date())
  const systemPrompt = buildExtractionSystemPrompt({
    today,
    services: (services ?? []).map((s) => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes })),
    employees: (employees ?? []).map((e) => ({ id: e.id, name: e.full_name ?? '' })),
    existingDraft,
  })

  const result = await extractAppointmentCommand(openaiKey, systemPrompt, message)
  if (!result.ok) return json({ handled: true, reply: result.error }, 200)

  if (!result.draft.is_appointment_request) {
    if (existingDraft) {
      const oldServiceName = (services ?? []).find((s) => s.id === existingDraft.service_id)?.name ?? null
      const oldEmployeeName = (employees ?? []).find((e) => e.id === existingDraft.employee_id)?.full_name ?? null
      return json(
        {
          handled: true,
          reply: `Anlayamadım. Az önce üzerinde durduğumuz taslak hâlâ duruyor:\n${draftSummaryText(existingDraft, oldServiceName, oldEmployeeName)}\n\nOnaylamak için "evet", vazgeçmek için "iptal" yazabilirsin.`,
        },
        200,
      )
    }
    return json(
      {
        handled: true,
        reply: `Merhaba! Buradan sadece ${businessName} için randevu oluşturabilirsiniz. Randevu bilgisini yazarsanız yardımcı olurum (ör. "yarın 15:00 manikür, müşteri Ayşe").`,
      },
      200,
    )
  }

  await admin
    .from('staff_command_sessions')
    .upsert({ phone, business_id: staff.business_id, profile_id: staff.id, draft: result.draft })

  const missing = REQUIRED_FIELDS.filter((f) => result.draft.unclear_fields.includes(f))
  const employeeUnclear = result.draft.unclear_fields.includes('employee_id')
  const serviceName = (services ?? []).find((s) => s.id === result.draft.service_id)?.name ?? null
  const employeeName = (employees ?? []).find((e) => e.id === result.draft.employee_id)?.full_name ?? null
  const summary = draftSummaryText(result.draft, serviceName, employeeName)

  if (missing.length > 0) {
    const hints = missing.map((f) => missingFieldHint(f, services ?? [], employees ?? []))
    return json({ handled: true, reply: `Şunu anladım:\n${summary}\n\n${hints.join('\n')}` }, 200)
  }

  // service_id/date/time/customer_name tamam ama belirtilen çalışan
  // bulunamadıysa: onay akışını ENGELLEME (fark etmez geçerlidir), ama
  // sessizce "Fark etmez"e düşmek yerine neden bulunamadığını da söyle.
  const employeeNote = employeeUnclear ? `\n\n${missingFieldHint('employee_id', services ?? [], employees ?? [])}` : ''

  return json(
    {
      handled: true,
      reply: `Şunu anladım:\n${summary}${employeeNote}\n\nOnaylıyor musun? "Evet" yaz, ya da neyin değişmesini istediğini söyle.`,
    },
    200,
  )
})

async function handleConfirm(
  admin: SupabaseClient,
  phone: string,
  staff: { id: string; business_id: string; full_name: string | null },
  draft: ExtractedDraft,
): Promise<Response> {
  if (!draft.service_id || !draft.date || !draft.time || !draft.customer_name) {
    return json({ handled: true, reply: 'Eksik bilgiler var, önce onları tamamlamamız lazım.' }, 200)
  }

  // book-appointment/public-book-appointment gecmis/gecersiz tarihi burada
  // reddediyor, bu uc nokta etmiyordu — LLM'in yanlislikla gecmis bir tarihi
  // "anladigi" durumlarda randevu sessizce olusuyordu.
  const scheduledAtError = validateScheduledAt(`${draft.date}T${draft.time}:00+03:00`)
  if (scheduledAtError) {
    return json(
      { handled: true, reply: 'Bu tarih/saat geçerli değil (geçmiş bir zaman olabilir), doğru tarih ve saati tekrar yazar mısın?' },
      200,
    )
  }

  const { data: service } = await admin
    .from('services')
    .select('id, name, duration_minutes')
    .eq('business_id', staff.business_id)
    .eq('id', draft.service_id)
    .eq('is_active', true)
    .maybeSingle()
  if (!service) {
    await admin.from('staff_command_sessions').delete().eq('phone', phone)
    return json({ handled: true, reply: 'Bu hizmet artık bulunamadı, lütfen komutu tekrar yaz.' }, 200)
  }
  const duration = service.duration_minutes ?? SLOT_MINUTES

  const { data: activeProfiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('business_id', staff.business_id)
    .eq('is_active', true)

  // Bir hizmete hic kimse atanmamissa (bkz. Ekip sayfasi "Verebildigi
  // Hizmetler") o hizmete kimse randevu alamaz — kasitli, fallback yok.
  const { data: empSvcs } = await admin.from('employee_services').select('profile_id').eq('service_id', service.id)
  const assignedIds = new Set((empSvcs ?? []).map((e) => e.profile_id))
  let eligibleIds = (activeProfiles ?? []).map((p) => p.id).filter((id) => assignedIds.has(id))
  if (draft.employee_id) {
    if (!eligibleIds.includes(draft.employee_id)) {
      return json(
        { handled: true, reply: 'Belirttiğin çalışan bu hizmeti verebilecek alanda değil, başka biri veya "fark etmez" der misin?' },
        200,
      )
    }
    eligibleIds = [draft.employee_id]
  }
  if (eligibleIds.length === 0) {
    return json({ handled: true, reply: 'Bu hizmeti verebilecek çalışan tanımlı değil.' }, 200)
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
    .eq('business_id', staff.business_id)
    .neq('status', 'iptal')

  eligibleIds = rankEligibleByFairness(eligibleIds, appointments ?? [], ROTATION_SOURCES)

  const requestedStart = new Date(`${draft.date}T${draft.time}:00+03:00`)
  const chosenEmployee = eligibleIds.find((id) =>
    isAvailable(id, requestedStart, duration, schedules ?? [], appointments ?? [], timeBlocks ?? []),
  )
  if (!chosenEmployee) {
    return json({ handled: true, reply: 'Bu saatte uygun çalışan yok. Başka bir saat der misin?' }, 200)
  }

  try {
    let customerId: string | undefined
    const phoneDigits = draft.customer_phone?.replace(/\D/g, '') || null

    if (phoneDigits) {
      const { data: existing } = await admin
        .from('customers')
        .select('id')
        .eq('business_id', staff.business_id)
        .eq('phone', phoneDigits)
        .maybeSingle()
      customerId = existing?.id
    }
    if (!customerId) {
      const { data: byName } = await admin
        .from('customers')
        .select('id')
        .eq('business_id', staff.business_id)
        .ilike('full_name', draft.customer_name)
        .maybeSingle()
      customerId = byName?.id
    }
    if (!customerId) {
      const { data: newCustomer, error: custErr } = await admin
        .from('customers')
        .insert({ business_id: staff.business_id, full_name: draft.customer_name, phone: phoneDigits })
        .select('id')
        .single()
      if (custErr || !newCustomer) throw new Error(custErr?.message ?? 'Müşteri oluşturulamadı')
      customerId = newCustomer.id
    }

    const { error: apptErr } = await admin.from('appointments').insert({
      business_id: staff.business_id,
      customer_id: customerId,
      service_id: service.id,
      employee_id: chosenEmployee,
      created_by_user_id: staff.id,
      scheduled_at: requestedStart.toISOString(),
      duration_minutes: duration,
      source: 'kullanici_uzerinden',
      source_note: 'WhatsApp (personel)',
    })
    if (apptErr) throw new Error(apptErr.message)

    await admin.from('staff_command_sessions').delete().eq('phone', phone)

    const employeeName = (activeProfiles ?? []).find((p) => p.id === chosenEmployee)?.full_name ?? 'atanan çalışan'
    return json(
      { handled: true, reply: `Randevu oluşturuldu ✅ ${service.name}, ${draft.date} ${draft.time} — ${employeeName}.` },
      200,
    )
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    if (/exclusion|duplicate key|deadlock|mesaide değil/i.test(msg)) {
      return json({ handled: true, reply: 'Az önce bu saat başka bir randevuyla doldu. Başka bir saat der misin?' }, 200)
    }
    console.error('staff-whatsapp-webhook randevu hatası:', msg)
    return json({ handled: true, reply: 'Randevu oluşturulamadı, lütfen tekrar dene.' }, 200)
  }
}
