import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { encryptToken, sha256Hex } from '../_shared/crypto.ts'
import { exchangeCode, getPhoneInfo, registerPhone, subscribeApp } from '../_shared/metaWhatsApp.ts'
import { forgetWhatsappAccessToken } from '../_shared/whatsappToken.ts'

// Sitedeki baglama sayfasi Meta penceresi bitince buraya gelir:
// { session, code, waba_id, phone_number_id }. Kimlik dogrulama tek
// kullanimlik oturum kodudur (whatsapp-connect-start). Meta'nin kodu 30 sn
// yasadigi icin ilk is takas edilir.
const ID_RE = /^\d{5,30}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => null)
  const session = typeof body?.session === 'string' ? body.session : ''
  const code = typeof body?.code === 'string' ? body.code : ''
  const wabaId = typeof body?.waba_id === 'string' ? body.waba_id : ''
  const phoneNumberId = typeof body?.phone_number_id === 'string' ? body.phone_number_id : ''
  if (!/^[0-9a-f]{64}$/.test(session) || !code || code.length > 2000 || !ID_RE.test(wabaId) || !ID_RE.test(phoneNumberId)) {
    return json({ error: 'Eksik ya da geçersiz bağlantı bilgisi' }, 400)
  }

  const encKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!encKey || !Deno.env.get('WHATSAPP_APP_SECRET')) {
    console.error('whatsapp-connect-complete: TOKEN_ENCRYPTION_KEY ya da WHATSAPP_APP_SECRET eksik')
    return json({ error: 'Sunucu ayarı eksik, lütfen bizimle iletişime geçin' }, 500)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Oturum tek seferde ve atomik olarak kullanilir; ayni kod ikinci kez gelirse bos doner.
  const { data: sess } = await admin
    .from('whatsapp_connect_sessions')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', await sha256Hex(session))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('business_id, user_id')
    .maybeSingle()
  if (!sess) return json({ error: 'Bağlantının süresi doldu. Uygulamadan "WhatsApp\'ı bağla"ya yeniden basın.' }, 410)

  const exchanged = await exchangeCode(code)
  if (!exchanged.ok) {
    console.error('whatsapp-connect-complete: kod takas edilemedi', exchanged.error)
    return json({ error: 'Meta bağlantısı tamamlanamadı, lütfen yeniden deneyin' }, 502)
  }
  const token = exchanged.data.access_token

  const phone = await getPhoneInfo(phoneNumberId, token)
  if (!phone.ok) {
    console.error('whatsapp-connect-complete: numara bilgisi alınamadı', phone.error)
    return json({ error: 'Numara bilgisi alınamadı, lütfen yeniden deneyin' }, 502)
  }

  // Ayni numara baska bir salona bagliysa ikinci kez baglanamaz.
  const { data: other } = await admin
    .from('businesses')
    .select('id')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .neq('id', sess.business_id)
    .maybeSingle()
  if (other) return json({ error: 'Bu numara başka bir işletmeye bağlı' }, 409)

  const coexistence = phone.data.is_on_biz_app === true
  let encryptedPin: string | null = null
  if (!coexistence) {
    // Yeni numara: Cloud API'ye kaydedilir; iki adimli dogrulama PIN'i saklanir.
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
    const reg = await registerPhone(phoneNumberId, token, pin)
    if (!reg.ok) {
      console.error('whatsapp-connect-complete: numara kaydedilemedi', reg.error)
      return json({ error: 'Numara WhatsApp\'a kaydedilemedi: ' + reg.error }, 502)
    }
    encryptedPin = await encryptToken(pin, encKey)
  }

  const sub = await subscribeApp(wabaId, token)
  if (!sub.ok) {
    console.error('whatsapp-connect-complete: webhook aboneliği açılamadı', sub.error)
    return json({ error: 'Mesaj bildirimleri açılamadı, lütfen yeniden deneyin' }, 502)
  }

  const { error: upErr } = await admin.from('business_whatsapp_connections').upsert(
    {
      business_id: sess.business_id,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      display_phone_number: phone.data.display_phone_number ?? null,
      verified_name: phone.data.verified_name ?? null,
      coexistence,
      encrypted_access_token: await encryptToken(token, encKey),
      encrypted_pin: encryptedPin,
      connected_by: sess.user_id,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'business_id' },
  )
  if (upErr) {
    console.error('whatsapp-connect-complete: bağlantı kaydedilemedi', upErr.message)
    return json({ error: 'Bağlantı kaydedilemedi, lütfen yeniden deneyin' }, 500)
  }

  // Gelen mesajlar bu numara kimligiyle salona yonlenir.
  const { error: bizErr } = await admin
    .from('businesses')
    .update({ whatsapp_phone_number_id: phoneNumberId })
    .eq('id', sess.business_id)
  if (bizErr) {
    console.error('whatsapp-connect-complete: işletme güncellenemedi', bizErr.message)
    return json({ error: 'Bağlantı kaydedilemedi, lütfen yeniden deneyin' }, 500)
  }
  forgetWhatsappAccessToken(phoneNumberId)

  console.log('whatsapp-connect-complete: bağlandı', { business_id: sess.business_id, phone_number_id: phoneNumberId, coexistence })
  return json(
    {
      data: {
        display_phone_number: phone.data.display_phone_number ?? null,
        verified_name: phone.data.verified_name ?? null,
        coexistence,
      },
    },
    200,
  )
})
