// Musteri asistani: gelen WhatsApp mesajina cevap uretir. Eskiden n8n'deki
// "01-akilli-chatbot" akisi yapiyordu; ayni sira burada, adimlarin kodu
// chatbotFlow.js'te (n8n'den aynen). Randevu alma/iptal/degistirme, baglam ve
// mesaj kaydi yine kendi fonksiyonlarinda; buradan x-bot-secret ile cagrilir.
//
// Akis (n8n ile ayni):
//   staff-whatsapp-webhook -> personel ise onun cevabi
//   chatbot-context        -> bot susturulmus / isletme yoksa bos cevap
//   OpenAI                 -> arac cagrisi yoksa sohbet cevabi
//                          -> cancel / reschedule / book fonksiyonu + cevap
//   chatbot-log-message    -> musteri mesaji + cevap kaydi
import * as flow from './chatbotFlow.js'

export interface ChatbotInput {
  business_id: string
  phone_number_id: string | null
  from: string
  customer_name: string | null
  message: string
  wamid: string
}

export interface ChatbotDeps {
  supabaseUrl: string
  anonKey: string
  botSecret: string
  openaiKey: string
  fetch?: typeof fetch
  // Ayni surecte calisan isleyiciler (whatsapp-webhook verir): bot
  // fonksiyonlarina giden istekler HTTP'ye cikmadan bunlara gider. Her ayri
  // fonksiyon cagrisi ag yolculugu + soguk baslatma ekliyordu; canlida cevap
  // 25-30 sn suruyordu, botun kendi isi ~4 sn.
  handlers?: Record<string, (req: Request) => Promise<Response>>
}

export interface ChatbotResult {
  // bos ise musteriye bir sey gonderilmez (personel devraldi / isletme yok)
  reply: string
  // cevap kaydi; gonderimle ayni anda beklenir
  log: Promise<void>
}

type Json = Record<string, unknown>
type Step = ($: (name: string) => { item: { json: Json } }, $json: Json) => { json: Json }[]

// n8n'deki http istegi: hata kodunda durur (neverError: false) ya da hata
// cevabini da adimin ciktisi sayar (neverError: true, randevu fonksiyonlari).
async function postJson(
  f: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  neverError: boolean,
): Promise<Json> {
  const res = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok && !neverError) throw new Error(`${url} HTTP ${res.status}`)
  return ((await res.json().catch(() => ({}))) ?? {}) as Json
}

// Musteri "saat 1'de" yazinca model saati 01:00 alabiliyor; oysa musteri
// neredeyse her zaman 13:00'u kastediyor ve gece randevusu yok. Musteri
// 01:00-07:59'u acikca yazmadikca ("01:30", "gece 1", "sabah 7") randevu
// acilmaz, once sorulur; "evet" derse model sohbet gecmisinden 13:00'la devam
// eder. (Bot talimatindaki b2 kurali ayni seyi soyler; bu, modelin yine de
// 01:00'la denemesine karsi kilit.)
export function askAboutEarlyHour(parsed: Json, message: string, context: Json): string | null {
  const args = (parsed.toolArgs ?? {}) as Record<string, unknown>
  const time = String((parsed.toolName === 'reschedule_appointment' ? args.new_time : args.time) ?? '')
  const m = time.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const hour = Number(m[1])
  if (hour < 1 || hour > 7) return null
  const history = Array.isArray(context.history) ? (context.history as { role?: string; content?: unknown }[]) : []
  const customerText = [message, ...history.filter((h) => h.role === 'user').map((h) => String(h.content ?? ''))]
    .join('\n')
    .toLocaleLowerCase('tr')
  // tarih ("1.11.2026") saat sanilmasin diye noktadan sonra rakam gelmemeli
  const writtenExactly = new RegExp(`(^|[^\\d])0?${hour}[:.][0-5]\\d(?![.\\d])`).test(customerText)
  const saidNightOrMorning = /(^|[^a-zçğıöşü])(gece|sabah)/.test(customerText)
  if (writtenExactly || saidNightOrMorning) return null
  return earlyHourQuestionText(hour, m[2])
}

// "Öğlen 1, yani 13:00 uygun mu?" — insanlarin konustugu gibi; saate ek
// gerekmesin diye soru "uygun mu" ile biter.
export function earlyHourQuestionText(hour: number, minute: string): string {
  const part = hour <= 2 ? 'Öğlen' : hour <= 5 ? 'Öğleden sonra' : 'Akşam'
  const spoken = minute === '00' ? String(hour) : `${hour}:${minute}`
  return `${part} ${spoken}, yani ${hour + 12}:${minute} uygun mu?`
}

