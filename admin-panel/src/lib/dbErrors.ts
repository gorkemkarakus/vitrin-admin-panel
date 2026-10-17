const NETWORK_ERROR = 'Sunucuya ulaşılamadı, tekrar deneyin.'

interface DbErrorLike {
  code?: string
  message?: string
}

// Supabase/Postgres hatalarini kullaniciya gosterilecek Turkce metne cevirir.
// Ham (Ingilizce) mesaj asla ekrana basilmaz; tanimadigimiz hatada `fallback`.
export function friendlyDbError(err: unknown, fallback: string): string {
  const e = (err ?? {}) as DbErrorLike
  const msg = (e.message ?? '').toLowerCase()
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed'))
    return NETWORK_ERROR
  switch (e.code) {
    case '23505':
      return msg.includes('phone') ? 'Bu telefon numarası zaten başka bir kayıtta kullanılıyor.' : 'Bu kayıt zaten var.'
    case '23514':
      return 'Girilen bilgilerden biri çok uzun veya geçersiz. Kontrol edip tekrar deneyin.'
    case '23503':
      return 'Bu kayıt başka kayıtlarla bağlantılı olduğu için işlem yapılamadı.'
    case '42501':
      return 'Bu işlem için yetkin yok.'
    case '22001':
      return 'Girilen metin çok uzun.'
  }
  // Supabase Auth (kodlari Postgres'inkinden farkli, metinsel)
  if (e.code === 'same_password' || msg.includes('should be different from the old password'))
    return 'Yeni şifre eskisiyle aynı olamaz.'
  if (e.code === 'weak_password' || msg.includes('password should be at least'))
    return 'Şifre çok zayıf; daha uzun bir şifre seç.'
  if (e.code === 'otp_expired' || (!e.code && msg.includes('expired')))
    return 'Bağlantının süresi dolmuş. Yeni bir bağlantı iste.'
  return fallback
}
