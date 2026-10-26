import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ayni Turk cep numarasinin musteri kayitlarindaki yazilislari: uygulamada
// "05321234567" ya da "5321234567", WhatsApp'ta "905321234567". Musteri
// eskiden yalniz birebir yazilisla aranıyordu: uygulamada kayitli musteri
// WhatsApp'tan yazinca bot onu tanimiyor, randevularini goremiyor ve ikinci
// bir "Müşteri" kaydi aciyordu. Instagram kimligi ("ig:...") ve WhatsApp
// kullanici kimligi ("TR.1824...") oldugu gibi aranir.
export function phoneVariants(raw: string): string[] {
  const d = raw.replace(/\D/g, '')
  const local = /^905\d{9}$/.test(d) ? d.slice(2) : /^05\d{9}$/.test(d) ? d.slice(1) : /^5\d{9}$/.test(d) ? d : null
  if (!local || raw.startsWith('ig:') || /^[A-Z]{2}\./.test(raw)) return [raw]
  return [...new Set([raw, '90' + local, '0' + local, local, '+90' + local])]
}

export interface PhoneCustomers<T> {
  // asil kayit: adi bilinen en eski kayit (yoksa en eski)
  primary: T | null
  // ayni numaranin butun kayitlari (eskiden acilmis ikinci kayitlar dahil)
  all: T[]
  ids: string[]
}

export async function findCustomersByPhone<T extends { id: string }>(
  admin: SupabaseClient,
  businessId: string,
  phone: string,
  columns: string,
): Promise<PhoneCustomers<T>> {
  const cols = new Set(columns.split(',').map((c) => c.trim()).filter(Boolean))
  cols.add('id')
  cols.add('full_name')
  cols.add('created_at')
  const { data, error } = await admin
    .from('customers')
    .select([...cols].join(', '))
    .eq('business_id', businessId)
    .in('phone', phoneVariants(phone))
    .order('created_at', { ascending: true })
  if (error) console.error('customerLookup: müşteri aranamadı:', error.message)
  const rows = ((data ?? []) as unknown) as (T & { full_name?: string | null })[]
  const primary = rows.find((c) => c.full_name && c.full_name !== 'Müşteri') ?? rows[0] ?? null
  return { primary, all: rows, ids: rows.map((c) => c.id) }
}
