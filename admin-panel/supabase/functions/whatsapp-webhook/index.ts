import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'
import { botSharedSecret, resolveBusiness } from '../_shared/resolveBusiness.ts'
import { runChatbot, type MediaKind } from '../_shared/chatbot.ts'
import { pauseBotForCustomer } from '../_shared/botPause.ts'
import { handler as staffHandler } from '../staff-whatsapp-webhook/handler.ts'
import { handler as contextHandler } from '../chatbot-context/handler.ts'
import { handler as bookHandler } from '../book-appointment/handler.ts'
import { handler as cancelHandler } from '../cancel-appointment/handler.ts'
import { handler as rescheduleHandler } from '../reschedule-appointment/handler.ts'
import { handler as logHandler } from '../chatbot-log-message/handler.ts'

// Asistanin cagirdigi fonksiyonlar bu surecte calisir (HTTP yolculugu yok).
const BOT_HANDLERS: Record<string, (req: Request) => Promise<Response>> = {
  'staff-whatsapp-webhook': staffHandler,
  'chatbot-context': contextHandler,
  'book-appointment': bookHandler,
  'cancel-appointment': cancelHandler,
  'reschedule-appointment': rescheduleHandler,
  'chatbot-log-message': logHandler,
}
import { isOptOutMessage } from '../_shared/marketing.ts'
import { sendTypingIndicator, sendWhatsAppText } from '../_shared/notify.ts'
import { appointmentParams, parseAppointmentButton, type AppointmentAction } from '../_shared/waTemplates.ts'
import { findCustomersByPhone } from '../_shared/customerLookup.ts'
import { recordAdReferral } from '../_shared/adReferrals.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

interface WhatsAppMessage {
  // Telefon numarasi. WhatsApp kullanici adi kullanan ve numarasini gizleyen
  // kisilerde HIC gelmeyebilir; o zaman kimlik from_user_id'dedir (BSUID,
  // "TR.1824..." gibi, isletmeye ozel).
  from?: string
  from_user_id?: string
  id: string
  type: string
  text?: { body: string }
  // sablondaki hizli cevap dugmesi (hatirlatma: Geleceğim / Saati değiştir / İptal et)
  button?: { payload?: string; text?: string }
  // 24 saat icinde giden dugmeli mesajin cevabi
  interactive?: { type?: string; button_reply?: { id?: string; title?: string } }
  // "WhatsApp'a mesaj gönder" reklamindan gelen ilk mesajda reklam bilgisi
  referral?: { source_id?: string; source_type?: string; source_url?: string; headline?: string; body?: string; ctwa_clid?: string }
}

// Coexistence: salonun telefondaki WhatsApp Business uygulamasindan
// musteriye yazdigi mesajin kopyasi (smb_message_echoes).
interface WhatsAppEcho {
  id?: string
  to?: string
  to_user_id?: string
  type?: string
  text?: { body?: string }
}

interface WhatsAppValue {
  metadata?: { phone_number_id?: string }
  messages?: WhatsAppMessage[]
  message_echoes?: WhatsAppEcho[]
  contacts?: { profile?: { name?: string } }[]
  statuses?: {
    id?: string
    status?: string
    errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]
  }[]
}

interface WhatsAppPayload {
  entry?: { changes?: { value?: WhatsAppValue }[] }[]
}

// Meta, dogrulama (GET) ve gercek olay bildirimleri (POST) icin AYNI URL'i
// kullanir — ikisi de bu tek fonksiyonda ele aliniyor.
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface N8nForwardPayload {
  business_id: string
  phone_number_id: string | null
  from: string
  customer_name: string | null
  message: string
  wamid: string
  media?: MediaKind
}

// Musterinin gonderebildigi metin disi mesajlar; cikartma, tepki, konum gibi
// tiplere cevap verilmez.
const MEDIA_TYPES: Record<string, MediaKind> = { image: 'image', video: 'video', audio: 'audio', document: 'document' }

