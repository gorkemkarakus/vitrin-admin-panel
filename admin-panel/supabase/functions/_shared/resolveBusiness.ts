import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256Hex, timingSafeEqualString } from './crypto.ts'

// Isletmeyi iki yoldan biriyle bulur:
// - x-api-key header'i: isletmeye ozel anahtar (n8n akislari, test araclari).
// - whatsapp_phone_number_id: cok isletmeli WhatsApp'ta gelen mesajin hangi
//   numaraya geldigi. Numara kimligi gizli bir bilgi DEGILDIR (Meta panelinde,
//   webhook olaylarinda gorunur); bu yuzden bu yol yalnizca
//   - Meta imzasi dogrulanmis whatsapp-webhook icinden (trusted: true) ya da
//   - paylasilan gizli basligi (x-bot-secret) dogru gonderen cagiranlar
//   icin acilir. Aksi halde null doner, fonksiyon 401 verir.
export async function resolveBusiness(
  admin: SupabaseClient,
  req: Request,
  phoneNumberId?: string | null,
  opts: { trusted?: boolean } = {},
): Promise<{ id: string; name: string } | null> {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey) {
    const keyHash = await sha256Hex(apiKey)
    const { data } = await admin.from('businesses').select('id, name').eq('api_key_hash', keyHash).maybeSingle()
    return data ?? null
  }
  if (phoneNumberId) {
    if (!opts.trusted && !(await hasValidBotSecret(admin, req))) return null
    const { data } = await admin
      .from('businesses')
      .select('id, name')
      .eq('whatsapp_phone_number_id', phoneNumberId)
      .maybeSingle()
    return data ?? null
  }
  return null
}

// Paylasilan bot sirri: BOT_SHARED_SECRET ortam degiskeni ya da
// _app_secrets.bot_shared_secret (yalnizca service role okur). Musteri
// asistani (chatbot.ts) bot fonksiyonlarini bununla cagirir.
export async function botSharedSecret(admin: SupabaseClient): Promise<string | null> {
  const fromEnv = Deno.env.get('BOT_SHARED_SECRET')
  if (fromEnv) return fromEnv
  const { data } = await admin.from('_app_secrets').select('value').eq('name', 'bot_shared_secret').maybeSingle()
  return data?.value ?? null
}

async function hasValidBotSecret(admin: SupabaseClient, req: Request): Promise<boolean> {
  const provided = req.headers.get('x-bot-secret')
  if (!provided) return false
  const secret = await botSharedSecret(admin)
  return !!secret && timingSafeEqualString(provided, secret)
}
