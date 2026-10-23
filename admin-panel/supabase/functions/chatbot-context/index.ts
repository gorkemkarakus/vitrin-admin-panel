import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { planHas } from '../_shared/plan.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { resolveBusiness } from '../_shared/resolveBusiness.ts'

// Musteri adi/telefonu gibi bilgiler sohbetin BASINDA verilip randevu cok
// sonra istenirse, dar bir limit bu bilgiyi baglam penceresinden dusurup
// botun tekrar sormasina yol aciyordu (test edildi: 13. mesajda 1. mesajdaki
// ad/telefon "unutuldu"). Limit genisletilerek bu risk pratikte ortadan
// kaldirildi.
const HISTORY_LIMIT = 60
// Bot yalnizca son 24 saatin konusmasini hatirlar: gunler onceki bir sohbet
// yeni talebi karistirmasin. Musterinin adi/telefonu customers kaydinda
// kaldigi icin ertesi gun tekrar sorulmaz.
const HISTORY_WINDOW_HOURS = 24

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  let body: { customer_phone?: string; phone_number_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const business = await resolveBusiness(admin, req, body.phone_number_id)
  if (!business) return json({ error: 'Geçersiz API anahtarı' }, 401)

  // Paket WhatsApp asistanini kapsamiyorsa bot cevap uretmez (OpenAI cagrilmaz).
  if (!(await planHas(admin, business.id, 'whatsapp_bot'))) {
    return json({ business_name: business.name, bot_paused: true, plan_blocked: true }, 200)
  }

  const { customer_phone } = body
  if (!customer_phone) return json({ error: 'customer_phone zorunlu' }, 400)

  const [{ data: services }, { data: customer }, { data: history }, { data: profiles }] = await Promise.all([
    admin
      .from('services')
      .select('id, name, price, duration_minutes, description')
      .eq('business_id', business.id)
      .eq('is_active', true),
    admin
      .from('customers')
      .select('id, full_name, contact_phone, bot_paused_until')
      .eq('business_id', business.id)
      .eq('phone', customer_phone)
      .maybeSingle(),
    admin
      .from('chatbot_messages')
      .select('role, content, created_at')
      .eq('business_id', business.id)
      .eq('customer_phone', customer_phone)
      .gte('created_at', new Date(Date.now() - HISTORY_WINDOW_HOURS * 3600000).toISOString())
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
    admin.from('profiles').select('id, full_name, gender').eq('business_id', business.id).eq('is_active', true),
  ])

  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]))
  const profileIds = (profiles ?? []).map((p) => p.id)

  let employees: { id: string; name: string; services: string[]; gender: string | null }[] = []
  if (profileIds.length > 0) {
    const { data: empSvcs } = await admin
      .from('employee_services')
      .select('profile_id, service_id')
      .in('profile_id', profileIds)

    employees = (profiles ?? []).map((p) => ({
      id: p.id,
      name: p.full_name ?? 'İsimsiz',
      services: (empSvcs ?? [])
        .filter((es) => es.profile_id === p.id)
        .map((es) => serviceNameById.get(es.service_id))
        .filter((s): s is string => !!s),
      // Calisanin kendi profilinde belirttigi GERCEK cinsiyet (kadin/erkek)
      // - NULL ise chatbot bunu "belirtilmemis" olarak gorup isim/unvana
      // bakip tahmin etme + kesin bilmiyorum uyarisi verme davranisina duser.
      gender: p.gender ?? null,
    }))
  }

  // Genel çalışma saatleri: tüm çalışanların programlarının birleşimi
  // (o gün en erken başlayan - en geç biten aralık) — işletmenin ayrı bir
  // "adres/çalışma saati" alanı yok, elimizdeki en iyi yaklaşık budur.
  let workingHours: { day: string; starts_at: string; ends_at: string }[] = []
  if (profileIds.length > 0) {
    const { data: schedules } = await admin
      .from('employee_schedules')
      .select('day_of_week, starts_at, ends_at')
      .in('profile_id', profileIds)

    const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
    const hoursByDay = new Map<number, { start: string; end: string }>()
    for (const s of schedules ?? []) {
      const existing = hoursByDay.get(s.day_of_week)
      if (!existing) {
        hoursByDay.set(s.day_of_week, { start: s.starts_at, end: s.ends_at })
      } else {
        if (s.starts_at < existing.start) existing.start = s.starts_at
        if (s.ends_at > existing.end) existing.end = s.ends_at
      }
    }
    workingHours = Array.from(hoursByDay.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, h]) => ({ day: dayNames[day], starts_at: h.start.slice(0, 5), ends_at: h.end.slice(0, 5) }))
  }

  // Musteri sohbetin cok basinda adini/telefonunu verip randevuyu cok sonra
  // isterse, LLM uzun bir sohbet gecmisi icinde bu bilgiyi "kacirabiliyor"
  // (test edildi: bilgi history'de vardı ama 13. mesajda LLM yine de tekrar
  // sordu). Bunu LLM'in aramasina birakmak yerine, kod ile taniyip prompta
  // one cikararak (asagida n8n tarafinda) bu riski azaltiyoruz.
  // \"telefonum\"/\"numaram\" gibi bir kendine-referans kelimesi zorunlu —
  // aksi halde \"arkadaşımın telefonu 0555...\" gibi baskasina ait bir
  // numarayi musterinin kendi numarasi sanma riski var (test edilip
  // dogrulandi).
  // "+90 555 222 33 44" gibi ULUSLARARASI format (WhatsApp'ta çok yaygın)
  // eskiden hiç eşleşmiyordu (sadece "0" veya çıplak "5" ile başlayan
  // formatı taniyordu) — test edilip dogrulandi, bu yuzden (?:\+?90|0)?
  // eklendi. "tel" kisaltmasi da eklendi — gercek bir konusmada "tel
  // 0555..." seklinde (tam "telefonum" degil) yazildigi ve o zaman hic
  // tespit edilmedigi test edilip dogrulandi. \\b ile sinirlanip "otel" gibi
  // kelimelerin icinde yanlislikla eslesmesi engelleniyor.
  const phoneRe = /(?:telefonum|numaram|\btel)\s*[:,]?\s*((?:\+?90|0)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/
  // SADECE \"adım\"/\"ismim\" kullanildi — bunlar dilbilgisel olarak KESIN
  // birinci-tekil-sahislik bildirir (\"benim adim\"). \"ben\" kaldirildi: \"ben
  // Zeynep Kaya ile geleceğim\" gibi cumlelerde baskasinin adini yanlislikla
  // musterinin kendi adi sanma riski test edildi ve dogrulandi, bu yuzden
  // kaldirildi.
  const nameRe = /(?:adım|ismim)\s*[:,]?\s+([A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+)+)/

  // EN YAYGIN gercek konusma deseni budur ama once atlanmisti: bot "Tam
  // adınızı alabilir miyim?" diye SORUNCA, musteri genelde "adım X" diye
  // TEKRAR tetikleyici kelime kullanmadan direkt "Ayşe Yılmaz" ya da direkt
  // "05551234567" diye CIPLAK cevap verir — yukaridaki nameRe/phoneRe bunu
  // HIC yakalamiyordu (test edilip dogrulandi: boyle bir cevap detected_*
  // alanlarinda hep null kaliyordu). Bunu duzeltmek icin, bir onceki
  // (assistant) mesajin ad/telefon SORUP sormadigina bakip, oyleyse
  // musterinin CIPLAK cevabini da (baska tetikleyici kelime olmadan) kabul
  // ediyoruz. Cok gevsek olmasin diye musterinin TUM mesaji (baska hicbir
  // sey icermeden) SADECE bir ad ya da SADECE bir telefon numarasi olmali —
  // "evet"/"tamam" gibi tek kucuk-harfli kelimeler veya baska cumleler bu
  // ^...$ ile sabitlenmis kaliplara uymaz.
  const askedForNameRe = /(tam ad|adınız|isminiz|ad soyad)/i
  const askedForPhoneRe = /(telefon numaranız|numaranız)/i
  const bareNameRe = /^([A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+)+)$/
  const barePhoneRe = /^((?:\+?90|0)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})$/
  // Musteri bot HEM ad HEM telefon istediginde ikisini TEK cevapta birlikte
  // yazabiliyor (ör. "Ayşe Yılmaz 05551234567") — yukaridaki bareNameRe/
  // barePhoneRe TUM mesajin SADECE biri olmasini sarttigi icin bu birlesik
  // hali HICBIRINE uymuyordu (test edilip dogrulandi). Ayrica musteri cevabin
  // sonuna nokta/unlem gibi noktalama da ekleyebiliyor (ör. "Ayşe Yılmaz.") —
  // bu da ^...$ ile tam eslesmeyi bozuyordu. Ikisini de duzeltmek icin: sondaki
  // noktalamayi once temizliyoruz, sonra ayrica "ad + telefon birlikte"
  // kalibini de deniyoruz.
  const bareNamePhoneRe = /^([A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+)+)\s+((?:\+?90|0)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})$/

  // History DB'den en yeniden en eskiye siralanmis geliyor (created_at DESC).
  // \"En son bahsedilen kazansin\" istedigimiz icin KRONOLOJIK (eskiden yeniye)
  // sirada gezip her eslesmede ustune yazmaliyiz — aksi halde en eski mesaj
  // \"kazanir\" (test edilip dogrulandi, bu yuzden .reverse() eklendi).
  let detectedPhone: string | null = null
  let detectedName: string | null = null
  const historyChron = (history ?? []).slice().reverse()
  for (let i = 0; i < historyChron.length; i++) {
    const h = historyChron[i]
    if (h.role !== 'user') continue
    const prev = i > 0 ? historyChron[i - 1] : null
    const trimmed = h.content.trim()
    const cleaned = trimmed.replace(/[.!?,]+$/, '')
    const askedName = !!prev && prev.role === 'assistant' && askedForNameRe.test(prev.content)
    const askedPhone = !!prev && prev.role === 'assistant' && askedForPhoneRe.test(prev.content)

    const combinedMatch = (askedName || askedPhone) && cleaned.match(bareNamePhoneRe)
    if (combinedMatch) {
      detectedName = combinedMatch[1]
      const digits = combinedMatch[2].replace(/\D/g, '')
      const validLen = digits.length === 10 || digits.length === 11 || (digits.length === 12 && digits.startsWith('90'))
      if (validLen) detectedPhone = digits
      continue
    }

    // phoneRe/nameRe eskiden .match() (global olmayan) ile TEK bir mesaj
    // icinde SADECE ILK eslesmeyi buluyordu — musteri ayni mesaj icinde
    // kendini duzeltirse (ör. "telefonum 0555111 değil telefonum 0555222")
    // ilk (yanlis) deger sessizce kullanilip customers tablosuna oyle
    // yaziliyordu (test edilip dogrulandi). matchAll ile TUM eslesmeleri
    // bulup mesajda EN SON geceni aliyoruz.
    const phoneMatches = [...h.content.matchAll(new RegExp(phoneRe.source, 'g'))]
    // "telefonum"/"numaram"/"tel" disinda, musteri cok sik SADECE "telefon X"
    // (iyelik eki olmadan, ör. "adım Ali, telefon 0555...") seklinde de
    // yaziyor — bu phoneRe'ye hic yakalanmiyordu (canli testte gozlemlendi:
    // boyle bir mesajdan SONRAKI bir mesajda musteri telefonu TEKRARLAMADAN
    // baska bir alani -saat/gun/calisan- duzeltince deterministik fallback
    // (n8n tarafindaki finalContactPhone) devreye giremiyor, LLM'in kendi
    // hafizasindan yeniden urettigi deger bazen bozuk oluyor ve
    // book-appointment'in ham telefon-format hatasi musteriye SIZIYORDU —
    // test edilip dogrulandi, birden fazla senaryoda tekrarlandi). Bare
    // "telefon" (iyelik eki YOK — "telefonu"/"telefonun" gibi 3. sahis
    // formlari degil, bunlar yapisal olarak zaten eslesmiyor) EKLEMEK
    // istiyoruz ama KOSULSUZ eklemek eskiden ozellikle KALDIRILMIS bir
    // riski geri getirir: "arkadaşımın telefonu 0555..." gibi BASKASINA ait
    // bir numarayi musterinin kendi numarasi sanma (bkz. yukarida phoneRe
    // yorumu). Bu yuzden bare "telefon"u SADECE ayni mesajda musterinin
    // "adım"/"ismim" ile KENDINI tanittigi (yani KESIN birinci-tekil-sahis
    // baglami kurulmus) durumlarda kabul ediyoruz — bu, gercek bug
    // raporlarindaki TUM orneklerle (ör. "adım X, telefon Y") birebir
    // ortuyor, ve "adım" gecmeyen (ör. sadece "arkadaşımın telefon
    // numarası...") mesajlarda hic devreye girmiyor. Ayni sebeple/ayni
    // guvenlik sartiyla "no"/"numara" (iyeliksiz, ör. "adım Ali, no
    // 0555..." / "iletişim no: 0555...") de eklendi — test edilip
    // dogrulandi, bu ikisi de "telefon" ile ayni acigi paylasiyordu.
    const hasSelfIntroAnchor = /(?:adım|ismim)/i.test(h.content)
    const bareTelefonMatches = hasSelfIntroAnchor
      ? [...h.content.matchAll(/\b(?:telefon|no|numara)\s*[:,]?\s*((?:\+?90|0)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/g)]
      : []
    const allPhoneMatches = [...phoneMatches, ...bareTelefonMatches].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    )
    if (allPhoneMatches.length > 0) {
      const digits = allPhoneMatches[allPhoneMatches.length - 1][1].replace(/\D/g, '')
      const validLen = digits.length === 10 || digits.length === 11 || (digits.length === 12 && digits.startsWith('90'))
      if (validLen) detectedPhone = digits
    } else if (askedPhone) {
      const bareMatch = cleaned.match(barePhoneRe)
      if (bareMatch) {
        const digits = bareMatch[1].replace(/\D/g, '')
        const validLen = digits.length === 10 || digits.length === 11 || (digits.length === 12 && digits.startsWith('90'))
        if (validLen) detectedPhone = digits
      }
    }

    // Ayni sinif hata isim icin de var, ustune bir de "pardon X değil Y" tarzi
    // "adım" tekrarlanmadan yapilan duzeltme de HIC yakalanmiyordu. Bu kalibi
    // KOSULSUZ eklemek riskli: "Salı değil Çarşamba" gibi isimle alakasiz bir
    // duzeltme de 2+ buyuk-harfli kelime icerebilir, yanlislikla isim
    // sanilabilir (n8n tarafinda ayni risk test edilip dogrulandi). Bu yuzden
    // "X değil Y" adayini SADECE X (tekli kelime) zaten "adım Z" kalibiyla
    // bilinen bir isim kelimesiyle eslesiyorsa kabul ediyoruz.
    const nameWordSrc = '[A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+(?:\\s+[A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+)+'
    const nameTriggerMatches = [...h.content.matchAll(new RegExp(nameRe.source, 'g'))]
    const knownNameWords = new Set<string>()
    for (const m of nameTriggerMatches) for (const w of m[1].split(/\s+/)) knownNameWords.add(w)
    const nameCorrectionMatches = [...h.content.matchAll(new RegExp('([A-ZÇĞİÖŞÜ][a-zçğıöşüİ]+)[\\s,]+(?:değil|hayır|yerine)\\s+(' + nameWordSrc + ')', 'g'))].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    )
    const validNameCorrections: { index: number; name: string }[] = []
    for (const m of nameCorrectionMatches) {
      if (knownNameWords.has(m[1])) {
        validNameCorrections.push({ index: m.index ?? 0, name: m[2] })
        for (const w of m[2].split(/\s+/)) knownNameWords.add(w)
      }
    }
    const nameCandidates = [
      ...nameTriggerMatches.map((m) => ({ index: m.index ?? 0, name: m[1] })),
      ...validNameCorrections,
    ].sort((a, b) => a.index - b.index)
    if (nameCandidates.length > 0) {
      detectedName = nameCandidates[nameCandidates.length - 1].name
    } else if (askedName) {
      const bareMatch = cleaned.match(bareNameRe)
      if (bareMatch) detectedName = bareMatch[1]
    }
  }

  // HISTORY_LIMIT sohbetin SADECE son N mesajini tarar — cok uzun sohbetlerde
  // (test edilip dogrulandi: 60+ mesajlik bir sohbette) musterinin en basta
  // verdigi ad/telefon bu pencereden tamamen dusebiliyor ve detectedName/
  // detectedPhone null donuyor, bot bilgiyi "unutmus" gibi davraniyor. Bunu
  // KALICI olarak cozmek icin, tespit edilir edilmez customers tablosuna
  // hemen (rezervasyon tamamlanmadan) yaziyoruz — book-appointment'taki
  // "set-once" mantiginin aynisi: SADECE eksik alanlari doldur, var olan
  // dogru bilgiyi asla ustune yazma. Boylece sonraki isteklerde sohbet
  // gecmisi ne kadar uzarsa uzasin bu bilgi customers tablosundan hep
  // okunabilir kalir.
  if (detectedName || detectedPhone) {
    if (!customer) {
      await admin.from('customers').insert({
        business_id: business.id,
        phone: customer_phone,
        full_name: detectedName ?? 'Müşteri',
        contact_phone: detectedPhone ?? null,
      })
    } else {
      // Buradaki regex ZATEN sadece "adım X"/"telefonum X" gibi dilbilgisel
      // olarak KESIN kendine-referans ifadelerini yakalıyor (bkz. yukarıdaki
      // phoneRe/nameRe yorumları) — yani musteri "aslında adım X degil Y"
      // diye kendi bilgisini DUZELTIRSE, bu yeni eslesme HER ZAMAN gecerli
      // kabul edilip guncellenmeli. "Sadece alan bossa doldur" kurali (asagida
      // book-appointment'ta kullanilan set-once mantigi) burada YANLIS olur —
      // musterinin kendi acik duzeltmesini yok sayip ILK (yanlis) degeri
      // korumus olur (test edilip dogrulandi, bu yuzden kosul kaldirildi).
      const updates: Record<string, string> = {}
      if (detectedName && detectedName !== customer.full_name) {
        updates.full_name = detectedName
      }
      if (detectedPhone && detectedPhone !== customer.contact_phone) {
        updates.contact_phone = detectedPhone
      }
      if (Object.keys(updates).length > 0) {
        await admin.from('customers').update(updates).eq('id', customer.id)
      }
    }
  }

  // Bot bugune kadar musterinin var olan randevularini HIC gormuyordu — tek
  // "randevu var mi" tespiti kendi gecmis mesajlarinda "Randevunuz
  // oluşturuldu ✅" cumlesini aramaktan ibaretti (kirilgan, id'siz). Iptal/
  // erteleme ozelligi icin LLM'e gercek, id'li bir liste veriliyor —
  // Turkce bicimlendirme burada YAPILMIYOR (services/working_hours'daki
  // aynı kural: ham veri edge function'dan, Turkce metin n8n'den).
  let appointments: { id: string; service_name: string | null; employee_name: string | null; scheduled_at: string }[] = []
  if (customer) {
    const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))
    const { data: upcoming } = await admin
      .from('appointments')
      .select('id, scheduled_at, service_id, employee_id')
      .eq('business_id', business.id)
      .eq('customer_id', customer.id)
      .in('status', ['bekliyor', 'onaylandi'])
      .gt('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
    appointments = (upcoming ?? []).map((a) => ({
      id: a.id,
      service_name: a.service_id ? (serviceNameById.get(a.service_id) ?? null) : null,
      employee_name: a.employee_id ? (profileNameById.get(a.employee_id) ?? null) : null,
      scheduled_at: a.scheduled_at,
    }))
  }

  // Salonun telefonu (aydinlatma metni ayarindaki iletisim telefonu) ve
  // onumuzdeki 60 gunun kapali gunleri. Bot telefon yerine yer tutucu
  // ("0555 XXX XX XX") veriyordu ve tatil gununu (ör. 29 Ekim) kendisi
  // onerebiliyordu; ikisi de canli testte goruldu.
  const todayIst = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + (3 * 60 + 60 * 24 * 60) * 60 * 1000).toISOString().slice(0, 10)
  const [{ data: notice }, { data: holidays }] = await Promise.all([
    admin.from('business_privacy_notices').select('contact_phone').eq('business_id', business.id).maybeSingle(),
    admin
      .from('business_holidays')
      .select('name, start_date, end_date, eve_closes_at')
      .eq('business_id', business.id)
      .gte('end_date', todayIst)
      .lte('start_date', horizon)
      .order('start_date'),
  ])

  const persistedName = customer?.full_name && customer.full_name !== 'Müşteri' ? customer.full_name : null
  const persistedPhone = customer?.contact_phone ?? null
  // Personel WhatsApp Coexistence uzerinden telefon uygulamasindan elle
  // devraldiginda bot ayni numaraya cevap yetistirmeye calisip ust uste
  // binen/celisen mesaj uretmesin diye n8n bu alani kontrol edip suresi
  // dolmamissa bot akisini (OpenAI/randevu/loglama) atlar.
  const botPaused = !!customer?.bot_paused_until && new Date(customer.bot_paused_until).getTime() > Date.now()

  return json(
    {
      business_name: business.name,
      customer_name: customer?.full_name ?? null,
      detected_full_name: detectedName ?? persistedName,
      detected_contact_phone: detectedPhone ?? persistedPhone,
      bot_paused: botPaused,
      services: (services ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        price: s.price,
        duration_minutes: s.duration_minutes,
        description: s.description ?? null,
      })),
      employees,
      working_hours: workingHours,
      business_phone: notice?.contact_phone ?? null,
      closed_days: (holidays ?? []).map((h) => ({
        name: h.name,
        start_date: h.start_date,
        end_date: h.end_date,
        eve_closes_at: h.eve_closes_at ? String(h.eve_closes_at).slice(0, 5) : null,
      })),
      appointments,
      history: (history ?? []).reverse().map((h) => ({ role: h.role, content: h.content })),
    },
    200,
  )
})
