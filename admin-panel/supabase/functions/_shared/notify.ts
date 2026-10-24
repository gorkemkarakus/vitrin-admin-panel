import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { whatsappAccessToken } from './whatsappToken.ts'

// Coklu-isletme oldugu icin sabit tek numara YOK — hangi isletmenin
// numarasindan gonderilecegini cagiran belirler (businesses.whatsapp_phone_number_id).
//
// SADECE veritabanindaki (customers.phone/contact_phone) Turkce yazilmis
// numaralar icin — musteriler numarayi "0532...", "532..." gibi ulke kodu
// olmadan girebiliyor, bu onlara varsayilan 90 kodunu ekliyor. Meta'nin
// kendi webhook'undan gelen 'from' alanina ASLA uygulanmamali — o zaten
// tam/dogru uluslararasi formatta (ornegin Rusya +7 test numarasi icin
// "7999..."), bu fonksiyondan gecirilirse "90" yanlislikla baslatilip
// numara bozuluyor (canli testte tam olarak bu hata yakalandi — +7 test
// numarasina cevap gitmiyordu).
function toWhatsAppPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('90') ? digits : digits.startsWith('0') ? '9' + digits : '90' + digits
}

// Ham Cloud API gonderimi — notification_log/chatbot_messages yan etkileri
// OLMADAN. `to` cagiran tarafindan ZATEN normalize edilmis olmali (ulke kodu
// dahil, sadece rakam) — burada bir daha donusturulmuyor, cunku kaynaga gore
// (DB'den mi Meta'nin kendi webhook'undan mi) farkli/celisen normalizasyon
// gerekiyor, tek bir ortak kural burada YANLIS olurdu. sendCustomerMessage
// (asagida) hem bunu hem notification_log/chatbot_messages yan etkilerini
// birlikte yapiyor (bildirim/hatirlatma/kampanya akislari icin); ama chatbot
// akisinda (whatsapp-webhook -> n8n -> buraya) konusma zaten n8n'in kendi
// "Log Messages" adimiyla chatbot_messages'a yaziliyor — o yuzden whatsapp-
// webhook bu ham fonksiyonu DOGRUDAN cagiriyor, sendCustomerMessage'i degil,
// aksi halde ayni asistan cevabi chatbot_messages'a IKI KEZ yazilirdi.
// Isletmeye ozel WhatsApp kullanici kimligi (BSUID): iki harf ulke kodu +
// nokta + harf/rakam, ör. "TR.1824962542022888" (bayi kimligi "US.ENT....").
export function isBusinessScopedUserId(id: string): boolean {
  return /^[A-Z]{2}\.[A-Za-z0-9.]+$/.test(id)
}

export async function sendWhatsAppText(params: {
  phoneNumberId: string
  to: string
  message: string
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  // salonun kendi numarasiysa onun anahtari, degilse (test numarasi) WHATSAPP_TOKEN
  const token = await whatsappAccessToken(params.phoneNumberId)
  if (!token) return { ok: false, error: 'WhatsApp erişim anahtarı yok' }

  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${params.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        // Telefon numarasi "to"ya, isletmeye ozel kullanici kimligi (BSUID,
        // "TR.1824..." gibi; numarasini gizleyen kullanici adli kisiler)
        // "recipient"a yazilir (Meta Cloud API).
        ...(isBusinessScopedUserId(params.to) ? { recipient: params.to } : { to: params.to }),
        type: 'text',
        text: { body: params.message },
      }),
    })
    const resBody = await res.json().catch(() => null)
    if (!res.ok) {
      // 24 saatlik serbest-metin penceresi kapaliysa Meta burada hata doner
      // (ornegin #131047) — sablon-mesaj fallback'i ayri bir is, simdilik
      // sadece cagirana hatayi donuyoruz, o loglar.
      return { ok: false, error: JSON.stringify(resBody) }
    }
    return { ok: true, messageId: resBody?.messages?.[0]?.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Musterinin mesajini "okundu" yapar ve asistan cevabi hazirlarken WhatsApp'ta
// "yaziyor..." gosterir (Meta en fazla 25 sn gosterir, cevap gelince kalkar).
// Basarisiz olursa sessizce gecilir; cevap yine gider.
export async function sendTypingIndicator(params: { phoneNumberId: string; messageId: string }): Promise<void> {
  const token = await whatsappAccessToken(params.phoneNumberId)
  if (!token) return
  try {
    await fetch(`https://graph.facebook.com/v25.0/${params.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: params.messageId,
        typing_indicator: { type: 'text' },
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // gostergesiz devam
  }
}

// TEK gonderim noktasi (bildirim/hatirlatma/kampanya). notification_log
// yazimi HER ZAMAN calisir (denetim izi, WhatsApp baglantisindan bagimsiz).
// phoneNumberId verilmemisse (isletme henuz WhatsApp'a baglanmadiysa —
// coguna henuz baglanmadi) gercek gonderim sessizce atlanir, sadece log
// kalir; bu HATA sayilmaz.
export async function sendCustomerMessage(
  admin: SupabaseClient,
  params: {
    businessId: string
    customerId: string | null
    phone: string | null
    phoneNumberId: string | null
    kind: 'confirmation' | 'reminder' | 'bulk_campaign'
    message: string
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!params.phone) {
    return { ok: false, error: 'Müşteri telefonu yok, bildirim atlandı' }
  }

  const { error: logError } = await admin.from('notification_log').insert({
    business_id: params.businessId,
    customer_id: params.customerId,
    kind: params.kind,
    phone: params.phone,
    message: params.message,
  })
  if (logError) return { ok: false, error: logError.message }

  if (!params.phoneNumberId) return { ok: true }

  // Asagidaki hicbir dal exception firlatmiyor / ok:false dondurmuyor —
  // notification_log zaten yazildi (denetim izi korunuyor), bu yuzden bir
  // WhatsApp gonderim hatasi cagiranin akisini (ornegin
  // process-appointment-reminders'in reminder_sent_at isaretlemesini)
  // cokertmemeli. Ozellikle hatirlatma mesajlari icin bu KRITIK: musteri
  // 24 saattir yazmadiysa Meta serbest-metin penceresi kapali oldugu icin
  // hata donecek — bu HER 15 dakikada bir tekrar denenip Meta'ya sonsuza
  // kadar basarisiz istek atilmasina yol acmamali.
  const result = await sendWhatsAppText({ phoneNumberId: params.phoneNumberId, to: toWhatsAppPhone(params.phone), message: params.message })
  if (!result.ok) {
    console.error('sendCustomerMessage: WhatsApp gönderimi başarısız:', result.error)
    return { ok: true }
  }
  console.log('sendCustomerMessage: WhatsApp gönderimi başarılı, message id:', result.messageId)

  const { error: chatLogError } = await admin.from('chatbot_messages').insert({
    business_id: params.businessId,
    customer_phone: params.phone,
    role: 'assistant',
    content: params.message,
  })
  if (chatLogError) {
    console.error('sendCustomerMessage: chatbot_messages kaydı başarısız:', chatLogError.message)
  }

  return { ok: true }
}