export async function runChatbot(input: ChatbotInput, deps: ChatbotDeps): Promise<ChatbotResult> {
  const baseFetch = deps.fetch ?? fetch
  const prefix = `${deps.supabaseUrl}/functions/v1/`
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const local = u.startsWith(prefix) ? deps.handlers?.[u.slice(prefix.length)] : undefined
    return local ? local(new Request(u, init)) : baseFetch(url, init)
  }) as typeof fetch
  const outputs: Record<string, Json> = { Webhook: { body: { ...input } } }
  const $ = (name: string) => {
    if (!(name in outputs)) throw new Error(`chatbot: "${name}" adimi henuz calismadi`)
    return { item: { json: outputs[name] } }
  }
  const run = (name: string, step: Step, $json: Json): Json => {
    const result = step($, $json)[0].json
    outputs[name] = result
    return result
  }
  const fn = (name: string, body: unknown, timeoutMs: number, neverError = false) =>
    postJson(
      f,
      `${deps.supabaseUrl}/functions/v1/${name}`,
      { Authorization: `Bearer ${deps.anonKey}`, apikey: deps.anonKey, 'x-bot-secret': deps.botSecret },
      body,
      timeoutMs,
      neverError,
    )
  const noLog = Promise.resolve()
  // adim sureleri (ms): cevabin nerede geciktigi loglarda gorunsun
  const started = Date.now()
  const timings: Record<string, number> = {}
  const timed = async <T>(name: string, p: Promise<T>): Promise<T> => {
    const t = Date.now()
    try {
      return await p
    } finally {
      timings[name] = Date.now() - t
    }
  }
  const logTimings = (path: string) =>
    console.log('chatbot: süreler', { path, ...timings, toplam: Date.now() - started, wamid: input.wamid })

  // Personel kontrolu ve musteri baglami birbirinden bagimsiz: ayni anda
  // istenir (n8n'de sirayla gidiyordu). Personel ise baglam kullanilmaz.
  const contextPromise = timed(
    'baglam',
    fn('chatbot-context', { customer_phone: input.from, phone_number_id: input.phone_number_id }, 15000),
  )
  contextPromise.catch(() => {}) // personel dalinda beklenmezse yakalanmamis hata olmasin
  const staff = await timed(
    'personel',
    fn('staff-whatsapp-webhook', { phone: input.from, message: input.message, phone_number_id: input.phone_number_id }, 15000),
  )
  if (staff.handled === true) {
    logTimings('personel')
    return { reply: typeof staff.reply === 'string' ? staff.reply : '', log: noLog }
  }

  const context = await contextPromise
  outputs['Get Context'] = context
  // Personel elle devraldiysa ya da numara bir isletmeye bagli degilse bot susar.
  if (context.bot_paused === true || !context.business_name) return { reply: '', log: noLog }

  const openaiRequest = run('Build OpenAI Request', flow.buildOpenAIRequest as Step, context)
  const openaiResponse = await timed(
    'openai',
    postJson(f, 'https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${deps.openaiKey}` }, openaiRequest, 30000, false),
  )
  const parsed = run('Parse OpenAI Response', flow.parseOpenAIResponse as Step, openaiResponse)
  const earlyHourQuestion = parsed.hasToolCall === true ? askAboutEarlyHour(parsed, input.message, context) : null

  let replyStep: Json
  if (earlyHourQuestion) {
    replyStep = { reply: earlyHourQuestion, customer_phone: input.from, message: input.message }
  } else if (parsed.hasToolCall !== true) {
    replyStep = run('Build Reply From Chat', flow.buildReplyFromChat as Step, parsed)
  } else if (parsed.toolName === 'cancel_appointment') {
    const req = run('Build Cancel Request', flow.buildCancelRequest as Step, parsed)
    const result = await timed('islem', fn('cancel-appointment', req, 15000, true))
    replyStep = run('Build Reply From Cancel', flow.buildReplyFromCancel as Step, result)
  } else if (parsed.toolName === 'reschedule_appointment') {
    const req = run('Build Reschedule Request', flow.buildRescheduleRequest as Step, parsed)
    const result = await timed('islem', fn('reschedule-appointment', req, 15000, true))
    replyStep = run('Build Reply From Reschedule', flow.buildReplyFromReschedule as Step, result)
  } else {
    const req = run('Build Booking Request', flow.buildBookingRequest as Step, parsed)
    const result = await timed('islem', fn('book-appointment', req, 15000, true))
    replyStep = run('Build Reply From Booking', flow.buildReplyFromBooking as Step, result)
  }

  logTimings(earlyHourQuestion ? 'saat-sorusu' : String(parsed.toolName ?? 'sohbet'))
  const reply = typeof replyStep.reply === 'string' ? replyStep.reply : ''
  const log = fn(
    'chatbot-log-message',
    {
      customer_phone: replyStep.customer_phone,
      phone_number_id: input.phone_number_id,
      messages: [
        { role: 'user', content: replyStep.message },
        { role: 'assistant', content: replyStep.reply },
      ],
    },
    10000,
  ).then(
    () => undefined,
    (e) => console.error('chatbot: mesaj kaydi basarisiz:', e instanceof Error ? e.message : e, 'wamid:', input.wamid),
  )
  return { reply, log }
}
