import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { json } from './http.ts'

// Paket kontrolleri. Sinirlar/ozellikler plan_definitions tablosunda
// (migration 20261018000001_plans.sql); burada sabit deger YOK.
export type PlanFeature =
  | 'staff'
  | 'pdf_reports'
  | 'ai_command'
  | 'ai_insights'
  | 'unbranded_booking'
  | 'whatsapp_bot'
  | 'instagram_bot'
  | 'staff_whatsapp'
  | 'messages'
  | 'bulk_campaign'
  | 'ads'
  | 'own_number_reminders'

export async function planHas(admin: SupabaseClient, businessId: string, feature: PlanFeature): Promise<boolean> {
  const { data, error } = await admin.rpc('plan_has', { p_business: businessId, p_feature: feature })
  if (error) {
    // Paket tablosu okunamazsa ozelligi KAPATMA: kontrol bir ticari sinir,
    // altyapi hatasinda mevcut kullanicilari kesmemeli. Loglanir.
    console.error('plan_has hatasi:', error.message)
    return true
  }
  return data === true
}

// null = sinirsiz
export async function planLimit(admin: SupabaseClient, businessId: string, key: string): Promise<number | null> {
  const { data, error } = await admin.rpc('plan_limit', { p_business: businessId, p_key: key })
  if (error) {
    console.error('plan_limit hatasi:', error.message)
    return null
  }
  return typeof data === 'number' ? data : null
}

// Ozellik paketinde yoksa 403 yaniti (istemci "code" ile yukseltme ekranini acar).
export async function requireFeature(
  admin: SupabaseClient,
  businessId: string,
  feature: PlanFeature,
): Promise<Response | null> {
  if (await planHas(admin, businessId, feature)) return null
  return json({ error: 'Bu özellik paketinizde yok.', code: 'PLAN_FEATURE', feature }, 403)
}

// Veritabani tetikleyicisinin "PLAN_LIMIT:<anahtar>" hatasini taniyip yanit uretir.
export function planLimitResponse(err: { message?: string } | null | undefined): Response | null {
  const m = err?.message?.match(/PLAN_LIMIT:([a-z_]+)/)
  if (!m) return null
  const messages: Record<string, string> = {
    max_users: 'Paketinizdeki kullanıcı sınırına ulaştınız.',
    appointments_per_month: 'Paketinizin bu ayki randevu sınırına ulaştınız.',
    max_customers: 'Paketinizdeki müşteri sınırına ulaştınız.',
  }
  return json({ error: messages[m[1]] ?? 'Paket sınırına ulaştınız.', code: 'PLAN_LIMIT', limit: m[1] }, 403)
}