// n8n cagrisi zaten processWebhookEvent'in (EdgeRuntime.waitUntil ile
// sarilmis) icinde calisiyor — ayrica ikinci bir waitUntil GEREKMIYOR, tek
// katman yeterli. Meta'ya yanit COKTAN gitti; burada n8n'e ulasilamamasi
// (zaman asimi/5xx) sadece loglaniyor, mesaj zaten whatsapp_processed_messages
// tablosuna yazildigi icin bir daha denenmeyecek — bu kasitli: n8n'in gecici
// bir kesintisi Meta'nin AYNI mesaji sonsuza kadar tekrar tekrar denemesine
// yol acmamali (o zaman idempotency tablosu de tekrar tekrar cakisip hicbir
// sey ilerlemez).
//
// n8n'in webhook'u SENKRON (responseMode: responseNode) — yani yanit ancak
// TUM akis (personel kontrolu + baglam + OpenAI + gerekirse randevu
// olusturma/iptal/erteleme + loglama) bitince donuyor. 10 saniyelik ilk
// zaman asimi bunun icin cok kisaydi (canli testte "Signal timed out" verdi)
// — 60 saniyeye cikarildi, EdgeRuntime.waitUntil butcesinin (en az 150 sn)
// icinde rahatca kaliyor.
async function forwardToN8n(payload: N8nForwardPayload): Promise<void> {
  const n8nUrl = Deno.env.get('N8N_WEBHOOK_URL')
  if (!n8nUrl) {
    console.error('whatsapp-webhook: N8N_WEBHOOK_URL yapılandırılmamış, forward atlanıyor')
    return
  }
  let res: Response
  try {
    res = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    })
  } catch (e) {
    console.error('whatsapp-webhook: n8n forward hatası:', e instanceof Error ? e.message : e, 'wamid:', payload.wamid)
    return
  }
  if (!res.ok) {
    console.error('whatsapp-webhook: n8n forward başarısız, HTTP', res.status, 'wamid:', payload.wamid)
    return
  }

  // n8n'in ürettiği cevap metni burada gerçek WhatsApp gönderimine dönüşüyor
  // — n8n'in kendisi Cloud API'ye dokunmuyor, sadece {reply} döndürüyor.
  // Bos reply (personel WhatsApp Coexistence uzerinden elle devraldiginda,
  // n8n'in "Build Paused Reply" dali) bilerek GONDERILMIYOR. Musteriye
  // gonderilen cevabin chatbot_messages'a kaydi BURADA DEGIL, n8n'in kendi
  // "Log Messages" adiminda yapiliyor (sendCustomerMessage yerine ham
  // sendWhatsAppText kullanilmasinin sebebi bu — cift kayit olmasin diye).
  const data = await res.json().catch(() => null)
  const reply = typeof data?.reply === 'string' ? data.reply.trim() : ''
  if (!reply) {
    console.log('whatsapp-webhook: n8n boş cevap döndürdü (muhtemelen personel devraldı), gönderim atlanıyor')
    return
  }
  if (!payload.phone_number_id) {
    console.error('whatsapp-webhook: phone_number_id yok, cevap gönderilemedi')
    return
  }
  const sendResult = await sendWhatsAppText({ phoneNumberId: payload.phone_number_id, to: payload.from, message: reply })
  if (!sendResult.ok) {
    console.error('whatsapp-webhook: cevap gönderimi başarısız:', sendResult.error, 'wamid:', payload.wamid)
    return
  }
  console.log('whatsapp-webhook: cevap gönderildi, message id:', sendResult.messageId, 'wamid:', payload.wamid)
}

