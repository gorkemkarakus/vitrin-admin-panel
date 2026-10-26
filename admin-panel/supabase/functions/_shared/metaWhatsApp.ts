import { TEMPLATE_LANG, TEMPLATES, type TemplateKey } from './waTemplates.ts'

// Salon numarasini baglama (Embedded Signup) ve hesabin mesaj sablonlari icin
// kullanilan Meta Graph cagrilari. Erisim anahtari asla loglanmaz; hata
// metni Meta'nin mesajidir.
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

export interface TemplateStatus {
  key: TemplateKey
  name: string
  // APPROVED, PENDING, REJECTED, PAUSED, DISABLED; hesapta yoksa MISSING
  status: string
  category: string | null
}

// Adapptiv sablonlarinin bu hesaptaki durumu.
export async function templateStatuses(wabaId: string, token: string): Promise<GraphResult<TemplateStatus[]>> {
  const res = await graph<{ data?: { name: string; status: string; category?: string; language?: string }[] }>(
    `/${wabaId}/message_templates?fields=name,status,category,language&limit=200`,
    { token },
  )
  if (!res.ok) return res
  const rows = res.data.data ?? []
  return {
    ok: true,
    data: (Object.keys(TEMPLATES) as TemplateKey[]).map((key) => {
      const row = rows.find((r) => r.name === TEMPLATES[key].name && (r.language ?? TEMPLATE_LANG) === TEMPLATE_LANG)
      return { key, name: TEMPLATES[key].name, status: row?.status ?? 'MISSING', category: row?.category ?? null }
    }),
  }
}

// Eksik sablonlari olusturur (Meta inceler; onay 24 saate kadar surebilir).
// Var olana dokunmaz; reddedilen sablon ayni adla yeniden gonderilemez,
// durumu oldugu gibi doner.
export async function ensureTemplates(wabaId: string, token: string): Promise<GraphResult<TemplateStatus[]>> {
  const current = await templateStatuses(wabaId, token)
  if (!current.ok) return current
  for (const t of current.data) {
    if (t.status !== 'MISSING') continue
    const def = TEMPLATES[t.key]
    const created = await graph<{ id: string; status?: string; category?: string }>(`/${wabaId}/message_templates`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        name: def.name,
        language: TEMPLATE_LANG,
        category: 'UTILITY',
        components: [
          { type: 'BODY', text: def.body, example: { body_text: [def.example] } },
          ...(def.buttons?.length
            ? [{ type: 'BUTTONS', buttons: def.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) }]
            : []),
        ],
      }),
    })
    if (created.ok) {
      t.status = created.data.status ?? 'PENDING'
      t.category = created.data.category ?? 'UTILITY'
    } else {
      console.error('ensureTemplates: şablon oluşturulamadı', def.name, created.error)
      t.status = 'ERROR'
    }
  }
  return current
}
