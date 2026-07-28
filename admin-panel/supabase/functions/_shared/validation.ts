// Rakam olmayan karakterleri atip 10 haneli (bassiz), 11 haneli (0 ile
// basliyor) VEYA 12 haneli (90 ulke koduyla basliyor, ör. "+90 555 222 33 44"
// — bu format WhatsApp'ta çok yaygın) bir Turkiye cep telefonu formatina
// uyup uymadigini kontrol eder.
export function isValidTurkishPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 10 || digits.length === 11 || (digits.length === 12 && digits.startsWith('90'))
}

// scheduled_at icin butun sessiz-kayma korumalarini TEK yerde toplar:
// - acik saat dilimi zorunlu (yoksa UTC sunucuda yanlis saatte randevu acilir)
// - JS Date "24:00:00" gibi ozel durumlari sessizce bir SONRAKI gune yuvarlar
// - "30 Şubat" gibi o ayda gercekte var olmayan bir gunu sessizce bir SONRAKI
//   aya kaydirir
// - gecmis bir tarih/saat reddedilir
// Hata mesaji varsa dondurur, gecerliyse null dondurur.
export function validateScheduledAt(scheduledAt: string): string | null {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(scheduledAt)) {
    return 'scheduled_at açık saat dilimi içermeli (ör. 2026-07-10T14:00:00+03:00)'
  }

  const timeMatch = scheduledAt.match(/T(\d{2}):(\d{2}):/)
  if (timeMatch) {
    const hh = parseInt(timeMatch[1], 10)
    const mm = parseInt(timeMatch[2], 10)
    if (hh > 23 || mm > 59) return 'scheduled_at geçersiz'
  }

  const dateMatch = scheduledAt.match(/^(\d{4})-(\d{2})-(\d{2})T/)
  if (dateMatch) {
    const reqYear = parseInt(dateMatch[1], 10)
    const reqMonth = parseInt(dateMatch[2], 10)
    const reqDay = parseInt(dateMatch[3], 10)
    const dateOnlyCheck = new Date(Date.UTC(reqYear, reqMonth - 1, reqDay))
    if (
      dateOnlyCheck.getUTCFullYear() !== reqYear ||
      dateOnlyCheck.getUTCMonth() !== reqMonth - 1 ||
      dateOnlyCheck.getUTCDate() !== reqDay
    ) {
      return 'scheduled_at geçersiz'
    }
  }

  const requestedStart = new Date(scheduledAt)
  if (isNaN(requestedStart.getTime())) return 'scheduled_at geçersiz'
  if (requestedStart.getTime() < Date.now()) return 'Geçmiş bir tarih/saat için randevu oluşturulamaz'

  return null
}
