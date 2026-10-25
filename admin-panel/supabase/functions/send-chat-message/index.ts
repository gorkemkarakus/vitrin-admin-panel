import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { sendWhatsAppText } from '../_shared/notify.ts'

// Mesajlar ekranindan salonun musteriye WhatsApp'tan yazmasi. Yalnizca bu
// isletmeye daha once yazmis kisiye ve WhatsApp'in 24 saatlik serbest mesaj
// penceresi icinde gonderilir (pencere kapaliysa Meta da reddeder; burada
// once kontrol edilip anlasilir bir hata donulur). Gonderilen mesaj 'staff'
// olarak kaydedilir ve bot o musteri icin bir sure susar — telefondaki
// WhatsApp Business'tan yazildiginda oldugu gibi (whatsapp-webhook echo).
const WINDOW_MS = 24 * 3600000
const PAUSE_MS = 3 * 3600000
const MAX_LEN = 4096

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Yetkilendirme başlığı eksik' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Kimlik ve yetki cagiranin kendi oturumuyla: yonetici her zaman,
  // calisan "mesajlar" izni verildiyse.
  const body = await req.json().catch(() => null)
  const phone = typeof body?.customer_phone === 'string' ? body.customer_phone.trim() : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!phone || !message) return json({ error: 'Mesaj boş olamaz' }, 400)
  if (message.length > MAX_LEN) return json({ error: `Mesaj en fazla ${MAX_LEN} karakter olabilir` }, 400)

  // Birbirini beklemeyen sorgular ayni anda: oturum + yetki, sonra isletme + son musteri mesaji.
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const [{ data: userData, error: userErr }, { data: allowed }] = await Promise.all([
    caller.auth.getUser(),
    caller.rpc('has_perm', { p_perm: 'mesajlar' }),
  ])
  if (userErr || !userData.user) return json({ error: 'Geçersiz oturum' }, 401)
  if (allowed !== true) return json({ error: 'Mesaj göndermek için yetkiniz yok' }, 403)

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: profile } = await admin
    .from('profiles')
    .select('business_id, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!profile?.is_active || !profile.business_id) return json({ error: 'Bu işlemi yapamazsınız' }, 403)
  const businessId = profile.business_id as string

  const [{ data: business }, { data: lastIn }] = await Promise.all([
    admin.from('businesses').select('whatsapp_phone_number_id').eq('id', businessId).maybeSingle(),
    // Yalnizca isletmeye yazmis kisiye; serbest mesaj icin son yazisi 24 saat icinde olmali.
    admin
      .from('chatbot_messages')
      .select('created_at')
      .eq('business_id', businessId)
      .eq('customer_phone', phone)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const phoneNumberId = business?.whatsapp_phone_number_id as string | null
  if (!phoneNumberId) return json({ error: 'İşletmenin WhatsApp numarası bağlı değil' }, 409)
  if (!lastIn) {
    return json({ error: 'Bu kişi size henüz WhatsApp’tan yazmadı; ilk mesajı müşterinin atması gerekiyor.' }, 409)
  }
  if (Date.now() - new Date(lastIn.created_at).getTime() > WINDOW_MS) {
    return json(
      {
        error: 'Müşteri son 24 saatte yazmadığı için WhatsApp serbest mesaja izin vermiyor. Müşteri yeniden yazınca gönderebilirsiniz.',
        code: 'window_closed',
      },
      409,
    )
  }

  const sent = await sendWhatsAppText({ phoneNumberId, to: phone, message })
  if (!sent.ok) {
    console.error('send-chat-message: WhatsApp gönderimi başarısız:', sent.error)
    return json({ error: 'Mesaj gönderilemedi, birazdan tekrar deneyin.' }, 502)
  }

  const until = new Date(Date.now() + PAUSE_MS).toISOString()
  const [{ data: row, error: logErr }, { data: customer }] = await Promise.all([
    admin
      .from('chatbot_messages')
      .insert({ business_id: businessId, customer_phone: phone, role: 'staff', content: message })
      .select('role, content, customer_phone, created_at')
      .single(),
    admin
      .from('customers')
      .select('id, bot_paused_until')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .maybeSingle(),
  ])
  if (logErr) console.error('send-chat-message: mesaj kaydedilemedi:', logErr.message)
  if (customer && (!customer.bot_paused_until || customer.bot_paused_until < until)) {
    await admin.from('customers').update({ bot_paused_until: until }).eq('id', customer.id)
  }

  return json(
    { data: row ?? { role: 'staff', content: message, customer_phone: phone, created_at: new Date().toISOString() } },
    200,
  )
})
