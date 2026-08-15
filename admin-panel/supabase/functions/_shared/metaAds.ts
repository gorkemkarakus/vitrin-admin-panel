// Meta (Facebook) Marketing API cagrilari. Tum fonksiyonlar butun secret'lari
// PARAMETRE olarak alir (appointmentExtraction.ts'teki OpenAI deseniyle
// ayni) — hicbir anahtar bu dosyaya gomulmez, cagiran fonksiyon
// Deno.env.get(...) ile okuyup gecirir.

const GRAPH_VERSION = 'v23.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }

async function graphGet<T>(path: string, params: Record<string, string>): Promise<Result<T>> {
  const url = new URL(`${GRAPH_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString())
  const body = await res.json().catch(() => null)

  if (!res.ok || body?.error) {
    // Meta hata govdesi (message/type/code) LOGLANIR ama client'a asla ham
    // olarak donmez — access_token URL'de sorgu parametresi olarak gonderilir,
    // hata govdesi bazen istegin bir kismini yansitabilir.
    console.error('Meta Graph API hatası:', res.status, body?.error ?? body)
    return { ok: false, error: 'Meta API isteği başarısız oldu', status: 502 }
  }

  return { ok: true, data: body as T }
}

export interface TokenExchangeResult {
  accessToken: string
  expiresInSeconds: number | null
}

// Adim 1: OAuth 'code' -> kisa omurlu access token. redirectUri, dialog'da
// kullanilanla BIREBIR AYNI olmak zorunda (Meta bunu dogruluyor).
export async function exchangeCodeForToken(
  appId: string,
  appSecret: string,
  code: string,
  redirectUri: string,
): Promise<Result<TokenExchangeResult>> {
  const result = await graphGet<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  })
  if (!result.ok) return result
  return { ok: true, data: { accessToken: result.data.access_token, expiresInSeconds: result.data.expires_in ?? null } }
}

// Adim 2: kisa omurlu -> ~60 gunluk uzun omurlu token. AYNI cagri, hala
// GECERLI olan uzun omurlu bir token'i TEKRAR bu ucla degistirmek de yeni
// bir ~60 gunluk token verir — Meta'nin resmi "refresh endpoint"i yok, bu
// yeniden-degistirme mekanizmasi refresh-ad-tokens'in dayandigi yontem.
export async function exchangeForLongLivedToken(
  appId: string,
  appSecret: string,
  shortLivedOrStillValidToken: string,
): Promise<Result<TokenExchangeResult>> {
  const result = await graphGet<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedOrStillValidToken,
  })
  if (!result.ok) return result
  return { ok: true, data: { accessToken: result.data.access_token, expiresInSeconds: result.data.expires_in ?? null } }
}

export interface AdAccount {
  id: string // "act_123..."
  accountId: string
  name: string
}

export async function listAdAccounts(accessToken: string): Promise<Result<AdAccount[]>> {
  const result = await graphGet<{ data: { id: string; account_id: string; name: string }[] }>('/me/adaccounts', {
    fields: 'id,account_id,name',
    access_token: accessToken,
  })
  if (!result.ok) return result
  return {
    ok: true,
    data: result.data.data.map((a) => ({ id: a.id, accountId: a.account_id, name: a.name })),
  }
}

export interface AdInsights {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  roas: number | null
}

// Meta'nin donusum-etkinligi/pixel/CAPI adlandirmasi hesaba gore degisebiliyor
// (omni_purchase, offsite_conversion.fb_pixel_purchase, onsite_web_purchase
// vb.) — sabit TEK bir action_type yerine kapsamli bir izin listesi kullanilir.
const PURCHASE_ACTION_TYPES = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase',
  'onsite_web_app_purchase',
  'app_custom_event.fb_mobile_purchase',
])
const LEAD_ACTION_TYPES = new Set(['lead', 'omni_lead', 'onsite_conversion.lead_grouped'])

interface ActionEntry {
  action_type: string
  value: string
}

function sumActionValues(actions: ActionEntry[] | undefined, allow: Set<string>): number {
  if (!actions) return 0
  return actions.filter((a) => allow.has(a.action_type)).reduce((sum, a) => sum + (Number(a.value) || 0), 0)
}

export async function fetchAdInsights(
  accessToken: string,
  adAccountId: string,
  rangeDays: 7 | 30,
): Promise<Result<AdInsights>> {
  const datePreset = rangeDays === 7 ? 'last_7d' : 'last_30d'
  const result = await graphGet<{
    data: {
      spend?: string
      impressions?: string
      clicks?: string
      actions?: ActionEntry[]
      action_values?: ActionEntry[]
      purchase_roas?: { action_type: string; value: string }[]
    }[]
  }>(`/${adAccountId}/insights`, {
    fields: 'spend,impressions,clicks,actions,action_values,purchase_roas',
    date_preset: datePreset,
    access_token: accessToken,
  })
  if (!result.ok) return result

  const row = result.data.data[0]
  if (!row) {
    return { ok: true, data: { spend: 0, impressions: 0, clicks: 0, conversions: 0, roas: null } }
  }

  const spend = Number(row.spend) || 0
  const impressions = Number(row.impressions) || 0
  const clicks = Number(row.clicks) || 0
  const conversions = sumActionValues(row.actions, PURCHASE_ACTION_TYPES) + sumActionValues(row.actions, LEAD_ACTION_TYPES)

  // ROAS: once dogrudan purchase_roas alanini dene (Meta'nin kendi hesapladigi
  // deger), yoksa satis degerinden turet, hicbiri yoksa NULL birak — "0.00"
  // gibi YANLIS bir "hic getiri yok" izlenimi vermesin (donusum takibi hic
  // kurulmamis olabilir).
  let roas: number | null = null
  if (row.purchase_roas && row.purchase_roas.length > 0) {
    roas = row.purchase_roas.reduce((sum, r) => sum + (Number(r.value) || 0), 0)
  } else {
    const purchaseValue = sumActionValues(row.action_values, PURCHASE_ACTION_TYPES)
    if (purchaseValue > 0 && spend > 0) roas = purchaseValue / spend
  }

  return { ok: true, data: { spend, impressions, clicks, conversions, roas } }
}
