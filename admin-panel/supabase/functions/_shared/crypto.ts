export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Webhook secret karsilastirmalari (refresh-ad-tokens/sync-ad-insights) icin
// — duz `!==` string karsilastirmasi ilk uyusmayan byte'ta kisa devre yapip
// ag jitter'i uzerinden teorik bir zamanlama yan-kanali birakir. Butun
// byte'lar her zaman gezilip XOR'lanarak bu onleniyor.
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i]
  }
  return diff === 0
}

// sha256Hex TEK YONLU — sadece dogrulama icin (api_key_hash). Meta erisim
// token'i ise API'ye GERI GONDERILMESI gerektigi icin GERI DONDURULEBILIR
// (reversible) sifreleme gerekiyor — bu kod tabaninda ilk kez. Postgres
// tarafinda pgcrypto/pgsodium/Vault bu projede YOK (kontrol edildi), bu
// yuzden mevcut "Deno katmaninda kripto" yaklasimiyla tutarli sekilde
// Web Crypto API (crypto.subtle) ile AES-256-GCM kullaniliyor — ozel/rolled-
// own bir sifre degil, tarayici/Deno'nun native, denetimden gecmis
// implementasyonu.
//
// Anahtar: TOKEN_ENCRYPTION_KEY edge function secret'i, 32 ham byte, base64
// (bir kez `openssl rand -base64 32` ile uretilip `supabase secrets set` ile
// kaydedilir). Bu anahtar kaybolursa sifrelenmis TUM token'lar kalici olarak
// cozulemez hale gelir — guvenli bir yerde yedeklenmeli.
async function importAesKey(rawKeyBase64: string): Promise<CryptoKey> {
  const rawKey = Uint8Array.from(atob(rawKeyBase64), (c) => c.charCodeAt(0))
  if (rawKey.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY 32 ham byte (base64) olmalı')
  }
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// Donen deger base64(iv(12) || ciphertext+authTag) — tek kolonda kendi
// kendine yeten bir format, ayrı bir iv sütununa gerek yok.
export async function encryptToken(plaintext: string, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)
  let binary = ''
  for (const byte of combined) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function decryptToken(encoded: string, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64)
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}
