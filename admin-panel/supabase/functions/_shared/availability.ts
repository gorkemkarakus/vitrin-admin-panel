export const SLOT_MINUTES = 30

export interface Schedule {
  profile_id: string
  day_of_week: number
  starts_at: string
  ends_at: string
}
export interface TimeBlock {
  profile_id: string
  day_of_week: number | null
  block_date: string | null
  starts_at: string
  ends_at: string
}
export interface Appt {
  employee_id: string | null
  scheduled_at: string
  duration_minutes: number | null
  status: string
  source: string | null
}

export function toMinutes(t: string) {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

// Deno edge runtime UTC calisir. scheduled_at her zaman acik saat dilimiyle
// (ör. +03:00) gelir ama Date.getHours()/getDay() sunucunun (UTC) yerel
// saatini dondurur — Istanbul icin bu 3 saat geriye kaymis gun/saat demektir.
// Turkiye yil boyu UTC+3 (DST yok), bu yuzden sabit +3 kaydirip UTC
// getter'lariyla okumak calisma saati/gun karsilastirmasini dogru yapar.
export function istanbulParts(d: Date) {
  const shifted = new Date(d.getTime() + 3 * 60 * 60 * 1000)
  return { dayOfWeek: shifted.getUTCDay(), hours: shifted.getUTCHours(), minutes: shifted.getUTCMinutes() }
}

export function istanbulDateString(d: Date) {
  const shifted = new Date(d.getTime() + 3 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

export function isAvailable(
  employeeId: string,
  start: Date,
  durationMinutes: number,
  schedules: Schedule[],
  appointments: Appt[],
  timeBlocks: TimeBlock[],
) {
  const { dayOfWeek, hours, minutes } = istanbulParts(start)
  const startMin = hours * 60 + minutes
  const endMin = startMin + durationMinutes

  const works = schedules.some(
    (s) =>
      s.profile_id === employeeId &&
      s.day_of_week === dayOfWeek &&
      toMinutes(s.starts_at) <= startMin &&
      toMinutes(s.ends_at) >= endMin,
  )
  if (!works) return false

  const dateStr = istanbulDateString(start)
  const blocked = timeBlocks.some(
    (b) =>
      b.profile_id === employeeId &&
      (b.day_of_week === dayOfWeek || b.block_date === dateStr) &&
      toMinutes(b.starts_at) < endMin &&
      toMinutes(b.ends_at) > startMin,
  )
  if (blocked) return false

  const end = new Date(start.getTime() + durationMinutes * 60000)
  const conflict = appointments.some((a) => {
    if (a.employee_id !== employeeId || a.status === 'iptal') return false
    const aStart = new Date(a.scheduled_at)
    const aEnd = new Date(aStart.getTime() + (a.duration_minutes ?? SLOT_MINUTES) * 60000)
    return aStart < end && aEnd > start
  })
  return !conflict
}

// Musteriye "o saat icin uygun degiliz (dolu ya da calisma saatleri disinda
// olabilir)" gibi BELIRSIZ bir mesaj gosteriliyordu — isAvailable() "mesaide
// mi" ve "dolu mu" kontrollerini TEK bir booleana indirgedigi icin caller
// hangi sebepten reddedildigini hic bilmiyordu. Bu fonksiyon, istenen gun+
// hizmeti verebilecek calisanlarin programlarinin BIRLESIMINI (o gun en erken
// baslayan - en gec biten araligi) dondurur.
export function eligibleDayHours(dayOfWeek: number, eligibleIds: string[], schedules: Schedule[]) {
  let start: string | null = null
  let end: string | null = null
  for (const s of schedules) {
    if (!eligibleIds.includes(s.profile_id) || s.day_of_week !== dayOfWeek) continue
    if (start === null || s.starts_at < start) start = s.starts_at
    if (end === null || s.ends_at > end) end = s.ends_at
  }
  return start && end ? { starts_at: start.slice(0, 5), ends_at: end.slice(0, 5) } : null
}

// Verilen bir gunun (Istanbul yerel takvim gunu) TUM bos slotlarini
// dondurur — public randevu sayfasindaki slot-grid icin. book-appointment'taki
// findNextAvailable() bundan farkli: o ILERI DOGRU gun/hafta arayip TEK bir
// oneri dondurur (sohbet botu icin), bu ise TEK bir gunun butun bos
// saatlerini listeler (gorsel takvim icin).
export function listOpenSlots(
  day: Date,
  eligibleIds: string[],
  durationMinutes: number,
  schedules: Schedule[],
  appointments: Appt[],
  timeBlocks: TimeBlock[],
): string[] {
  const { dayOfWeek } = istanbulParts(day)
  const dayHours = eligibleDayHours(dayOfWeek, eligibleIds, schedules)
  if (!dayHours) return []

  const dateStr = istanbulDateString(day)
  const dayStartUTC = new Date(`${dateStr}T00:00:00+03:00`)
  const slots: string[] = []
  const dayStartMin = toMinutes(dayHours.starts_at)
  const dayEndMin = toMinutes(dayHours.ends_at)

  for (let min = dayStartMin; min + durationMinutes <= dayEndMin; min += SLOT_MINUTES) {
    const slotStart = new Date(dayStartUTC.getTime() + min * 60000)
    if (slotStart.getTime() < Date.now()) continue
    const found = eligibleIds.some((id) => isAvailable(id, slotStart, durationMinutes, schedules, appointments, timeBlocks))
    if (found) {
      const hh = String(Math.floor(min / 60)).padStart(2, '0')
      const mm = String(min % 60).padStart(2, '0')
      slots.push(`${hh}:${mm}`)
    }
  }
  return slots
}

// lastBotBookingByEmployee mantiginin genellestirilmis hali: musteri belirli
// bir calisan istemediginde, HANGI kaynaklarin (chatbot / online_randevu vb.)
// "adil dagitim" havuzuna sayilacagini caller belirler. book-appointment
// bunu ['chatbot'] ile cagirir (davranis AYNI kalir), public-book-appointment
// ['chatbot','online_randevu'] ile cagirir — boylece iki kimliksiz/otomatik
// kanal TEK ortak adalet havuzunda sayilir, calisanin KENDI getirdigi
// musteriler (source disinda kalanlar) bu siralamayi hic etkilemez.
export function rankEligibleByFairness(eligibleIds: string[], appointments: Appt[], rotationSources: string[]): string[] {
  const lastBookingByEmployee = new Map<string, number>()
  for (const a of appointments) {
    if (!a.source || !rotationSources.includes(a.source) || !a.employee_id) continue
    const t = new Date(a.scheduled_at).getTime()
    const prev = lastBookingByEmployee.get(a.employee_id) ?? -Infinity
    if (t > prev) lastBookingByEmployee.set(a.employee_id, t)
  }
  return eligibleIds
    .slice()
    .sort((a, b) => (lastBookingByEmployee.get(a) ?? -Infinity) - (lastBookingByEmployee.get(b) ?? -Infinity))
}
