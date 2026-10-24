// Istenen saat salonun tatiline ya da arife kapanisindan sonrasina mi denk
// geliyor? Tatiller musaitlikte calisanlara blok olarak yazildigi icin bu
// kontrol olmadan cevap "o saat dolu" oluyordu; musteri sebebi bilmeden ayni
// gunu tekrar deniyordu.
import { istanbulDateString, istanbulParts, toMinutes } from './availability.ts'

// deno-lint-ignore no-explicit-any
type Admin = any

export interface ClosedDay {
  name: string
  // arife: salon bu saatte kapaniyor (tam gun kapali degil)
  eve_closes_at?: string
}

export async function findClosedDay(admin: Admin, businessId: string, start: Date, durationMinutes: number): Promise<ClosedDay | null> {
  const date = istanbulDateString(start)
  const { data: holiday } = await admin
    .from('business_holidays')
    .select('name')
    .eq('business_id', businessId)
    .lte('start_date', date)
    .gte('end_date', date)
    .limit(1)
  if (holiday?.[0]) return { name: holiday[0].name as string }

  const nextDay = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
  const { data: eve } = await admin
    .from('business_holidays')
    .select('name, eve_closes_at')
    .eq('business_id', businessId)
    .eq('start_date', nextDay)
    .not('eve_closes_at', 'is', null)
    .limit(1)
  const closesAt = eve?.[0]?.eve_closes_at as string | undefined
  if (!closesAt) return null
  const { hours, minutes } = istanbulParts(start)
  const close = closesAt.slice(0, 5)
  return hours * 60 + minutes + durationMinutes > toMinutes(close) ? { name: eve[0].name as string, eve_closes_at: close } : null
}
