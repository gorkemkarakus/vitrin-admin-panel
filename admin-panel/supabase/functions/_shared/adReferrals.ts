import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { findCustomersByPhone, phoneVariants } from './customerLookup.ts'

// Musteri Meta reklamindan ("WhatsApp'a mesaj gönder" / "Instagram Direct'e
// mesaj gönder") ilk mesajini atinca Meta reklamin kimligini ve basligini
// mesajla gonderir (WhatsApp: messages[0].referral, Instagram: message.referral).
export interface AdReferralInput {
  channel: 'whatsapp' | 'instagram'
  adId?: string | null
  title?: string | null
  body?: string | null
  sourceUrl?: string | null
  clickId?: string | null
}

// Reklamdan gelen kisiye bu kadar gun icinde acilan randevu reklama sayilir.
export const AD_ATTRIBUTION_DAYS = 30

export async function recordAdReferral(
  admin: SupabaseClient,
  businessId: string,
  customerPhone: string,
  ref: AdReferralInput,
): Promise<void> {
  const cut = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null)
  const { error } = await admin.from('ad_referrals').insert({
    business_id: businessId,
    channel: ref.channel,
    customer_phone: customerPhone,
    ad_id: cut(ref.adId, 64),
    ad_title: cut(ref.title, 200),
    ad_body: cut(ref.body, 1000),
    source_url: cut(ref.sourceUrl, 500),
    click_id: cut(ref.clickId, 200),
  })
  if (error) {
    console.error('adReferrals: reklam bilgisi kaydedilemedi:', error.message)
    return
  }
  // kayitli musterinin kaynagi bossa "reklam"; salonun elle sectigi kaynak degismez
  const { ids } = await findCustomersByPhone(admin, businessId, customerPhone, 'id')
  if (ids.length) {
    const { error: srcErr } = await admin.from('customers').update({ source: 'reklam' }).in('id', ids).is('source', null)
    if (srcErr) console.error('adReferrals: müşteri kaynağı güncellenemedi:', srcErr.message)
  }
  console.log('adReferrals: reklamdan gelen konuşma kaydedildi', { business_id: businessId, channel: ref.channel })
}

// Asistan randevu acarken: bu kisi son 30 gunde reklamdan geldiyse o reklam
// kaydi. Ayni reklam tiklamasi tek randevuya sayilir (ikinci randevu reklamin
// degil, musterinin donusu).
export async function latestAdReferral(admin: SupabaseClient, businessId: string, customerPhone: string): Promise<string | null> {
  const since = new Date(Date.now() - AD_ATTRIBUTION_DAYS * 86400000).toISOString()
  const { data } = await admin
    .from('ad_referrals')
    .select('id')
    .eq('business_id', businessId)
    .in('customer_phone', phoneVariants(customerPhone))
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
  const id = data?.[0]?.id as string | undefined
  if (!id) return null
  const { count } = await admin.from('appointments').select('id', { count: 'exact', head: true }).eq('ad_referral_id', id)
  return count ? null : id
}
