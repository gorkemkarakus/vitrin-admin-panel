// Serbest metinden randevu bilgisi cikaran ortak mantik. Hem panel icindeki
// "Hizli Yaz" formunu (parse-appointment-command, tek seferlik, taslak
// yok) HEM DE WhatsApp simulatorundeki cok turlu onay/duzeltme akisini
// (staff-whatsapp-webhook, mevcut taslagi baglam olarak veren) besliyor —
// prompt/tool semasi TEK yerde, iki fonksiyon arasinda kopyalanip
// birbirinden sapmasin diye.
export interface ExtractionService {
  id: string
  name: string
  duration_minutes: number
}
export interface ExtractionEmployee {
  id: string
  name: string
}
export interface ExtractedDraft {
  is_appointment_request: boolean
  service_id: string | null
  employee_id: string | null
  date: string | null
  time: string | null
  customer_name: string | null
  customer_phone: string | null
  unclear_fields: string[]
}

export const EXTRACTION_TOOL_NAME = 'extract_appointment_command'
const UNCLEAR_FIELD_VALUES = ['service_id', 'employee_id', 'date', 'time', 'customer_name', 'customer_phone'] as const

export function istanbulDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function buildExtractionSystemPrompt(opts: {
  today: string
  services: ExtractionService[]
  employees: ExtractionEmployee[]
  existingDraft?: ExtractedDraft | null
}): string {
  const { today, services, employees, existingDraft } = opts
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString('tr-TR', { weekday: 'long' })

  const serviceName = (id: string | null) => services.find((s) => s.id === id)?.name
  const employeeName = (id: string | null) => employees.find((e) => e.id === id)?.name

  const correctionBlock = existingDraft
    ? `\n\nDAHA ÖNCE ÜZERİNDE ÇALIŞILAN TASLAK (personel henüz onaylamadı, şimdi yeni bir mesaj yazdı):
- Hizmet: ${(existingDraft.service_id && serviceName(existingDraft.service_id)) || '(belirsiz)'}
- Çalışan: ${(existingDraft.employee_id && employeeName(existingDraft.employee_id)) || 'Fark etmez / belirtilmemiş'}
- Tarih: ${existingDraft.date || '(belirsiz)'}
- Saat: ${existingDraft.time || '(belirsiz)'}
- Müşteri adı: ${existingDraft.customer_name || '(belirsiz)'}
- Müşteri telefonu: ${existingDraft.customer_phone || '(belirtilmemiş)'}

Personelin yeni mesajı muhtemelen bu taslaktaki SADECE bir veya birkaç alanı düzeltiyor/tamamlıyor (ör. sadece saat değişikliği). YENİ mesajda açıkça değinilmeyen alanlar için taslaktaki eski değeri AYNEN koru — boş bırakma veya sıfırlama. Sadece yeni mesajın gerçekten değiştirdiği alanları güncelle.`
    : ''

  return `Sen bir kuaför/güzellik salonu personelinin serbest metinle yazdığı randevu komutlarını yapılandırılmış alanlara ayıran bir asistansın.

Bugünün tarihi: ${today} (${weekday}), İstanbul saatiyle.

Kurallar:
- is_appointment_request: Önce şunu karar ver — mesaj gerçekten bir randevu oluşturma isteği, mevcut taslağa yönelik bir düzeltme/tamamlama, ya da mevcut taslağı onaylama/iptal etme ifadesi mi ("evet", "onaylıyorum", "tamam", "iptal", "vazgeç" gibi)? Selamlaşma ("selam", "merhaba"), sohbet, teşekkür, şaka, tamamen alakasız bir istek ("şiir yaz", "hava nasıl" gibi) ise is_appointment_request'i false yap ve diğer TÜM alanları boş bırak, unclear_fields'i boş dizi yap. Randevuyla İLGİLİYSE true yap ve normal şekilde devam et.
- "yarın", "bugün", "salı günü", "gelecek hafta perşembe" gibi göreli ifadeleri bugünün tarihine göre YYYY-MM-DD formatında kesin bir tarihe çevir.
- Saat ifadelerini 24 saat formatında (HH:MM) yaz. "akşam 3" veya "akşam 3'te" gibi ifadeler NET şekilde 15:00 anlamına gelir — bunun için ek açıklama istemene gerek yok. "sabah/öğlen X" → X (öğleden önce), "akşam/gece X" (X 1-7 arası) → X+12. "3 buçuk" → :30. Saat belirtilmemişse veya gerçekten belirsizse time alanını boş bırak ve unclear_fields'e "time" ekle.
- service_id: Aşağıdaki hizmet listesinden isim benzerliğine göre (Türkçe karakter/büyük-küçük harf farkı gözetmeden) en uygun eşleşmeyi seç. Emin değilsen veya hiç hizmet belirtilmemişse boş bırak ve unclear_fields'e "service_id" ekle.
- employee_id: SADECE metinde açıkça bir çalışan adı geçiyorsa ve aşağıdaki listede eşleşiyorsa doldur. Metinde HİÇBİR çalışan adı geçmiyorsa employee_id'yi boş bırak VE unclear_fields'e KESİNLİKLE EKLEME — bu durum zaten "fark etmez" anlamına gelir, belirsizlik değildir. Bir isim geçtiği halde listede eşleşen yoksa boş bırak VE unclear_fields'e "employee_id" ekle. Bir isim hem müşteri hem çalışan gibi yorumlanabiliyorsa VARSAYILAN olarak müşteri adı say, employee_id'yi boş bırak (unclear_fields'e ekleme).
- customer_name: Müşterinin adını metinden çıkar. Belirtilmemişse boş bırak ve unclear_fields'e "customer_name" ekle.
- customer_phone: Sadece metinde açıkça bir telefon numarası varsa doldur, aksi halde boş bırak (unclear_fields'e ekleme, telefon opsiyoneldir).
- unclear_fields SADECE gerçekten belirsiz/çelişkili/eksik-ama-zorunlu alanlar içindir. Gereksiz yere alan ekleme.

Hizmetler:
${services.map((s) => `- id: ${s.id} | ad: ${s.name} | süre: ${s.duration_minutes} dk`).join('\n') || '(hizmet listesi boş)'}

Çalışanlar:
${employees.map((e) => `- id: ${e.id} | ad: ${e.name}`).join('\n') || '(çalışan listesi boş)'}${correctionBlock}`
}

