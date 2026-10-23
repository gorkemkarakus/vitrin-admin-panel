// Musteri asistaninin akis sirasi: her dal sahte cevaplarla denenir (OpenAI
// ve veritabanina gercek istek gitmez). Calistir:
//   deno test supabase/functions/_shared/chatbot.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { askForSurname, earlyHourQuestionText, misreadCustomerName, runChatbot, type ChatbotInput } from './chatbot.ts'
import { isConfirmationMessage } from './chatbotFlow.js'
import { isBusinessScopedUserId } from './notify.ts'

const BASE = 'https://ornek.supabase.co'
const input: ChatbotInput = {
  business_id: 'biz-1',
  phone_number_id: 'pn-1',
  from: '905321112233',
  customer_name: 'Ayşe',
  message: 'Merhaba',
  wamid: 'wamid.1',
}

const context = {
  business_name: 'Güzel Salon',
  bot_paused: false,
  services: [{ name: 'Fön', duration_minutes: 30, price: 250 }],
  employees: [{ name: 'Elif Yılmaz', services: ['Fön'] }],
  working_hours: [{ day: 'Pazartesi', starts_at: '09:00', ends_at: '18:00' }],
  appointments: [
    { id: 'apt-1', service_name: 'Fön', scheduled_at: '2026-10-23T11:00:00Z', employee_name: 'Elif Yılmaz' },
  ],
  history: [],
}

interface Call {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

// fonksiyon adina / OpenAI'ye gore sahte cevap doner, cagrilari kaydeder
function fakeFetch(routes: Record<string, unknown>, calls: Call[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const body = JSON.parse(String(init?.body ?? '{}'))
    calls.push({ url: u, headers: init?.headers as Record<string, string>, body })
    const key = u.includes('openai.com') ? 'openai' : u.split('/functions/v1/')[1]
    if (!(key in routes)) throw new Error('beklenmeyen istek: ' + u)
    return new Response(JSON.stringify(routes[key]), { status: 200 })
  }) as typeof fetch
}

const deps = (f: typeof fetch) => ({ supabaseUrl: BASE, anonKey: 'anon', botSecret: 'gizli', openaiKey: 'sk-test', fetch: f })

