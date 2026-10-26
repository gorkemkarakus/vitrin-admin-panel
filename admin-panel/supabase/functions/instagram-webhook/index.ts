import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'
import { botSharedSecret } from '../_shared/resolveBusiness.ts'
import { runChatbot } from '../_shared/chatbot.ts'
import {
  getUserName,
  igCustomerId,
  IG_PREFIX,
  IG_SENT_KEY,
  instagramConnection,
  recordInstagramSent,
  sendInstagramText,
  sendInstagramTyping,
} from '../_shared/instagram.ts'
import { handler as contextHandler } from '../chatbot-context/handler.ts'
import { handler as bookHandler } from '../book-appointment/handler.ts'
import { handler as cancelHandler } from '../cancel-appointment/handler.ts'
import { handler as rescheduleHandler } from '../reschedule-appointment/handler.ts'
import { handler as logHandler } from '../chatbot-log-message/handler.ts'

// Instagram DM'leri: salonun bagli Instagram hesabina gelen mesaja WhatsApp'taki
// ayni asistan cevap verir. Musteri "ig:<IGSID>", isletmenin hesabi bot
// fonksiyonlarina "ig:<hesap kimligi>" olarak gecer (resolveBusiness).
// Instagram'da personel kontrolu (staff-whatsapp-webhook) yok; personel
// telefon numarasiyla taninir.
const BOT_HANDLERS: Record<string, (req: Request) => Promise<Response>> = {
  'chatbot-context': contextHandler,
  'book-appointment': bookHandler,
  'cancel-appointment': cancelHandler,
  'reschedule-appointment': rescheduleHandler,
  'chatbot-log-message': logHandler,
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

interface IgMessage {
  mid?: string
  text?: string
  is_echo?: boolean
  is_deleted?: boolean
  attachments?: unknown[]
}

interface IgMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: IgMessage
}

interface IgEntry {
  id?: string
  messaging?: IgMessagingEvent[]
  changes?: { field?: string; value?: IgMessagingEvent }[]
}

// Islenen mesaj kimlikleri (whatsapp_processed_messages paylasilir, onekle ayrilir):
// gelen DM ve salonun Instagram'dan yazdigi (bizim gonderdiklerimiz: IG_SENT_KEY).
const IN_KEY = 'ig-in:'
const ECHO_KEY = 'ig-echo:'

// Salon musteriye Instagram uygulamasindan yazinca asistan bu musteride bu kadar susar.
const ECHO_PAUSE_HOURS = 3

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// "Instagram ile giris" olaylari entry.messaging'de gelir; eski bicimde entry.changes.
function messagingEvents(entry: IgEntry): IgMessagingEvent[] {
  if (entry.messaging?.length) return entry.messaging
  return (entry.changes ?? []).filter((c) => c.field === 'messages' && c.value).map((c) => c.value!)
}

async function wasSentByUs(admin: SupabaseClient, mid: string): Promise<boolean> {
  const { data } = await admin.from('whatsapp_processed_messages').select('wamid').eq('wamid', IG_SENT_KEY + mid).maybeSingle()
  return !!data
}

// Salon musteriye Instagram uygulamasindan yazdi: asistan o musteride susar,
// mesaj sohbet gecmisine "salon" olarak eklenir. Bizim API'den gonderdigimiz
// mesajlar da echo olarak doner; onlar kayitli kimligiyle ayrilir.
async function handleEcho(admin: SupabaseClient, igUserId: string, ev: IgMessagingEvent): Promise<void> {
  const mid = ev.message?.mid
  const customerIgsid = ev.recipient?.id
  if (!mid || !customerIgsid) return
  // gonderim cevabi kaydedilmeden echo gelebilir; kisa bir bekleyisle yeniden bakilir
  if (await wasSentByUs(admin, mid)) return
  await new Promise((r) => setTimeout(r, 2000))
  if (await wasSentByUs(admin, mid)) return

  const { error: dupErr } = await admin.from('whatsapp_processed_messages').insert({ wamid: ECHO_KEY + mid })
  if (dupErr) {
    if (dupErr.code !== '23505') console.error('instagram-webhook: echo kaydı başarısız:', dupErr.message)
    return
  }

  const conn = await instagramConnection(admin, { igUserId })
  if (!conn) return
  const customerId = igCustomerId(customerIgsid)
  const until = new Date(Date.now() + ECHO_PAUSE_HOURS * 3600000).toISOString()
  const { data: customer } = await admin
    .from('customers')
    .select('id, bot_paused_until')
    .eq('business_id', conn.businessId)
    .eq('phone', customerId)
    .maybeSingle()
  if (customer) {
    if (!customer.bot_paused_until || customer.bot_paused_until < until) {
      await admin.from('customers').update({ bot_paused_until: until }).eq('id', customer.id)
    }
  } else {
    const { error: insErr } = await admin
      .from('customers')
      .insert({ business_id: conn.businessId, phone: customerId, full_name: 'Müşteri', bot_paused_until: until })
    if (insErr) console.error('instagram-webhook: echo müşterisi oluşturulamadı:', insErr.message)
  }

  if (ev.message?.text) {
    const { error: logErr } = await admin.from('chatbot_messages').insert({
      business_id: conn.businessId,
      customer_phone: customerId,
      role: 'staff',
      content: ev.message.text,
    })
    if (logErr) console.error('instagram-webhook: echo mesajı kaydedilemedi:', logErr.message)
  }
  console.log('instagram-webhook: salon Instagram\'dan yazdı, asistan susturuldu', { business_id: conn.businessId })
}

