export function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export type DateRangePreset = 'bugun' | 'bu_hafta' | 'bu_ay' | 'gecen_ay' | 'ozel'

// AccountingPage/GiderlerPage/PerformanceReportPage'in ortak tarih preset
// mantığı — 'ozel' (ozel tarih araligi) her sayfada kendi input'larindan
// okundugu icin bu fonksiyona hic ulaşmaz, buradaki default sadece
// tip-tamlik guvencesi.
export function presetDateRange(preset: DateRangePreset, today: Date = new Date()): { start: string; end: string } {
  switch (preset) {
    case 'bugun':
      return { start: toLocalDateString(today), end: toLocalDateString(today) }
    case 'bu_hafta': {
      const day = today.getDay()
      const diffToMonday = day === 0 ? -6 : 1 - day
      const monday = new Date(today)
      monday.setDate(today.getDate() + diffToMonday)
      return { start: toLocalDateString(monday), end: toLocalDateString(today) }
    }
    case 'bu_ay':
      return { start: toLocalDateString(firstOfMonth(today)), end: toLocalDateString(today) }
    case 'gecen_ay': {
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
      const lastMonthStart = firstOfMonth(lastMonthEnd)
      return { start: toLocalDateString(lastMonthStart), end: toLocalDateString(lastMonthEnd) }
    }
    default:
      return { start: toLocalDateString(firstOfMonth(today)), end: toLocalDateString(today) }
  }
}
