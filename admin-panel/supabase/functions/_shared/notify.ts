import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// TEK gonderim noktasi. WhatsApp Business numarasi baglaninca DEGISECEK
// TEK yer burasi — su an gercek bir mesaj GONDERMIYOR, notification_log'a
// yaziyor (boylece hatirlatma/onay mantigini gercek WhatsApp olmadan da
// test edebiliyoruz). Ileride buraya WhatsApp Cloud API cagrisi eklenince
// tetikleyiciler, zamanlayici, mesaj icerigi HIC degismeden calismaya
// devam eder.
export async function sendCustomerMessage(
  admin: SupabaseClient,
  params: {
    businessId: string
    customerId: string | null
    phone: string | null
    kind: 'confirmation' | 'reminder' | 'bulk_campaign'
    message: string
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!params.phone) {
    return { ok: false, error: 'Müşteri telefonu yok, bildirim atlandı' }
  }

  // TODO(whatsapp): burayi gercek WhatsApp Cloud API POST cagrisiyla degistir.
  const { error } = await admin.from('notification_log').insert({
    business_id: params.businessId,
    customer_id: params.customerId,
    kind: params.kind,
    phone: params.phone,
    message: params.message,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