async function handleMessage(admin: SupabaseClient, igUserId: string, ev: IgMessagingEvent): Promise<void> {
  const msg = ev.message
  const senderIgsid = ev.sender?.id
  if (!msg?.mid || !senderIgsid || msg.is_deleted) return
  // Simdilik yalniz metin; fotograf/ses/sticker atlanir (WhatsApp'taki gibi).
  if (!msg.text) {
    console.log('instagram-webhook: metin olmayan mesaj, atlanıyor')
    return
  }

  const { error: dupErr } = await admin.from('whatsapp_processed_messages').insert({ wamid: IN_KEY + msg.mid })
  if (dupErr) {
    if (dupErr.code !== '23505') console.error('instagram-webhook: mesaj kaydı başarısız:', dupErr.message)
    return
  }

  const conn = await instagramConnection(admin, { igUserId })
  if (!conn) {
    console.log('instagram-webhook: bu hesaba bağlı işletme yok')
    return
  }
  const customerId = igCustomerId(senderIgsid)
  const text = msg.text

  // Loglarda kisisel veri yok: kimlik, isim ve mesaj metni yazilmaz.
  console.log('instagram-webhook: mesaj alındı', { business_id: conn.businessId, text_length: text.length })

  // Test komutu "#sıfırla" (yalniz BOT_TEST_RESET=1): bu kisinin bot gecmisini siler.
  if (Deno.env.get('BOT_TEST_RESET') === '1' && /^#s[ıi]f[ıi]rla$/i.test(text.trim())) {
    const { error: resetErr } = await admin
      .from('chatbot_messages')
      .delete()
      .eq('business_id', conn.businessId)
      .eq('customer_phone', customerId)
    await sendInstagramText({
      token: conn.token,
      recipientIgsid: senderIgsid,
      message: resetErr ? 'Sohbet sıfırlanamadı.' : 'Sohbet sıfırlandı (test). Yeni bir konuşma gibi yazabilirsiniz.',
    })
    return
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  const botSecret = await botSharedSecret(admin)
  if (!supabaseUrl || !anonKey || !openaiKey || !botSecret) {
    console.error('instagram-webhook: asistan yapılandırması eksik')
    return
  }

  const [, customerName] = await Promise.all([
    sendInstagramTyping(conn.token, senderIgsid),
    getUserName(conn.token, senderIgsid),
  ])

  let result
  try {
    result = await runChatbot(
      {
        business_id: conn.businessId,
        phone_number_id: IG_PREFIX + conn.igUserId,
        from: customerId,
        customer_name: customerName,
        message: text,
        wamid: msg.mid,
      },
      { supabaseUrl, anonKey, openaiKey, botSecret, handlers: BOT_HANDLERS },
    )
  } catch (e) {
    console.error('instagram-webhook: asistan hatası:', e instanceof Error ? e.message : e)
    return
  }
  if (!result.reply.trim()) {
    await result.log
    return
  }
  const [sent] = await Promise.all([
    sendInstagramText({ token: conn.token, recipientIgsid: senderIgsid, message: result.reply.trim() }),
    result.log,
  ])
  if (!sent.ok) {
    console.error('instagram-webhook: cevap gönderilemedi:', sent.error)
    return
  }
  // Bu mesajin echo'su gelince salonun yazdigi sanilmasin.
  await recordInstagramSent(admin, sent.messageId)
  console.log('instagram-webhook: cevap gönderildi', { business_id: conn.businessId })
}

async function processWebhookEvent(admin: SupabaseClient, rawBody: string): Promise<void> {
  let payload: { object?: string; entry?: IgEntry[] }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('instagram-webhook: geçersiz JSON body')
    return
  }
  if (payload.object !== 'instagram') return

  for (const entry of payload.entry ?? []) {
    for (const ev of messagingEvents(entry)) {
      const igUserId = String(entry.id ?? (ev.message?.is_echo ? ev.sender?.id : ev.recipient?.id) ?? '')
      if (!igUserId) continue
      try {
        if (ev.message?.is_echo) await handleEcho(admin, igUserId, ev)
        else await handleMessage(admin, igUserId, ev)
      } catch (e) {
        console.error('instagram-webhook: olay işlenemedi:', e instanceof Error ? e.message : e)
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const expectedToken = Deno.env.get('INSTAGRAM_VERIFY_TOKEN')
    if (mode === 'subscribe' && challenge && token && expectedToken && timingSafeEqualString(token, expectedToken)) {
      return new Response(challenge, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } })
    }
    return json({ error: 'Doğrulama başarısız' }, 403)
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const appSecret = Deno.env.get('INSTAGRAM_APP_SECRET')
  if (!appSecret) return json({ error: 'Instagram yapılandırılmamış' }, 500)

  // Imza ham govde uzerinden dogrulanir (bkz. whatsapp-webhook).
  const rawBody = await req.text()
  const signatureHeader = req.headers.get('x-hub-signature-256') ?? ''
  const providedHex = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : ''
  const expectedHex = await hmacSha256Hex(appSecret, rawBody)
  if (!providedHex || !timingSafeEqualString(providedHex, expectedHex)) {
    return json({ error: 'Geçersiz imza' }, 401)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  EdgeRuntime.waitUntil(processWebhookEvent(admin, rawBody))
  return json({ status: 'received' }, 200)
})
