import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'
import { botSharedSecret, resolveBusiness } from '../_shared/resolveBusiness.ts'
import { runChatbot } from '../_shared/chatbot.ts'
import { isOptOutMessage } from '../_shared/marketing.ts'
import { sendTypingIndicator, sendWhatsAppText } from '../_shared/notify.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

interface WhatsAppMessage {
  from: string
  id: string
  type: string
  text?: { body: string }
}

interface WhatsAppValue {
  metadata?: { phone_number_id?: string }
  messages?: WhatsAppMessage[]
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
}

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
    result = await runChatbot(payload, { supabaseUrl, anonKey, openaiKey, botSecret })
  } catch (e) {
    console.error('whatsapp-webhook: asistan hatası:', e instanceof Error ? e.message : e, 'wamid:', payload.wamid)
    return
  }
  await typing
  if (!result.reply.trim()) {
    console.log('whatsapp-webhook: asistan boş cevap döndürdü (personel devraldı ya da işletme yok), gönderim atlanıyor')
    await result.log
    return
  }
  const [sendResult] = await Promise.all([
    sendWhatsAppText({ phoneNumberId: payload.phone_number_id, to: payload.from, message: result.reply.trim() }),
    result.log,
  ])
  if (!sendResult.ok) {
    console.error('whatsapp-webhook: cevap gönderimi başarısız:', sendResult.error, 'wamid:', payload.wamid)
    return
  }
  console.log('whatsapp-webhook: cevap gönderildi, message id:', sendResult.messageId, 'wamid:', payload.wamid)
}

// Yanit Meta'ya imza dogrulanir dogrulanmaz (bu fonksiyon cagrilmadan ONCE)
// zaten 200 olarak gonderildi — o yuzden asagidaki her erken-cikis sadece
// "daha fazla isleme yapma" anlamina geliyor, ayrica bir HTTP durum kodu
// karari icermiyor. Onemli olan: hicbir dal exception FIRLATMIYOR (firlatirsa
// waitUntil'in yakalanmamis reddi loglanir ama Meta'yi etkilemez, zaten yanit
// gitti) — ama yine de "beklenen, zararsiz durum" ile "gercek hata" ayrimini
// loglarda tutmak icin console.log/console.error ayriliyor.
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

  // messages dizisi bos olabilir (durum guncellemesi — delivered/read/sent
  // gibi) ya da metin disi bir tip (image/audio/location/...) gelebilir;
  // Gorev 2 kapsaminda sadece metin mesajlari isleniyor.
  if (!message || message.type !== 'text') {
    console.log('whatsapp-webhook: işlenecek metin mesajı yok (durum güncellemesi veya desteklenmeyen tip), atlanıyor')
    return
  }

  const wamid = message.id

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
  const text = message.text?.body ?? ''

  // Loglarda kisisel veri yok: telefon, isim ve mesaj metni yazilmaz.
  console.log('whatsapp-webhook: parse edildi', {
    business_id: business.id,
    phone_number_id: phoneNumberId,
    wamid,
    text_length: text.length,
  })

  // "RET": kampanya izni kapatilir, asistana iletilmez.
  if (isOptOutMessage(text)) {
    const { error: optErr } = await admin.rpc('opt_out_customer_by_phone', { p_business: business.id, p_phone: message.from })
    if (optErr) console.error('whatsapp-webhook: ret kaydedilemedi:', optErr.message)
    if (phoneNumberId) {
      await sendWhatsAppText({
        phoneNumberId,
        to: message.from,
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
      .eq('customer_phone', message.from)
    if (resetErr) console.error('whatsapp-webhook: sohbet sıfırlanamadı:', resetErr.message)
    if (phoneNumberId) {
      await sendWhatsAppText({
        phoneNumberId,
        to: message.from,
        message: resetErr ? 'Sohbet sıfırlanamadı.' : 'Sohbet sıfırlandı (test). Yeni bir konuşma gibi yazabilirsiniz.',
      })
    }
    return
  }

  const botPayload: N8nForwardPayload = {
    business_id: business.id,
    phone_number_id: phoneNumberId,
    from: message.from,
    customer_name: customerName,
    message: text,
    wamid,
  }
  // BOT_ENGINE=n8n: eski n8n akisina geri donus (yedek)
  if (Deno.env.get('BOT_ENGINE') === 'n8n') await forwardToN8n(botPayload)
  else await answerWithChatbot(admin, botPayload)
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
