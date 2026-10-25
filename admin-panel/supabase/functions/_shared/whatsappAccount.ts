import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptToken } from './crypto.ts'

// Isletmenin WhatsApp hesabi (sablonlar hesap basina tanimlanir): salon kendi
// numarasini bagladiysa onun hesabi ve anahtari, baglamadiysa ve Meta test
// numarasini kullaniyorsa test hesabi (WHATSAPP_WABA_ID + WHATSAPP_TOKEN).
export interface WhatsappAccount {
  wabaId: string
  token: string
}

export async function businessWhatsappAccount(admin: SupabaseClient, businessId: string): Promise<WhatsappAccount | null> {
  const [{ data: conn }, { data: biz }] = await Promise.all([
    admin
      .from('business_whatsapp_connections')
      .select('waba_id, encrypted_access_token')
      .eq('business_id', businessId)
      .maybeSingle(),
    admin.from('businesses').select('whatsapp_phone_number_id').eq('id', businessId).maybeSingle(),
  ])

  const key = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (conn?.waba_id && conn.encrypted_access_token && key) {
    try {
      return { wabaId: conn.waba_id, token: await decryptToken(conn.encrypted_access_token, key) }
    } catch (e) {
      console.error('businessWhatsappAccount: anahtar çözülemedi:', e instanceof Error ? e.message : e)
      return null
    }
  }

  const testWaba = Deno.env.get('WHATSAPP_WABA_ID')
  const testToken = Deno.env.get('WHATSAPP_TOKEN')
  if (biz?.whatsapp_phone_number_id && testWaba && testToken) return { wabaId: testWaba, token: testToken }
  return null
}
