import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Musteri temsilciye aktarildi (fotografini gostermek istedi ya da yazamiyor):
// asistan bu kiside bir sure susar, konusma Mesajlar'da "Bot devretti · yanıt
// bekliyor" olur ve Bildirimler'de gorunur. Gece gelen istege salon sabah
// donebilsin diye 12 saat.
export const HANDOVER_PAUSE_HOURS = 12

export async function pauseBotForCustomer(
  admin: SupabaseClient,
  businessId: string,
  customerPhone: string,
  hours = HANDOVER_PAUSE_HOURS,
): Promise<void> {
  const until = new Date(Date.now() + hours * 3600000).toISOString()
  const { data: customer } = await admin
    .from('customers')
    .select('id, bot_paused_until')
    .eq('business_id', businessId)
    .eq('phone', customerPhone)
    .maybeSingle()
  if (customer) {
    if (!customer.bot_paused_until || customer.bot_paused_until < until) {
      const { error } = await admin.from('customers').update({ bot_paused_until: until }).eq('id', customer.id)
      if (error) console.error('botPause: asistan susturulamadı:', error.message)
    }
    return
  }
  const { error } = await admin
    .from('customers')
    .insert({ business_id: businessId, phone: customerPhone, full_name: 'Müşteri', bot_paused_until: until })
  if (error) console.error('botPause: müşteri oluşturulamadı:', error.message)
}
