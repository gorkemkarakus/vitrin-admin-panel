// Sizdirilmis sifre kontrolu (Have I Been Pwned, k-anonimlik): sifrenin
// SHA-1 ozetinin yalnizca ilk 5 karakteri gonderilir, sifre ya da tam ozet
// hicbir yere gitmez. Supabase'in ucretli "leaked password protection"
// ozelliginin yerine. Servise ulasilamazsa kontrol atlanir (kayit/sifre
// degistirme durmasin).
export async function isPwnedPassword(password: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
    const prefix = hex.slice(0, 5)
    const suffix = hex.slice(5)
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'Adapptiv' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return false
    const text = await res.text()
    return text.split('\n').some((line) => {
      const [hash, count] = line.trim().split(':')
      return hash === suffix && Number(count) > 0
    })
  } catch (e) {
    console.error('pwned kontrolu atlandi:', e instanceof Error ? e.message : e)
    return false
  }
}

export const PWNED_PASSWORD_MESSAGE =
  'Bu şifre daha önce internette sızdırılmış şifre listelerinde görülmüş. Lütfen başka bir şifre seçin.'
