// Salon numarasini baglama (Embedded Signup) sirasinda kullanilan Meta Graph
// cagrilari. Erisim anahtari asla loglanmaz; hata metni Meta'nin mesajidir.
const GRAPH = 'https://graph.facebook.com/v26.0'

type GraphResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function graph<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<GraphResult<T>> {
  const { token, ...rest } = init
  try {
    const res = await fetch(`${GRAPH}${path}`, {
      ...rest,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(15000),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` }
    return { ok: true, data: body as T }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Bagla penceresinden donen kod (30 sn omurlu) salona ozel kalici anahtara
// cevrilir.
export function exchangeCode(code: string): Promise<GraphResult<{ access_token: string }>> {
  const appId = Deno.env.get('WHATSAPP_APP_ID') ?? Deno.env.get('META_APP_ID') ?? '1873944480636741'
  const secret = Deno.env.get('WHATSAPP_APP_SECRET') ?? ''
  const q = new URLSearchParams({ client_id: appId, client_secret: secret, code })
  return graph(`/oauth/access_token?${q}`)
}

export interface PhoneInfo {
  display_phone_number?: string
  verified_name?: string
  // true: numara telefondaki WhatsApp Business uygulamasinda da kullaniliyor (Coexistence)
  is_on_biz_app?: boolean
  platform_type?: string
}

export function getPhoneInfo(phoneNumberId: string, token: string): Promise<GraphResult<PhoneInfo>> {
  return graph(`/${phoneNumberId}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type`, { token })
}

// Yeni (uygulamada olmayan) numara Cloud API'ye kaydedilir; Coexistence
// numarasi zaten kayitli oldugu icin bu adim atlanir.
export function registerPhone(phoneNumberId: string, token: string, pin: string): Promise<GraphResult<unknown>> {
  return graph(`/${phoneNumberId}/register`, {
    method: 'POST',
    token,
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })
}

// Salonun hesabina gelen mesajlarin bizim webhook'a dusmesi icin uygulama
// hesaba abone edilir.
export function subscribeApp(wabaId: string, token: string): Promise<GraphResult<unknown>> {
  return graph(`/${wabaId}/subscribed_apps`, { method: 'POST', token })
}

export function unsubscribeApp(wabaId: string, token: string): Promise<GraphResult<unknown>> {
  return graph(`/${wabaId}/subscribed_apps`, { method: 'DELETE', token })
}
