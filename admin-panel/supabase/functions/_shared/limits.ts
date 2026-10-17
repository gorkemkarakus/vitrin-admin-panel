import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256Hex } from './crypto.ts'
import { json } from './http.ts'

// Maliyet doguran islemler icin isletme basi GUNLUK kotalar (Europe/Istanbul
// gunu). Kisa sureli tekrar sinirlari fonksiyonlarin kendi deneme
// tablolarinda; bunlar toplam harcamayi sinirlar.
export const DAILY_QUOTAS = {
  ai_campaign_message: 30, // AI ile kampanya metni yazdirma
  ai_insights: 10, // AI isletme analizi
  ai_command: 100, // dogal dille randevu komutu
  bulk_recipients: 500, // toplu mesajda gunluk toplam alici
} as const

export type QuotaKind = keyof typeof DAILY_QUOTAS

// Kota yeterliyse ayirir ve null doner; yetmiyorsa 429 yaniti doner.
// Veritabani fonksiyonu yoksa/hata verirse islem engellenmez (kota bir
// maliyet korumasi, temel ozellikleri kesmemeli) ama loglanir.
export async function consumeDailyQuota(
  admin: SupabaseClient,
  businessId: string,
  kind: QuotaKind,
  amount = 1,
): Promise<Response | null> {
  const { data, error } = await admin.rpc('consume_quota', {
    p_business: businessId,
    p_kind: kind,
    p_limit: DAILY_QUOTAS[kind],
    p_amount: amount,
  })
  if (error) {
    console.error('consume_quota hatasi:', error.message)
    return null
  }
  if (data === true) return null
  return json(
    { error: `Bugünkü kullanım sınırına ulaşıldı (günde ${DAILY_QUOTAS[kind]}). Yarın tekrar deneyebilirsin.` },
    429,
  )
}

// Istemci IP'sinin ozeti (IP'nin kendisi saklanmaz).
export async function clientKey(req: Request): Promise<string> {
  const ip =
    req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'bilinmiyor'
  return sha256Hex(`ip:${ip}`)
}

// Kayan pencere hiz siniri; asildiysa 429 yaniti doner, degilse null.
export async function rateLimit(
  admin: SupabaseClient,
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<Response | null> {
  const { data, error } = await admin.rpc('hit_rate_limit', {
    p_bucket: bucket,
    p_subject: subject,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) {
    console.error('hit_rate_limit hatasi:', error.message)
    return null
  }
  if (data === true) return null
  return json({ error: 'Çok fazla istek. Lütfen biraz bekleyip tekrar deneyin.' }, 429)
}