function toolSchema() {
  return [
    {
      type: 'function' as const,
      function: {
        name: EXTRACTION_TOOL_NAME,
        description: 'Serbest metinden randevu bilgilerini yapılandırılmış alanlara ayır.',
        parameters: {
          type: 'object',
          properties: {
            is_appointment_request: {
              type: 'boolean',
              description: 'Mesaj bir randevu isteği veya taslağa düzeltme ise true, alakasız/sohbet ise false.',
            },
            service_id: { type: 'string', description: "Eşleşen hizmetin id'si, emin değilsen boş string." },
            employee_id: { type: 'string', description: "Eşleşen çalışanın id'si, belirtilmemişse boş string." },
            date: { type: 'string', description: 'YYYY-MM-DD formatında randevu tarihi.' },
            time: { type: 'string', description: 'HH:MM formatında (24 saat) randevu saati, belirsizse boş string.' },
            customer_name: { type: 'string', description: 'Müşterinin adı soyadı, belirtilmemişse boş string.' },
            customer_phone: { type: 'string', description: 'Müşterinin telefonu (sadece rakam), belirtilmemişse boş string.' },
            unclear_fields: {
              type: 'array',
              items: { type: 'string', enum: [...UNCLEAR_FIELD_VALUES] },
              description: 'Metinden net şekilde çıkarılamayan alanların listesi.',
            },
          },
          required: [
            'is_appointment_request',
            'date',
            'time',
            'service_id',
            'employee_id',
            'customer_name',
            'customer_phone',
            'unclear_fields',
          ],
        },
      },
    },
  ]
}

export async function extractAppointmentCommand(
  openaiKey: string,
  systemPrompt: string,
  userText: string,
): Promise<{ ok: true; draft: ExtractedDraft } | { ok: false; error: string; status: number }> {
  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      tool_choice: { type: 'function', function: { name: EXTRACTION_TOOL_NAME } },
      tools: toolSchema(),
    }),
  })

  if (!openaiRes.ok) {
    const errText = await openaiRes.text()
    console.error('OpenAI API hatası:', openaiRes.status, errText)
    return { ok: false, error: 'Komut ayrıştırılamadı, lütfen tekrar deneyin', status: 502 }
  }

  const openaiBody = await openaiRes.json()
  const choice = openaiBody?.choices?.[0]
  if (choice?.finish_reason === 'content_filter') {
    return { ok: false, error: 'Bu metin işlenemedi, lütfen farklı ifade edin', status: 422 }
  }

  const toolCall = choice?.message?.tool_calls?.[0] as { function?: { arguments?: string } } | undefined
  let input: Record<string, unknown> | null = null
  if (toolCall?.function?.arguments) {
    try {
      input = JSON.parse(toolCall.function.arguments)
    } catch {
      input = null
    }
  }
  if (!input) return { ok: false, error: 'Komut ayrıştırılamadı, lütfen tekrar deneyin', status: 502 }

  const asString = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const unclear = Array.isArray(input.unclear_fields)
    ? input.unclear_fields.filter((f): f is string => typeof f === 'string')
    : []

  return {
    ok: true,
    draft: {
      is_appointment_request: input.is_appointment_request !== false,
      service_id: asString(input.service_id) || null,
      employee_id: asString(input.employee_id) || null,
      date: asString(input.date) || null,
      time: asString(input.time) || null,
      customer_name: asString(input.customer_name) || null,
      customer_phone: asString(input.customer_phone) || null,
      unclear_fields: unclear,
    },
  }
}
