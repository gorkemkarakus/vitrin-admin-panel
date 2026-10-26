import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { findCustomersByPhone } from './customerLookup.ts'

// Musteri temsilciye aktarildi (fotografini gostermek istedi ya da yazamiyor):
// asistan bu kiside bir sure susar, konusma Mesajlar'da "Bot devretti · yanıt
// bekliyor" olur ve Bildirimler'de gorunur. Gece gelen istege salon sabah
// donebilsin diye 12 saat.
export const HANDOVER_PAUSE_HOURS = 12

// Asistani bu numarada susturur. Ayni numaranin butun kayitlari ("0532..." ve
// eskiden bot acmis "90532...") birlikte susar; kayit yoksa acilir.
export async function pauseBotForCustomer(
  admin: SupabaseClient,
  businessId: string,
  customerPhone: string,
  hours = HANDOVER_PAUSE_HOURS,
): Promise<void> {
  const until = new Date(Date.now() + hours * 3600000).toISOString()
  const { all } = await findCustomersByPhone<{ id: string; bot_paused_until: string | null }>(
    admin,
    businessId,
    customerPhone,
    'id, bot_paused_until',
  )
  if (all.length) {
    // daha uzun bir susturma kisaltilmaz
    const ids = all.filter((c) => !c.bot_paused_until || c.bot_paused_until < until).map((c) => c.id)
    if (!ids.length) return
    const { error } = await admin.from('customers').update({ bot_paused_until: until }).in('id', ids)
    if (error) console.error('botPause: asistan susturulamadı:', error.message)
    return
  }
  const { error } = await admin
    .from('customers')
    .insert({ business_id: businessId, phone: customerPhone, full_name: 'Müşteri', bot_paused_until: until })
  if (error) console.error('botPause: müşteri oluşturulamadı:', error.message)
}
