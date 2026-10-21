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

export async function runChatbot(input: ChatbotInput, deps: ChatbotDeps): Promise<ChatbotResult> {
  const f = deps.fetch ?? fetch
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

  // Personel numarasi: kendi komut asistani cevaplar.
  const staff = await fn(
    'staff-whatsapp-webhook',
    { phone: input.from, message: input.message, phone_number_id: input.phone_number_id },
    15000,
  )
  if (staff.handled === true) {
    return { reply: typeof staff.reply === 'string' ? staff.reply : '', log: noLog }
  }

  const context = await fn(
    'chatbot-context',
    { customer_phone: input.from, phone_number_id: input.phone_number_id },
    15000,
  )
  outputs['Get Context'] = context
  // Personel elle devraldiysa ya da numara bir isletmeye bagli degilse bot susar.
  if (context.bot_paused === true || !context.business_name) return { reply: '', log: noLog }

  const openaiRequest = run('Build OpenAI Request', flow.buildOpenAIRequest as Step, context)
  const openaiResponse = await postJson(
    f,
    'https://api.openai.com/v1/chat/completions',
    { Authorization: `Bearer ${deps.openaiKey}` },
    openaiRequest,
    30000,
    false,
  )
  const parsed = run('Parse OpenAI Response', flow.parseOpenAIResponse as Step, openaiResponse)

  let replyStep: Json
  if (parsed.hasToolCall !== true) {
    replyStep = run('Build Reply From Chat', flow.buildReplyFromChat as Step, parsed)
  } else if (parsed.toolName === 'cancel_appointment') {
    const req = run('Build Cancel Request', flow.buildCancelRequest as Step, parsed)
    const result = await fn('cancel-appointment', req, 15000, true)
    replyStep = run('Build Reply From Cancel', flow.buildReplyFromCancel as Step, result)
  } else if (parsed.toolName === 'reschedule_appointment') {
    const req = run('Build Reschedule Request', flow.buildRescheduleRequest as Step, parsed)
    const result = await fn('reschedule-appointment', req, 15000, true)
    replyStep = run('Build Reply From Reschedule', flow.buildReplyFromReschedule as Step, result)
  } else {
    const req = run('Build Booking Request', flow.buildBookingRequest as Step, parsed)
    const result = await fn('book-appointment', req, 15000, true)
    replyStep = run('Build Reply From Booking', flow.buildReplyFromBooking as Step, result)
  }

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
