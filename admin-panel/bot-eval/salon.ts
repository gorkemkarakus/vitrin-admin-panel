// Bot testleri icin sahte salon: hizmetler, calisanlar, calisma saatleri,
// tatil ve dolu saatler. Randevu fonksiyonlarini (book/cancel/reschedule)
// gercegine benzer kurallarla taklit eder; veritabanina hicbir sey yazilmaz.

export const SALON_PHONE = '0362 555 12 34'
export const HOLIDAY = { name: 'Cumhuriyet Bayramı', date: '2026-10-29' }

export const SERVICES = [
  { name: 'Saç kesimi', duration_minutes: 45, price: 450, description: 'Yıkama, kesim ve fön dahil. Uzun saçta süre 15 dk uzayabilir.' },
  { name: 'Fön', duration_minutes: 30, price: 250, description: null },
  { name: 'Boya', duration_minutes: 120, price: 1400, description: 'Dip boya ve tüm boya. Amonyaksız seçenek var; öncesinde alerji testi önerilir.' },
  { name: 'Kaş alımı', duration_minutes: 20, price: 200, description: null },
  { name: 'Manikür', duration_minutes: 45, price: 450, description: null },
  { name: 'Kalıcı oje', duration_minutes: 60, price: 550, description: '2-3 hafta dayanır. Eski kalıcı ojenin sökümü ücretsiz.' },
  { name: 'Pedikür', duration_minutes: 60, price: 500, description: null },
  { name: 'Protez tırnak', duration_minutes: 90, price: 900, description: null },
  { name: 'Cilt bakımı', duration_minutes: 75, price: 1200, description: 'Temizlik, peeling ve maske. 6 seanslık paket daha avantajlı.' },
  { name: 'Lazer epilasyon', duration_minutes: 60, price: 1500, description: null },
]

export const EMPLOYEES = [
  { name: 'Elif Yılmaz', gender: 'kadin', services: ['Manikür', 'Kalıcı oje', 'Pedikür', 'Protez tırnak'] },
  { name: 'Büşra Aydın', gender: 'kadin', services: ['Saç kesimi', 'Fön', 'Boya'] },
  { name: 'Kerem Demir', gender: 'erkek', services: ['Saç kesimi', 'Fön'] },
  { name: 'Selin Kaya', gender: 'kadin', services: ['Cilt bakımı', 'Lazer epilasyon', 'Kaş alımı'] },
]

