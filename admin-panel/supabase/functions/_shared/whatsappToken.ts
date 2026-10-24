import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptToken } from './crypto.ts'

// Mesaj hangi numaradan gidecekse o numaranin erisim anahtari kullanilir:
// salon kendi numarasini bagladiysa (business_whatsapp_connections) onun
// anahtari, baglamadiysa (Meta test numarasi) WHATSAPP_TOKEN. Cozulmus
// anahtar birkac dakika bellekte tutulur; her mesajda veritabani + sifre
// cozme yapilmasin.
const CACHE_MS = 5 * 60 * 1000
const cache = new Map<string, { token: string | null; at: number }>()

export async function whatsappAccessToken(phoneNumberId: string): Promise<string | null> {
  const hit = cache.get(phoneNumberId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.token ?? Deno.env.get('WHATSAPP_TOKEN') ?? null

  let token: string | null = null
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data } = await admin
      .from('business_whatsapp_connections')
      .select('encrypted_access_token')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle()
    const key = Deno.env.get('TOKEN_ENCRYPTION_KEY')
    if (data?.encrypted_access_token && key) token = await decryptToken(data.encrypted_access_token, key)
  } catch (e) {
    // anahtar cozulemezse test anahtarina dusulur; gonderim hatasi loglanir
    console.error('whatsappAccessToken: bağlantı anahtarı okunamadı:', e instanceof Error ? e.message : e)
  }
  cache.set(phoneNumberId, { token, at: Date.now() })
  return token ?? Deno.env.get('WHATSAPP_TOKEN') ?? null
}

// Baglanti kaldirilinca ya da yenilenince eski anahtar bellekte kalmasin.
export function forgetWhatsappAccessToken(phoneNumberId: string): void {
  cache.delete(phoneNumberId)
}