// Musteri asistani artik burada (Supabase) calisiyor; n8n'e gitmiyor.
// Cevap uretimi, randevu islemleri ve kayit chatbot.ts'te; burasi yalnizca
// cevabi gonderir. Hata olursa musteriye bir sey gitmez, loglanir (n8n
// yolundaki davranisla ayni).
async function answerWithChatbot(admin: SupabaseClient, payload: N8nForwardPayload): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  const botSecret = await botSharedSecret(admin)
  if (!supabaseUrl || !anonKey || !openaiKey || !botSecret) {
    console.error('whatsapp-webhook: asistan yapılandırması eksik', {
      anon: !!anonKey,
      openai: !!openaiKey,
      bot_secret: !!botSecret,
    })
    return
  }
  if (!payload.phone_number_id) {
    console.error('whatsapp-webhook: phone_number_id yok, cevap gönderilemez')
    return
  }
  // cevap hazirlanirken musteri "yaziyor..." gorur; beklenmez
  const typing = sendTypingIndicator({ phoneNumberId: payload.phone_number_id, messageId: payload.wamid })
  let result
  try {
    result = await runChatbot(payload, { supabaseUrl, anonKey, openaiKey, botSecret, handlers: BOT_HANDLERS })
  } catch (e) {
    console.error('whatsapp-webhook: asistan hatası:', e instanceof Error ? e.message : e, 'wamid:', payload.wamid)
    return
  }
  await typing
  // musteri temsilciye aktarilmak istedi: bu kiside asistan susar
  const handover = result.handover ? pauseBotForCustomer(admin, payload.business_id, payload.from) : Promise.resolve()
  if (!result.reply.trim()) {
    console.log('whatsapp-webhook: asistan boş cevap döndürdü (personel devraldı ya da işletme yok), gönderim atlanıyor')
    await Promise.all([result.log, handover])
    return
  }
  const [sendResult] = await Promise.all([
    sendWhatsAppText({ phoneNumberId: payload.phone_number_id, to: payload.from, message: result.reply.trim() }),
    result.log,
    handover,
  ])
  if (!sendResult.ok) {
    console.error('whatsapp-webhook: cevap gönderimi başarısız:', sendResult.error, 'wamid:', payload.wamid)
    return
  }
  console.log('whatsapp-webhook: cevap gönderildi, message id:', sendResult.messageId, 'wamid:', payload.wamid)
}

// Hatirlatmadaki dugmeler: "Geleceğim" randevuyu onaylar, "İptal et" iptal
// eder (geri alinamaz ama musteri bilerek basti), "Saati değiştir" asistana
// yeni saati sordurur. Randevu, dugmeye basan numaranin kaydinda olmali.
async function handleAppointmentButton(
  admin: SupabaseClient,
  payload: N8nForwardPayload,
  button: { action: AppointmentAction; appointmentId: string },
): Promise<void> {
  if (button.action === 'reschedule') {
    await answerWithChatbot(admin, { ...payload, message: 'Randevumun saatini değiştirmek istiyorum' })
    return
  }
  if (!payload.phone_number_id) return
  const { ids } = await findCustomersByPhone(admin, payload.business_id, payload.from, 'id')
  const { data: appt } = ids.length
    ? await admin
        .from('appointments')
        .select('id, status, scheduled_at, source_note, services(name)')
        .eq('id', button.appointmentId)
        .eq('business_id', payload.business_id)
        .in('customer_id', ids)
        .maybeSingle()
    : { data: null }

  let reply: string
  if (!appt) {
    reply = 'Bu randevuyu bulamadım. Yardımcı olmamı istediğiniz konuyu yazabilir misiniz?'
  } else if (appt.status === 'iptal') {
    reply = 'Bu randevu zaten iptal edilmiş. Yeni bir randevu isterseniz yazmanız yeterli.'
  } else if (appt.status !== 'bekliyor' && appt.status !== 'onaylandi') {
    reply = 'Bu randevu için işlem yapamadım. Bir sorunuz varsa yazabilirsiniz.'
  } else if (button.action === 'confirm') {
    if (appt.status !== 'onaylandi') {
      const { error } = await admin.from('appointments').update({ status: 'onaylandi' }).eq('id', appt.id)
      if (error) console.error('whatsapp-webhook: randevu onaylanamadı:', error.message)
    }
    reply = 'Teşekkürler, randevunuz onaylandı. Görüşmek üzere!'
  } else {
    const note = [appt.source_note, 'Müşteri hatırlatmadan iptal etti'].filter(Boolean).join(' | ')
    const { error } = await admin.from('appointments').update({ status: 'iptal', source_note: note }).eq('id', appt.id)
    if (error) {
      console.error('whatsapp-webhook: randevu iptal edilemedi:', error.message)
      reply = 'Randevunuzu şu an iptal edemedim. Birazdan tekrar dener misiniz?'
    } else {
      const service = (appt.services as { name?: string } | null)?.name ?? 'Randevu'
      const [, , , date, time] = appointmentParams({ customerName: null, businessName: null, serviceName: service, scheduledAt: appt.scheduled_at })
      // asistanin iptal kartiyla ayni bicim (sohbet gecmisinde islem onayi sayilir)
      reply = `Randevunuz iptal edildi ✅
${service} - ${date} ${time}
Başka bir gün isterseniz buraya yazmanız yeterli.`
    }
  }

  // basilan dugme ve cevap Mesajlar ekraninda gorunur
  const [sent, { error: logErr }] = await Promise.all([
    sendWhatsAppText({ phoneNumberId: payload.phone_number_id, to: payload.from, message: reply }),
    admin.from('chatbot_messages').insert([
      { business_id: payload.business_id, customer_phone: payload.from, role: 'user', content: payload.message || 'Düğmeye bastı' },
      { business_id: payload.business_id, customer_phone: payload.from, role: 'assistant', content: reply },
    ]),
  ])
  if (!sent.ok) console.error('whatsapp-webhook: düğme cevabı gönderilemedi:', sent.error)
  if (logErr) console.error('whatsapp-webhook: düğme konuşması kaydedilemedi:', logErr.message)
  console.log('whatsapp-webhook: hatırlatma düğmesi işlendi', { business_id: payload.business_id, action: button.action, found: !!appt })
}

