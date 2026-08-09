import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256Hex } from './crypto.ts'

// Isletmeyi iki yoldan biriyle bulur:
// - x-api-key header'i (mevcut desen — test araclari, elle yapilandirilmis
//   n8n akislari, tek-isletmeli entegrasyonlar).
// - whatsapp_phone_number_id (YENI — cok-isletmeli WhatsApp: Meta'nin
//   webhook'u gelen mesajda hangi numaraya geldigini bildiriyor, n8n bunu
//   dogrudan gonderip hangi isletme oldugunu koda hic sabitlemeden bulabilir).
export async function resolveBusiness(
  admin: SupabaseClient,
  req: Request,
  phoneNumberId?: string | null,
): Promise<{ id: string; name: string } | null> {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey) {
    const keyHash = await sha256Hex(apiKey)
    const { data } = await admin.from('businesses').select('id, name').eq('api_key_hash', keyHash).maybeSingle()
    return data ?? null
  }
  if (phoneNumberId) {
    const { data } = await admin
      .from('businesses')
      .select('id, name')
      .eq('whatsapp_phone_number_id', phoneNumberId)
      .maybeSingle()
    return data ?? null
  }
  return null
}