const openaiText = (content: string) => ({ choices: [{ message: { content } }] })
const openaiTool = (name: string, args: Record<string, unknown>) => ({
  choices: [{ message: { content: null, tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }],
})

Deno.test('personel numarasi: komut asistaninin cevabi doner, musteri asistani calismaz', async () => {
  const calls: Call[] = []
  const r = await runChatbot(
    input,
    deps(fakeFetch({ 'staff-whatsapp-webhook': { handled: true, reply: 'Bugün 3 randevun var' }, 'chatbot-context': context }, calls)),
  )
  assertEquals(r.reply, 'Bugün 3 randevun var')
  assert(!calls.some((c) => c.url.includes('openai')))
  const staff = calls.find((c) => c.url.endsWith('staff-whatsapp-webhook'))!
  assertEquals(staff.headers['x-bot-secret'], 'gizli')
  assertEquals(staff.body, { phone: input.from, message: input.message, phone_number_id: 'pn-1' })
})

Deno.test('bot susturulmus: bos cevap, OpenAI cagrilmaz', async () => {
  const calls: Call[] = []
  const r = await runChatbot(
    input,
    deps(fakeFetch({ 'staff-whatsapp-webhook': { handled: false }, 'chatbot-context': { ...context, bot_paused: true } }, calls)),
  )
  assertEquals(r.reply, '')
  assert(!calls.some((c) => c.url.includes('openai')))
})

Deno.test('sohbet: OpenAI cevabi gider, mesaj ve cevap kaydedilir', async () => {
  const calls: Call[] = []
  const r = await runChatbot(
    { ...input, message: 'Fön kaç para?' },
    deps(
      fakeFetch(
        {
          'staff-whatsapp-webhook': { handled: false },
          'chatbot-context': context,
          openai: openaiText('Fön 250 TL.'),
          'chatbot-log-message': { ok: true },
        },
        calls,
      ),
    ),
  )
  await r.log
  assertEquals(r.reply, 'Fön 250 TL.')
  const ai = calls.find((c) => c.url.includes('openai'))!
  assertEquals(ai.headers.Authorization, 'Bearer sk-test')
  assertEquals(ai.body.model, 'gpt-5-mini')
  assertEquals(ai.body.reasoning_effort, 'low')
  const msgs = ai.body.messages as { role: string; content: string }[]
  // sabit kurallar once (onbellek), salona ozel bilgiler ikinci mesajda
  assert(msgs[0].content.startsWith('Sen bir işletmenin WhatsApp/Instagram asistanısın.'))
  assert(!msgs[0].content.includes('Güzel Salon'))
  assert(msgs[1].content.startsWith('İŞLETME BİLGİLERİ\nİşletme: "Güzel Salon"'))
  assertEquals(msgs.at(-1), { role: 'user', content: 'Fön kaç para?' })
  const log = calls.find((c) => c.url.endsWith('chatbot-log-message'))!
  assertEquals(log.body, {
    customer_phone: input.from,
    phone_number_id: 'pn-1',
    messages: [
      { role: 'user', content: 'Fön kaç para?' },
      { role: 'assistant', content: 'Fön 250 TL.' },
    ],
  })
})

Deno.test('randevu alma: book-appointment cagrilir, onay mesaji doner', async () => {
  const calls: Call[] = []
  const r = await runChatbot(
    { ...input, message: '2026-11-03 14:00 fön, Ayşe Demir 05321112233' },
    deps(
      fakeFetch(
        {
          'staff-whatsapp-webhook': { handled: false },
          'chatbot-context': context,
          openai: openaiTool('book_appointment', {
            service_name: 'Fön',
            date: '2026-11-03',
            time: '14:00',
            customer_full_name: 'Ayşe Demir',
            customer_contact_phone: '05321112233',
          }),
          'book-appointment': {
            status: 'booked',
            appointment: { service_name: 'Fön', scheduled_at: '2026-11-03T11:00:00Z', employee_name: 'Elif Yılmaz' },
          },
          'chatbot-log-message': { ok: true },
        },
        calls,
      ),
    ),
  )
  await r.log
  const book = calls.find((c) => c.url.endsWith('book-appointment'))!
  assertEquals(book.body.phone_number_id, 'pn-1')
  assertEquals(book.body.service_name, 'Fön')
  assertEquals(book.body.scheduled_at, '2026-11-03T14:00:00+03:00')
  assertEquals(book.body.source_note, 'WhatsApp asistanı')
  assertEquals(book.headers['x-bot-secret'], 'gizli')
  assert(r.reply.startsWith('Randevunuz oluşturuldu ✅\nFön - 3 Kasım 14:00 - Elif Yılmaz'), r.reply)
})

Deno.test('randevu iptali: cancel-appointment cagrilir', async () => {
  const calls: Call[] = []
  const r = await runChatbot(
    { ...input, message: 'perşembeki fönü iptal edelim' },
    deps(
      fakeFetch(
        {
          'staff-whatsapp-webhook': { handled: false },
          'chatbot-context': context,
          openai: openaiTool('cancel_appointment', { appointment_id: 'apt-1' }),
          'cancel-appointment': {
            status: 'cancelled',
            appointment: { service_name: 'Fön', scheduled_at: '2026-10-23T11:00:00Z', employee_name: 'Elif Yılmaz' },
          },
          'chatbot-log-message': { ok: true },
        },
        calls,
      ),
    ),
  )
  await r.log
  assertEquals(calls.find((c) => c.url.endsWith('cancel-appointment'))!.body, {
    appointment_id: 'apt-1',
    customer_phone: input.from,
    phone_number_id: 'pn-1',
  })
  assertEquals(r.reply, 'Randevunuz iptal edildi ✅\nFön - 23 Ekim 14:00 - Elif Yılmaz')
})

Deno.test('saat degisikligi: reschedule-appointment cagrilir', async () => {
  const calls: Call[] = []
  const r = await runChatbot(
    { ...input, message: 'perşembeki fönü 2026-10-24 16:00 yapalım' },
    deps(
      fakeFetch(
        {
          'staff-whatsapp-webhook': { handled: false },
          'chatbot-context': context,
          openai: openaiTool('reschedule_appointment', { appointment_id: 'apt-1', new_date: '2026-10-24', new_time: '16:00' }),
          'reschedule-appointment': {
            status: 'rescheduled',
            appointment: { service_name: 'Fön', scheduled_at: '2026-10-24T13:00:00Z', employee_name: 'Elif Yılmaz' },
          },
          'chatbot-log-message': { ok: true },
        },
        calls,
      ),
    ),
  )
  await r.log
  const req = calls.find((c) => c.url.endsWith('reschedule-appointment'))!
  assertEquals(req.body.appointment_id, 'apt-1')
  assertEquals(req.body.new_scheduled_at, '2026-10-24T16:00:00+03:00')
  assertEquals(r.reply, 'Randevunuz güncellendi ✅\nFön - 24 Ekim 16:00 - Elif Yılmaz')
})

Deno.test('az once alinmis randevuya "evet": tekrar randevu acilmaz', async () => {
  const calls: Call[] = []
  const r = await runChatbot(
    { ...input, message: 'evet' },
    deps(
      fakeFetch(
        {
          'staff-whatsapp-webhook': { handled: false },
          'chatbot-context': {
            ...context,
            history: [{ role: 'assistant', content: 'Randevunuz oluşturuldu ✅\nFön - 3 Kasım 14:00' }],
          },
          openai: openaiTool('book_appointment', {
            service_name: 'Fön',
            date: '2026-11-03',
            time: '14:00',
            customer_full_name: 'Ayşe Demir',
            customer_contact_phone: '05321112233',
          }),
          'chatbot-log-message': { ok: true },
        },
        calls,
      ),
    ),
  )
  await r.log
  assert(!calls.some((c) => c.url.endsWith('book-appointment')))
  assertEquals(r.reply, 'Randevunuz zaten oluşturuldu, tekrar almanıza gerek yok. Başka bir konuda yardımcı olabilir miyim?')
})

Deno.test('OpenAI hatasi: hata firlar (webhook musteriye bir sey gondermez)', async () => {
  const f = (async (url: string | URL) => {
    const u = String(url)
    if (u.includes('openai')) return new Response('{}', { status: 500 })
    if (u.endsWith('staff-whatsapp-webhook')) return new Response(JSON.stringify({ handled: false }))
    return new Response(JSON.stringify(context))
  }) as typeof fetch
  let threw = false
  try {
    await runChatbot(input, deps(f))
  } catch {
    threw = true
  }
  assert(threw)
})

// "saat 1'de" -> model 01:00 dese bile randevu acilmaz, once 13:00 sorulur
const bookingAt = (time: string) =>
  openaiTool('book_appointment', {
    service_name: 'Pedikür',
    date: '2026-10-22',
    time,
    customer_full_name: 'Görkem Karakuş',
    customer_contact_phone: '05413402738',
  })
const routesFor = (time: string) => ({
  'staff-whatsapp-webhook': { handled: false },
  'chatbot-context': context,
  openai: bookingAt(time),
  'book-appointment': {
    status: 'booked',
    appointment: { service_name: 'Pedikür', scheduled_at: '2026-10-22T10:00:00Z', employee_name: 'Elif Yılmaz' },
  },
  'chatbot-log-message': { ok: true },
})

Deno.test('dakikasiz "saat 1": randevu acilmaz, oglenden sonrasi sorulur ve kaydedilir', async () => {
  const calls: Call[] = []
  const r = await runChatbot({ ...input, message: 'Saat 1 de 05413402738 Görkem karakuş' }, deps(fakeFetch(routesFor('01:00'), calls)))
  await r.log
  assert(!calls.some((c) => c.url.endsWith('book-appointment')))
  assertEquals(r.reply, 'Öğlen 1, yani 13:00 uygun mu?')
  const log = calls.find((c) => c.url.endsWith('chatbot-log-message'))!
  assertEquals((log.body.messages as { content: string }[])[1].content, 'Öğlen 1, yani 13:00 uygun mu?')
})

Deno.test('acikca "gece 01:30" ya da "sabah 7": istendigi gibi randevu denenir', async () => {
  for (const [message, time] of [
    ['gece 01:30 olsun', '01:30'],
    ['sabah 7 uygun', '07:00'],
    ['saat 07:15 olur', '07:15'],
  ]) {
    const calls: Call[] = []
    const r = await runChatbot({ ...input, message }, deps(fakeFetch(routesFor(time), calls)))
    await r.log
    assert(calls.some((c) => c.url.endsWith('book-appointment')), message)
  }
})

Deno.test('13:00 ve 10:00 gibi saatler sorulmadan alinir', async () => {
  for (const time of ['13:00', '10:00', '08:30']) {
    const calls: Call[] = []
    const r = await runChatbot({ ...input, message: 'tamam' }, deps(fakeFetch(routesFor(time), calls)))
    await r.log
    assert(calls.some((c) => c.url.endsWith('book-appointment')), time)
  }
})

Deno.test('tarih "1.11" saat sanilmaz: "1.11 saat 1" yine sorulur', async () => {
  const calls: Call[] = []
  const r = await runChatbot({ ...input, message: '1.11.2026 saat 1' }, deps(fakeFetch(routesFor('01:00'), calls)))
  await r.log
  assertEquals(r.reply, 'Öğlen 1, yani 13:00 uygun mu?')
})

Deno.test('saat sorusu gunun bolumune gore dogal kurulur', () => {
  assertEquals(earlyHourQuestionText(1, '00'), 'Öğlen 1, yani 13:00 uygun mu?')
  assertEquals(earlyHourQuestionText(4, '00'), 'Öğleden sonra 4, yani 16:00 uygun mu?')
  assertEquals(earlyHourQuestionText(7, '00'), 'Akşam 7, yani 19:00 uygun mu?')
  assertEquals(earlyHourQuestionText(2, '30'), 'Öğlen 2:30, yani 14:30 uygun mu?')
})

// --- 2026-10-23 canli testte gorulen hatalar ---

Deno.test('onay cumleleri: gundelik onaylar sayilir, olumsuz/yeni saat sayilmaz', () => {
  for (const ok of ['Uygun', 'evet', 'Tamam aynı tarihi söylüyorsun zaten uygun', 'olur o zaman', 'tamamdır ayarla']) {
    assert(isConfirmationMessage(ok), ok)
  }
  for (const no of ['uygun değil', 'hayır olmaz', 'olur ama 10da', 'başka gün olsun', 'iptal et', 'pedikür kaç para']) {
    assert(!isConfirmationMessage(no), no)
  }
})

const pedicureContext = {
  ...context,
  services: [{ name: 'Pedikür', duration_minutes: 60, price: 500 }],
  history: [
    { role: 'user', content: '29 ekim pedikür istiyorum sabah' },
    { role: 'assistant', content: 'Ad soyad ve telefonunuzu yazar mısınız?' },
    { role: 'user', content: 'Görkem Karakuş 05413402738' },
    { role: 'assistant', content: 'Tamam, ad ve telefon kayıtlı. 30 Ekim 09:00 sizin için uygun mu?' },
  ],
}
const bookPedicure = openaiTool('book_appointment', {
  service_name: 'Pedikür',
  date: '2026-10-29',
  time: '09:00',
  customer_full_name: 'Görkem Karakuş',
  customer_contact_phone: '05413402738',
})

Deno.test('botun kendi onerdigi tarih onaylaninca eski tarih (29 Ekim) degil 30 Ekim denenir', async () => {
  const calls: Call[] = []
  await runChatbot(
    { ...input, message: 'Uygun' },
    deps(
      fakeFetch(
        {
          'staff-whatsapp-webhook': { handled: false },
          'chatbot-context': pedicureContext,
          openai: bookPedicure,
          'book-appointment': {
            status: 'booked',
            appointment: { service_name: 'Pedikür', scheduled_at: '2026-10-30T06:00:00Z', employee_name: 'Elif Yılmaz' },
          },
          'chatbot-log-message': { ok: true },
        },
        calls,
      ),
    ),
  )
  const book = calls.find((c) => c.url.endsWith('book-appointment'))!
  assertEquals(book.body.scheduled_at, '2026-10-30T09:00:00+03:00')
})

Deno.test('"tamam ayni tarihi soyluyorsun zaten uygun" sabit kalipli oneriyi onaylar', async () => {
  const calls: Call[] = []
  await runChatbot(
    { ...input, message: 'Tamam aynı tarihi söylüyorsun zaten uygun' },
    deps(
      fakeFetch(
        {
          'staff-whatsapp-webhook': { handled: false },
          'chatbot-context': {
            ...pedicureContext,
            history: [
              ...pedicureContext.history,
              { role: 'user', content: 'Uygun' },
              {
                role: 'assistant',
                content: 'O saat için uygun değiliz (dolu). En yakın uygun saat: 30 Ekim 09:00 - Salon Çalışanı. Uygun mu?',
              },
            ],
          },
          openai: bookPedicure,
          'book-appointment': {
            status: 'booked',
            appointment: { service_name: 'Pedikür', scheduled_at: '2026-10-30T06:00:00Z', employee_name: 'Salon Çalışanı' },
          },
          'chatbot-log-message': { ok: true },
        },
        calls,
      ),
    ),
  )
  const book = calls.find((c) => c.url.endsWith('book-appointment'))!
  assertEquals(book.body.scheduled_at, '2026-10-30T09:00:00+03:00')
  assertEquals(book.body.employee_name, 'Salon Çalışanı')
})

Deno.test('tatil gunu: "dolu" yerine "kapaliyiz" denir', async () => {
  const r = await runChatbot(
    { ...input, message: '29 ekim saat 10:00 pedikür, Görkem Karakuş 05413402738' },
    deps(
      fakeFetch(
        {
          'staff-whatsapp-webhook': { handled: false },
          'chatbot-context': { ...context, services: [{ name: 'Pedikür', duration_minutes: 60, price: 500 }] },
          openai: openaiTool('book_appointment', {
            service_name: 'Pedikür',
            date: '2026-10-29',
            time: '10:00',
            customer_full_name: 'Görkem Karakuş',
            customer_contact_phone: '05413402738',
          }),
          'book-appointment': {
            status: 'unavailable',
            suggestion: { scheduled_at: '2026-10-30T06:00:00Z', employee_name: 'Elif Yılmaz' },
            outside_hours: null,
            closed_day: { name: 'Cumhuriyet Bayramı' },
          },
          'chatbot-log-message': { ok: true },
        },
        [],
      ),
    ),
  )
  assert(r.reply.startsWith('O gün (Cumhuriyet Bayramı) kapalıyız. En yakın uygun saat: 30 Ekim 09:00'), r.reply)
})

Deno.test('talimat: yer tutucu numara yok; salon telefonu ve kapali gunler eklenir', async () => {
  const promptFor = async (ctx: Record<string, unknown>) => {
    const calls: Call[] = []
    await runChatbot(
      input,
      deps(
        fakeFetch(
          {
            'staff-whatsapp-webhook': { handled: false },
            'chatbot-context': ctx,
            openai: openaiText('ok'),
            'chatbot-log-message': { ok: true },
          },
          calls,
        ),
      ),
    )
    const ai = calls.find((c) => c.url.includes('openai'))!
    const msgs = ai.body.messages as { role: string; content: string }[]
    return msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  }
  const withPhone = await promptFor({
    ...context,
    business_phone: '0362 555 12 34',
    closed_days: [{ name: 'Cumhuriyet Bayramı', start_date: '2026-10-29', end_date: '2026-10-29', eve_closes_at: '13:00' }],
  })
  assert(!withPhone.includes('XXX'))
  assert(withPhone.includes('Salonun telefonu: 0362 555 12 34'))
  assert(withPhone.includes('29 Ekim (Perşembe): Cumhuriyet Bayramı'))
  const noPhone = await promptFor(context)
  assert(!noPhone.includes('XXX'))
  assert(noPhone.includes('müşteriye ASLA bir numara yazma'))
})

Deno.test('dogrudan cagri: bot fonksiyonlari aga cikmadan isleyicilere gider, OpenAI aga gider', async () => {
  const viaNetwork: string[] = []
  const viaHandler: string[] = []
  const net = (async (url: string | URL) => {
    viaNetwork.push(String(url))
    return new Response(JSON.stringify(openaiText('Fön 250 TL.')))
  }) as typeof fetch
  const h = (name: string, data: unknown) => async (req: Request) => {
    viaHandler.push(name)
    assertEquals(req.headers.get('x-bot-secret'), 'gizli')
    return new Response(JSON.stringify(data))
  }
  const r = await runChatbot(input, {
    ...deps(net),
    handlers: {
      'staff-whatsapp-webhook': h('staff', { handled: false }),
      'chatbot-context': h('context', context),
      'chatbot-log-message': h('log', { ok: true }),
    },
  })
  await r.log
  assertEquals(r.reply, 'Fön 250 TL.')
  assertEquals(viaNetwork.length, 1)
  assert(viaNetwork[0].includes('api.openai.com'))
  assertEquals(viaHandler.sort(), ['context', 'log', 'staff'])
})

Deno.test('soyad kilidi: tek kelimelik adla randevu acilmaz; soyad sonradan gelince birlestirilir', () => {
  const book = (name: string) => ({ hasToolCall: true, toolName: 'book_appointment', toolArgs: { customer_full_name: name } })
  assertEquals(askForSurname(book('Zeynep'), 'yarın 10 manikür adım zeynep 0532', context), 'Soyadınızı da yazar mısınız?')
  const a = book('Ali')
  assertEquals(askForSurname(a, 'ali yılmaz 05321115050', context), null)
  assertEquals((a.toolArgs as { customer_full_name: string }).customer_full_name, 'Ali Yılmaz')
  const b = book('Zeynep')
  const ctx = { ...context, history: [{ role: 'assistant', content: 'Soyadınızı da yazar mısınız?' }] }
  assertEquals(askForSurname(b, 'arslan', ctx), null)
  assertEquals((b.toolArgs as { customer_full_name: string }).customer_full_name, 'Zeynep Arslan')
  assertEquals(askForSurname(book('Ali'), 'ali için yarın 10', context), 'Soyadınızı da yazar mısınız?')
  assertEquals(askForSurname(book('Ayşe Demir'), 'x', context), null)
})

Deno.test('ad karisikligi yakalanir: musterinin adi "calismiyor" denirse', () => {
  const chat = (r: string) => ({ hasToolCall: false, chatReply: r })
  assertEquals(misreadCustomerName(chat('Hande Özkan salonumuzda çalışmıyor maalesef.'), 'haftaya salı 10:00 manikür, hande özkan 0532'), 'Hande Özkan')
  assertEquals(misreadCustomerName(chat('Ahmet bizde çalışmıyor.'), 'ahmet beyle yarın 10 saç kesimi, can er 0532'), null)
  assertEquals(misreadCustomerName(chat('Elif Demir salonumuzda çalışmıyor.'), 'pazartesi 13.30 fön Elif Demir 05321234567'), 'Elif Demir')
  assertEquals(misreadCustomerName(chat('Merve Ak salonumuzda çalışmıyor'), 'yarın fön'), null)
})

// --- WhatsApp kullanici adi (BSUID) ile gelen mesajlar ---

Deno.test('BSUID ile gelen musteri: personel kontrolu atlanir, bot cevap verir', async () => {
  const calls: Call[] = []
  const r = await runChatbot(
    { ...input, from: 'TR.1824962542022888', message: 'fön kaç para' },
    deps(fakeFetch({ 'chatbot-context': context, openai: openaiText('Fön 250 TL.'), 'chatbot-log-message': { ok: true } }, calls)),
  )
  await r.log
  assertEquals(r.reply, 'Fön 250 TL.')
  assert(!calls.some((c) => c.url.endsWith('staff-whatsapp-webhook')))
  assertEquals(calls.find((c) => c.url.endsWith('chatbot-context'))!.body.customer_phone, 'TR.1824962542022888')
})

Deno.test('personel kontrolu 400 verirse bot susmaz, musteri sayilir', async () => {
  const f = (async (url: string | URL) => {
    const u = String(url)
    if (u.endsWith('staff-whatsapp-webhook')) return new Response(JSON.stringify({ error: 'phone ve message zorunlu' }), { status: 400 })
    if (u.endsWith('chatbot-context')) return new Response(JSON.stringify(context))
    if (u.includes('openai')) return new Response(JSON.stringify(openaiText('Merhaba!')))
    return new Response(JSON.stringify({ ok: true }))
  }) as typeof fetch
  const r = await runChatbot(input, deps(f))
  await r.log
  assertEquals(r.reply, 'Merhaba!')
})

Deno.test('BSUID tanima', () => {
  assert(isBusinessScopedUserId('TR.1824962542022888'))
  assert(isBusinessScopedUserId('US.ENT.11815799212886844830'))
  assert(!isBusinessScopedUserId('905413402738'))
  assert(!isBusinessScopedUserId('+905413402738'))
})

Deno.test('guvenlik agi: model randevu acmadan "oluşturuldu" derse gonderilmez; teklif ezilmez', async () => {
  const run = async (text: string, ctx: Record<string, unknown> = context) => {
    const r = await runChatbot(
      { ...input, message: 'tamam' },
      deps(fakeFetch({ 'staff-whatsapp-webhook': { handled: false }, 'chatbot-context': ctx, openai: openaiText(text), 'chatbot-log-message': { ok: true } }, [])),
    )
    await r.log
    return r.reply
  }
  const noAppts = { ...context, appointments: [] }
  assert(!(await run('Randevunuz oluşturuldu, görüşmek üzere.', noAppts)).includes('oluşturuldu, görüşmek'))
  assertEquals(await run('Manikür 450 TL. İsterseniz randevunuzu oluşturuyorum, uygun mu?', noAppts), 'Manikür 450 TL. İsterseniz randevunuzu oluşturuyorum, uygun mu?')
  assertEquals(await run('Randevunuz 23 Ekim için oluşturuldu.'), 'Randevunuz 23 Ekim için oluşturuldu.')
})