// Yanit Meta'ya imza dogrulanir dogrulanmaz (bu fonksiyon cagrilmadan ONCE)
// zaten 200 olarak gonderildi — o yuzden asagidaki her erken-cikis sadece
// "daha fazla isleme yapma" anlamina geliyor, ayrica bir HTTP durum kodu
// karari icermiyor. Onemli olan: hicbir dal exception FIRLATMIYOR (firlatirsa
// waitUntil'in yakalanmamis reddi loglanir ama Meta'yi etkilemez, zaten yanit
// gitti) — ama yine de "beklenen, zararsiz durum" ile "gercek hata" ayrimini
// loglarda tutmak icin console.log/console.error ayriliyor.
// Salon musteriye telefondan (WhatsApp Business uygulamasi) yazinca kopyasi
// gelir: personel konusmayi devraldi, asistan bu musteride ECHO_PAUSE_HOURS
// boyunca susar (her yeni mesaj sureyi uzatir) ve mesaj sohbet gecmisine
// eklenir; uygulamada gorunur, asistan sonra baglami bilir.
// Not: telefondaki uygulamanin otomatik karsilama/uzakta mesajlari da bu
// yoldan gelir ve asistani susturur; salon bunlari kapatmali.
const ECHO_PAUSE_HOURS = 3

async function handleEchoes(admin: SupabaseClient, req: Request, value: WhatsAppValue): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id ?? null
  const business = await resolveBusiness(admin, req, phoneNumberId, { trusted: true })
  if (!business) {
    console.log('whatsapp-webhook: echo için işletme bulunamadı, phone_number_id:', phoneNumberId)
    return
  }

  for (const echo of value.message_echoes ?? []) {
    const customerPhone = echo.to ?? echo.to_user_id ?? ''
    if (!echo.id || !customerPhone) continue

    const { error: dupErr } = await admin.from('whatsapp_processed_messages').insert({ wamid: echo.id })
    if (dupErr) {
      if (dupErr.code !== '23505') console.error('whatsapp-webhook: echo kaydı başarısız:', dupErr.message)
      continue
    }

    await pauseBotForCustomer(admin, business.id, customerPhone, ECHO_PAUSE_HOURS)

    if (echo.type === 'text' && echo.text?.body) {
      const { error: logErr } = await admin.from('chatbot_messages').insert({
        business_id: business.id,
        customer_phone: customerPhone,
        role: 'staff',
        content: echo.text.body,
      })
      if (logErr) console.error('whatsapp-webhook: echo mesajı kaydedilemedi:', logErr.message)
    }
    console.log('whatsapp-webhook: salon telefondan yazdı, asistan susturuldu', { business_id: business.id, wamid: echo.id })
  }
}