// Pazartesi-Cumartesi 09:00-19:00, pazar kapali
// tatilden bir onceki gun (arife) 13:00'te kapanir
export const EVE_DATE = new Date(Date.parse(HOLIDAY.date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10)
const EVE_CLOSE = 13 * 60
const OPEN = 9 * 60
const CLOSE = 19 * 60
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
export const WORKING_HOURS = WEEKDAYS.slice(1).map((day) => ({ day, starts_at: '09:00', ends_at: '19:00' }))

export interface Appt {
  id: string
  customer_phone: string
  customer_name?: string
  service_name: string
  employee_name: string
  start: Date
  minutes: number
  status: 'aktif' | 'iptal'
}

const ist = (d: Date) => new Date(d.getTime() + 3 * 3600000)
const istDate = (d: Date) => ist(d).toISOString().slice(0, 10)
const istMinutes = (d: Date) => ist(d).getUTCHours() * 60 + ist(d).getUTCMinutes()

export class Salon {
  appts: Appt[] = []
  seq = 0

  constructor(busy: { employee: string; at: string; minutes: number }[] = []) {
    for (const b of busy) {
      this.appts.push({
        id: `dolu-${++this.seq}`,
        customer_phone: 'baska-musteri',
        service_name: 'Dolu',
        employee_name: b.employee,
        start: new Date(b.at),
        minutes: b.minutes,
        status: 'aktif',
      })
    }
  }

  private free(employee: string, start: Date, minutes: number, ignoreId?: string): boolean {
    const end = start.getTime() + minutes * 60000
    return !this.appts.some(
      (a) =>
        a.status === 'aktif' &&
        a.id !== ignoreId &&
        a.employee_name === employee &&
        a.start.getTime() < end &&
        a.start.getTime() + a.minutes * 60000 > start.getTime(),
    )
  }

  private dayState(start: Date, minutes: number): 'kapali-tatil' | 'kapali-pazar' | 'saat-disi' | 'arife' | 'acik' {
    if (istDate(start) === HOLIDAY.date) return 'kapali-tatil'
    // arife: salon 13:00'te kapanir (gercekte calisanlara 13:00 sonrasi blok yazilir, cevap 'dolu' olur)
    if (istDate(start) === EVE_DATE && istMinutes(start) + minutes > EVE_CLOSE) return 'arife'
    if (ist(start).getUTCDay() === 0) return 'kapali-pazar'
    const m = istMinutes(start)
    if (m < OPEN || m + minutes > CLOSE) return 'saat-disi'
    return 'acik'
  }

  private nextFree(from: Date, minutes: number, employees: string[]) {
    const step = 30 * 60000
    for (let t = Math.ceil((from.getTime() + 1) / step) * step; t < from.getTime() + 14 * 86400000; t += step) {
      const start = new Date(t)
      if (this.dayState(start, minutes) !== 'acik') continue
      const emp = employees.find((e) => this.free(e, start, minutes))
      if (emp) return { start, emp }
    }
    return null
  }

  private unavailable(start: Date, minutes: number, employees: string[]) {
    const state = this.dayState(start, minutes)
    const next = this.nextFree(start, minutes, employees)
    if (!next) return { status: 'no_availability' }
    return {
      status: 'unavailable',
      suggestion: { scheduled_at: next.start.toISOString(), employee_name: next.emp },
      outside_hours:
        state === 'saat-disi' || state === 'kapali-pazar'
          ? state === 'kapali-pazar'
            ? { starts_at: null, ends_at: null }
            : { starts_at: '09:00', ends_at: '19:00' }
          : null,
      closed_day: state === 'kapali-tatil' ? { name: HOLIDAY.name } : null,
    }
  }

  // senaryonun musterisinin onceden alinmis randevulari
  seed(phone: string, mine: { service: string; employee: string; at: string }[]) {
    for (const m of mine) {
      const s = SERVICES.find((x) => x.name === m.service)!
      this.appts.push({
        id: `randevu-${++this.seq}`,
        customer_phone: phone,
        service_name: m.service,
        employee_name: m.employee,
        start: new Date(m.at),
        minutes: s.duration_minutes,
        status: 'aktif',
      })
    }
  }

  book(body: Record<string, unknown>) {
    if (body.date_warning) return { error: String(body.date_warning) }
    // gercek fonksiyondaki gibi: iletisim telefonu gecerli bir TR numarasi olmali
    const digits = String(body.contact_phone ?? '').replace(/\D/g, '')
    if (!(digits.length === 10 || digits.length === 11 || (digits.length === 12 && digits.startsWith('90')))) {
      return { error: 'Geçerli bir telefon numarası gerekli' }
    }
    const service = SERVICES.find((s) => s.name.toLocaleLowerCase('tr') === String(body.service_name ?? '').toLocaleLowerCase('tr'))
    if (!service) return { error: 'Hizmet bulunamadı' }
    const start = new Date(String(body.scheduled_at))
    if (isNaN(start.getTime())) return { error: 'scheduled_at geçersiz' }
    if (start.getTime() < Date.now()) return { error: 'Geçmiş bir tarih/saat için randevu oluşturulamaz' }
    let employees = EMPLOYEES.filter((e) => e.services.includes(service.name)).map((e) => e.name)
    if (body.employee_name) {
      const wanted = String(body.employee_name).trim().toLocaleLowerCase('tr')
      const match = employees.find((e) => e.toLocaleLowerCase('tr') === wanted)
      if (!match) return { error: 'Belirtilen çalışan bulunamadı veya bu hizmeti veremiyor' }
      employees = [match]
    }
    const minutes = service.duration_minutes
    if (this.dayState(start, minutes) === 'acik') {
      const emp = employees.find((e) => this.free(e, start, minutes))
      if (emp) {
        const appt: Appt = {
          id: `randevu-${++this.seq}`,
          customer_phone: String(body.customer_phone),
          customer_name: String(body.customer_name ?? ''),
          service_name: service.name,
          employee_name: emp,
          start,
          minutes,
          status: 'aktif',
        }
        this.appts.push(appt)
        return {
          status: 'booked',
          appointment: { id: appt.id, scheduled_at: start.toISOString(), employee_name: emp, service_name: service.name },
        }
      }
    }
    return this.unavailable(start, minutes, employees)
  }

  cancel(body: Record<string, unknown>) {
    const a = this.appts.find((x) => x.id === body.appointment_id && x.customer_phone === body.customer_phone && x.status === 'aktif')
    if (!a) return { error: 'Randevu bulunamadı' }
    a.status = 'iptal'
    return {
      status: 'cancelled',
      appointment: { scheduled_at: a.start.toISOString(), service_name: a.service_name, employee_name: a.employee_name },
    }
  }

  reschedule(body: Record<string, unknown>) {
    const a = this.appts.find((x) => x.id === body.appointment_id && x.customer_phone === body.customer_phone && x.status === 'aktif')
    if (!a) return { error: 'Randevu bulunamadı' }
    if (body.date_warning) return { error: String(body.date_warning) }
    const start = new Date(String(body.new_scheduled_at))
    if (isNaN(start.getTime())) return { error: 'scheduled_at geçersiz' }
    if (start.getTime() < Date.now()) return { error: 'Geçmiş bir tarih/saat için randevu oluşturulamaz' }
    if (this.dayState(start, a.minutes) === 'acik' && this.free(a.employee_name, start, a.minutes, a.id)) {
      a.start = start
      return {
        status: 'rescheduled',
        appointment: { scheduled_at: start.toISOString(), service_name: a.service_name, employee_name: a.employee_name },
      }
    }
    return this.unavailable(start, a.minutes, [a.employee_name])
  }

  customerAppointments(phone: string) {
    return this.appts
      .filter((a) => a.customer_phone === phone && a.status === 'aktif' && a.start.getTime() > Date.now())
      .sort((x, y) => x.start.getTime() - y.start.getTime())
      .map((a) => ({ id: a.id, service_name: a.service_name, employee_name: a.employee_name, scheduled_at: a.start.toISOString() }))
  }

  activeFor(phone: string) {
    return this.appts.filter((a) => a.customer_phone === phone && a.status === 'aktif')
  }
}

// Istanbul saatine gore "YYYY-MM-DDTHH:MM" (kontrollerde kullanilir)
export const istLocal = (d: Date) => ist(d).toISOString().slice(0, 16)
