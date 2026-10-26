import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptToken } from './crypto.ts'

// Instagram DM'leri ("Instagram API with Instagram Login"): baglama, mesaj
// gonderme ve anahtar yenileme icin Instagram Graph cagrilari. Erisim
// anahtari asla loglanmaz; hata metni Meta'nin mesajidir.
const GRAPH = 'https://graph.instagram.com/v26.0'

// Kanal kimlikleri: Instagram'dan yazan musteri "ig:<IGSID>", isletmenin
// hesabi bot fonksiyonlarina "ig:<hesap kimligi>" olarak gecer
// (resolveBusiness bunu business_instagram_connections'tan bulur).
export const IG_PREFIX = 'ig:'

export function isInstagramId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(IG_PREFIX)
}

export const igCustomerId = (igsid: string) => IG_PREFIX + igsid
export const igRecipientId = (customerId: string) => customerId.slice(IG_PREFIX.length)

// API'den gonderdigimiz mesajlarin kimligi kaydedilir; Instagram bunlarin da
// kopyasini (echo) yollar, salonun telefondan yazdigi sanilmasin.
export const IG_SENT_KEY = 'ig-sent:'

export async function recordInstagramSent(admin: SupabaseClient, messageId: string | undefined): Promise<void> {
  if (!messageId) return
  const { error } = await admin.from('whatsapp_processed_messages').insert({ wamid: IG_SENT_KEY + messageId })
  if (error && error.code !== '23505') console.error('recordInstagramSent: kayıt başarısız:', error.message)
}

type IgResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function call<T>(url: string, init: RequestInit = {}): Promise<IgResult<T>> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: body?.error?.message ?? body?.error_message ?? `HTTP ${res.status}` }
    return { ok: true, data: body as T }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function appCredentials() {
  return {
    appId: Deno.env.get('INSTAGRAM_APP_ID') ?? '',
    secret: Deno.env.get('INSTAGRAM_APP_SECRET') ?? '',
  }
}

// Instagram girisi bitince donulen sitedeki sayfa (Meta'da "gecerli yonlendirme
// adresi" olarak kayitli olmali).
export function instagramRedirectUri(): string {
  const site = (Deno.env.get('PUBLIC_SITE_URL') ?? 'https://isletme.adapptivdigital.com').replace(/\/$/, '')
  return `${site}/instagram-baglan/`
}

// Instagram'in giris penceresi; donuste ?code=...&state=... ile redirectUri'ye gelir.
export function authorizeUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: appCredentials().appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_manage_messages',
    state,
  })
  return `https://www.instagram.com/oauth/authorize?${q}`
}

// Kod (1 saat gecerli) once kisa omurlu, sonra 60 gunluk anahtara cevrilir.
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<IgResult<{ accessToken: string; expiresAt: string | null }>> {
  const { appId, secret } = appCredentials()
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: secret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    // Instagram donuste kodun sonuna "#_" ekleyebiliyor
    code: code.replace(/#_$/, ''),
  })
  const short = await call<{ access_token?: string; data?: { access_token: string }[] }>(
    'https://api.instagram.com/oauth/access_token',
    { method: 'POST', body: form },
  )
  if (!short.ok) return short
  const shortToken = short.data.access_token ?? short.data.data?.[0]?.access_token
  if (!shortToken) return { ok: false, error: 'Instagram anahtar döndürmedi' }

  const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: shortToken })
  const long = await call<{ access_token: string; expires_in?: number }>(`https://graph.instagram.com/access_token?${q}`)
  if (!long.ok) return long
  return {
    ok: true,
    data: {
      accessToken: long.data.access_token,
      expiresAt: long.data.expires_in ? new Date(Date.now() + long.data.expires_in * 1000).toISOString() : null,
    },
  }
}

// 60 gunluk anahtari yeni 60 gune uzatir (anahtar en az 24 saatlik olmali).
export async function refreshToken(token: string): Promise<IgResult<{ accessToken: string; expiresAt: string | null }>> {
  const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })
  const res = await call<{ access_token: string; expires_in?: number }>(`https://graph.instagram.com/refresh_access_token?${q}`)
  if (!res.ok) return res
  return {
    ok: true,
    data: {
      accessToken: res.data.access_token,
      expiresAt: res.data.expires_in ? new Date(Date.now() + res.data.expires_in * 1000).toISOString() : null,
    },
  }
}

export interface InstagramAccount {
  // webhook'ta gelen profesyonel hesap kimligi
  user_id: string
  username?: string
  name?: string
}

export function getAccount(token: string): Promise<IgResult<InstagramAccount>> {
  return call(`${GRAPH}/me?fields=user_id,username,name`, { headers: { Authorization: `Bearer ${token}` } })
}

// Hesaba gelen DM'lerin bizim webhook'a dusmesi icin abonelik.
export function subscribeMessages(token: string): Promise<IgResult<unknown>> {
  return call(`${GRAPH}/me/subscribed_apps?subscribed_fields=messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function unsubscribeMessages(token: string): Promise<IgResult<unknown>> {
  return call(`${GRAPH}/me/subscribed_apps`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
}

export async function sendInstagramText(params: {
  token: string
  recipientIgsid: string
  message: string
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const res = await call<{ message_id?: string }>(`${GRAPH}/me/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: params.recipientIgsid }, message: { text: params.message } }),
  })
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, messageId: res.data.message_id }
}

// DM atan kisinin adi (randevuda yedek ad olarak kullanilir); alinamazsa null.
export async function getUserName(token: string, igsid: string): Promise<string | null> {
  const res = await call<{ name?: string; username?: string }>(`${GRAPH}/${igsid}?fields=name,username`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return res.data.name?.trim() || res.data.username?.trim() || null
}

// Cevap hazirlanirken musteri "yaziyor..." gorur; basarisiz olursa sessizce gecilir.
export async function sendInstagramTyping(token: string, recipientIgsid: string): Promise<void> {
  await call(`${GRAPH}/me/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientIgsid }, sender_action: 'typing_on' }),
  })
}

// Isletmenin Instagram baglantisi (anahtari cozulmus). Hesap kimligiyle ya
// da isletme kimligiyle bulunur.
export async function instagramConnection(
  admin: SupabaseClient,
  by: { igUserId: string } | { businessId: string },
): Promise<{ businessId: string; igUserId: string; token: string } | null> {
  let query = admin.from('business_instagram_connections').select('business_id, ig_user_id, encrypted_access_token')
  query = 'igUserId' in by ? query.eq('ig_user_id', by.igUserId) : query.eq('business_id', by.businessId)
  const { data } = await query.maybeSingle()
  const key = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!data || !key) return null
  try {
    return { businessId: data.business_id, igUserId: data.ig_user_id, token: await decryptToken(data.encrypted_access_token, key) }
  } catch (e) {
    console.error('instagramConnection: anahtar çözülemedi:', e instanceof Error ? e.message : e)
    return null
  }
}