async function processWebhookEvent(admin: SupabaseClient, req: Request, rawBody: string): Promise<void> {
  let payload: WhatsAppPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('whatsapp-webhook: geçersiz JSON body')
    return
  }

  const value = payload.entry?.[0]?.changes?.[0]?.value
  const message = value?.messages?.[0]

  // Gonderilen cevabin teslim durumu (sent/delivered/read/failed). Meta
  // gonderimi kabul edip sonra teslim edemezse hata yalnizca burada gelir;
  // loglanmazsa cevap sessizce kaybolur. Alici numarasi yazilmaz.
  for (const s of value?.statuses ?? []) {
    if (s.status === 'failed') {
      console.error('whatsapp-webhook: mesaj teslim edilemedi', {
        message_id: s.id,
        errors: (s.errors ?? []).map((e) => ({ code: e.code, title: e.title, details: e.error_data?.details ?? e.message })),
      })
    } else {
      console.log('whatsapp-webhook: teslim durumu', { message_id: s.id, status: s.status })
    }
  }

  if (value?.message_echoes?.length) {
    await handleEchoes(admin, req, value)
    return
  }

  // messages dizisi bos olabilir (durum guncellemesi — delivered/read/sent
  // gibi). Metin ve fotograf/ses/video/dosya islenir; fotografa asistan
  // "yazabilir misiniz" der (eskiden sessizce atlaniyordu, musteri cevapsiz kaliyordu).
  const media = message ? MEDIA_TYPES[message.type ?? ''] : undefined
  // musterinin bastigi dugme: verisi (hatirlatmada randevu islemi) ve basligi
  const buttonPayload = message?.button?.payload ?? message?.interactive?.button_reply?.id ?? null
  const buttonTitle = message?.button?.text ?? message?.interactive?.button_reply?.title ?? ''
  if (!message || (message.type !== 'text' && !media && !buttonPayload)) {
    console.log('whatsapp-webhook: işlenecek metin mesajı yok (durum güncellemesi veya desteklenmeyen tip), atlanıyor')
    return
  }

  const wamid = message.id
  // Musteri kimligi: telefon varsa telefon, yoksa isletmeye ozel kullanici
  // kimligi (BSUID). Cevap da ayni kimlige gider (notify.ts BSUID'i taniyor).
  const sender = message.from ?? message.from_user_id ?? ''
  if (!sender) {
    console.error('whatsapp-webhook: gönderen kimliği yok (from / from_user_id), atlanıyor:', wamid)
    return
  }

  // Insert'in PRIMARY KEY ihlaliyle basarisiz olmasi "bu wamid zaten
  // islendi" sinyali — check-then-insert yerine atomik, yaris durumuna
  // kapali bir desen (Meta ayni olayi paralel/art arda tekrar gonderebiliyor).
  const { error: insertError } = await admin.from('whatsapp_processed_messages').insert({ wamid })
  if (insertError) {
    if (insertError.code === '23505') {
      console.log('whatsapp-webhook: wamid daha önce işlendi, atlanıyor:', wamid)
      return
    }
    console.error('whatsapp-webhook: wamid kaydı başarısız:', insertError.message)
    return
  }

  const phoneNumberId = value?.metadata?.phone_number_id ?? null
  // Istek Meta imzasiyla dogrulandi; numara kimligi guvenilir.
  const business = await resolveBusiness(admin, req, phoneNumberId, { trusted: true })
  if (!business) {
    console.log('whatsapp-webhook: işletme bulunamadı, phone_number_id:', phoneNumberId)
    return
  }

  const customerName = value?.contacts?.[0]?.profile?.name ?? null
  // taninmayan bir dugme basligi asistana yazi gibi gider
  const text = message.text?.body ?? buttonTitle

  // reklamdan gelen konusma: asistan bu mesajda randevu acarsa reklama baglansin diye once kaydedilir
  if (message.referral) {
    await recordAdReferral(admin, business.id, sender, {
      channel: 'whatsapp',
      adId: message.referral.source_id,
      title: message.referral.headline,
      body: message.referral.body,
      sourceUrl: message.referral.source_url,
      clickId: message.referral.ctwa_clid,
    })
  }

  const appointmentButton = parseAppointmentButton(buttonPayload)
  if (appointmentButton) {
    await handleAppointmentButton(
      admin,
      { business_id: business.id, phone_number_id: phoneNumberId, from: sender, customer_name: customerName, message: buttonTitle, wamid },
      appointmentButton,
    )
    return
  }

  // Loglarda kisisel veri yok: telefon, isim ve mesaj metni yazilmaz.
  console.log('whatsapp-webhook: parse edildi', {
    business_id: business.id,
    phone_number_id: phoneNumberId,
    wamid,
    text_length: text.length,
  })

  // "RET": kampanya izni kapatilir, asistana iletilmez.
  if (isOptOutMessage(text)) {
    const { error: optErr } = await admin.rpc('opt_out_customer_by_phone', { p_business: business.id, p_phone: sender })
    if (optErr) console.error('whatsapp-webhook: ret kaydedilemedi:', optErr.message)
    if (phoneNumberId) {
      await sendWhatsAppText({
        phoneNumberId,
        to: sender,
        message: 'Kampanya mesajı listesinden çıkarıldınız. Randevu hatırlatmalarınız gelmeye devam edecek.',
      })
    }
    return
  }

  // Test komutu "#sıfırla": bu numaranin bot sohbet gecmisini siler, sonraki
  // mesaj yeni bir konusma gibi baslar. Yalnizca BOT_TEST_RESET=1 iken calisir
  // (canlida kapali; gercek musterinin gecmisi silinmesin).
  if (Deno.env.get('BOT_TEST_RESET') === '1' && /^#s[ıi]f[ıi]rla$/i.test(text.trim())) {
    const { error: resetErr } = await admin
      .from('chatbot_messages')
      .delete()
      .eq('business_id', business.id)
      .eq('customer_phone', sender)
    if (resetErr) console.error('whatsapp-webhook: sohbet sıfırlanamadı:', resetErr.message)
    if (phoneNumberId) {
      await sendWhatsAppText({
        phoneNumberId,
        to: sender,
        message: resetErr ? 'Sohbet sıfırlanamadı.' : 'Sohbet sıfırlandı (test). Yeni bir konuşma gibi yazabilirsiniz.',
      })
    }
    return
  }

  const botPayload: N8nForwardPayload = {
    business_id: business.id,
    phone_number_id: phoneNumberId,
    from: sender,
    customer_name: customerName,
    message: text,
    wamid,
    ...(media ? { media } : {}),
  }
  // BOT_ENGINE=n8n: eski n8n akisina geri donus (yedek; fotograf/ses bilmez)
  if (Deno.env.get('BOT_ENGINE') === 'n8n') {
    if (!media) await forwardToN8n(botPayload)
  } else {
    await answerWithChatbot(admin, botPayload)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const expectedToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN')

    if (
      mode === 'subscribe' &&
      challenge &&
      token &&
      expectedToken &&
      timingSafeEqualString(token, expectedToken)
    ) {
      return new Response(challenge, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } })
    }
    return json({ error: 'Doğrulama başarısız' }, 403)
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!appSecret) return json({ error: 'WhatsApp yapılandırılmamış' }, 500)

  // Imza RAW body uzerinden dogrulanmali (JSON.parse edilip yeniden
  // serialize edilmis haliyle DEGIL) — Meta imzayi orijinal byte dizisi
  // uzerinden hesapliyor, kucuk bir bosluk/sira farki bile imzayi gecersiz
  // kilar. Bu yuzden body Gorev 2'de de bu ham string uzerinden parse
  // edilecek, req.json() ayrica cagrilmayacak.
  const rawBody = await req.text()
  const signatureHeader = req.headers.get('x-hub-signature-256') ?? ''
  const providedHex = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : ''
  const expectedHex = await hmacSha256Hex(appSecret, rawBody)

  if (!providedHex || !timingSafeEqualString(providedHex, expectedHex)) {
    return json({ error: 'Geçersiz imza' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  EdgeRuntime.waitUntil(processWebhookEvent(admin, req, rawBody))

  return json({ status: 'received' }, 200)
})
