import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { fetchAdInsights } from '../_shared/metaAds.ts'

const FRESH_MS = 20 * 60 * 60 * 1000 // ~20 saat — günlük cron'un bir ricochet penceresi

function periodFor(rangeDays: 7 | 30) {
  const end = new Date()
  const start = new Date(end.getTime() - (rangeDays - 1) * 86400000)
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10)
  return { period_start: toDateStr(start), period_end: toDateStr(end) }
}

// Dashboard'ın çağırdığı fonksiyon: önbellekte taze bir snapshot varsa onu
// döner, yoksa (bağlantı ilk kurulduğunda, ya da cron henüz çalışmadıysa)
// CANLI Meta çağrısı yapıp önbelleği güncelleyerek döner — kullanıcı
// "bağlan"dıktan hemen sonra boş bir ekranla karşılaşmasın diye.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  let body: { range_days?: number }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }
  const rangeDays = body.range_days === 30 ? 30 : body.range_days === 7 ? 7 : null
  if (!rangeDays) return json({ error: 'range_days 7 veya 30 olmalı' }, 400)

  const { data: connection, error: connErr } = await admin
    .from('business_ad_connections')
    .select('status, ad_account_id, encrypted_access_token, ad_account_name, last_synced_at')
    .eq('business_id', businessId)
    .maybeSingle()

  if (connErr || !connection || connection.status !== 'connected' || !connection.ad_account_id) {
    return json({ error: 'Bağlı bir reklam hesabı yok' }, 404)
  }

  const { data: cached } = await admin
    .from('ad_insight_snapshots')
    .select('spend, impressions, clicks, conversions, roas, period_start, period_end, generated_at')
    .eq('business_id', businessId)
    .eq('range_days', rangeDays)
    .maybeSingle()

  const isFresh = cached && Date.now() - new Date(cached.generated_at).getTime() < FRESH_MS
  if (isFresh) {
    return json(
      {
        data: {
          ad_account_name: connection.ad_account_name,
          last_synced_at: connection.last_synced_at,
          ...cached,
        },
      },
      200,
    )
  }

  const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!encryptionKey || !connection.encrypted_access_token) {
    console.error('get-ad-insights: TOKEN_ENCRYPTION_KEY eksik veya token yok')
    return json({ error: 'Sunucu yapılandırması eksik' }, 500)
  }

  const accessToken = await decryptToken(connection.encrypted_access_token, encryptionKey)
  const insights = await fetchAdInsights(accessToken, connection.ad_account_id, rangeDays)
  if (!insights.ok) {
    await admin.from('business_ad_connections').update({ last_error: insights.error }).eq('business_id', businessId)
    return json({ error: insights.error }, insights.status)
  }

  const period = periodFor(rangeDays)
  const nowIso = new Date().toISOString()

  // onConflict ZORUNLU: birincil anahtar 'id' (rastgele uuid), (business_id,
  // range_days) sadece AYRI bir UNIQUE kisit — belirtilmezse upsert bunu
  // conflict hedefi saymaz, her cagrida YENI bir satir eklemeye calisir ve
  // ikinci cagrida UNIQUE ihlaliyle patlar.
  await admin.from('ad_insight_snapshots').upsert(
    {
      business_id: businessId,
      range_days: rangeDays,
      ...period,
      ...insights.data,
      generated_at: nowIso,
    },
    { onConflict: 'business_id,range_days' },
  )
  await admin.from('business_ad_connections').update({ last_synced_at: nowIso, last_error: null }).eq('business_id', businessId)

  return json(
    {
      data: {
        ad_account_name: connection.ad_account_name,
        last_synced_at: nowIso,
        ...period,
        ...insights.data,
        generated_at: nowIso,
      },
    },
    200,
  )
})
