import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { decryptToken, timingSafeEqualString } from '../_shared/crypto.ts'
import { fetchAdInsights } from '../_shared/metaAds.ts'

function periodFor(rangeDays: 7 | 30) {
  const end = new Date()
  const start = new Date(end.getTime() - (rangeDays - 1) * 86400000)
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10)
  return { period_start: toDateStr(start), period_end: toDateStr(end) }
}

// pg_cron tarafından günlük, refresh-ad-tokens'tan SONRA çağrılır. Bağlı her
// işletme × her aralık (7/30 gün) için Meta'dan HAM veriyi çeker ve
// ad_insight_snapshots'a yazar — get-ad-insights bu önbelleği okur.
// Her işletmenin verisi ayrı ayrı, izole şekilde işlenir (döngü içinde tek
// tek) — bir işletmenin verisi başka bir işletmenin isteğine hiçbir şekilde
// karışmaz.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const webhookSecret = Deno.env.get('META_ADS_WEBHOOK_SECRET')
  const provided = req.headers.get('x-webhook-secret')
  if (!webhookSecret || !provided || !timingSafeEqualString(provided, webhookSecret)) {
    return json({ error: 'Yetkisiz' }, 401)
  }

  const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!encryptionKey) {
    console.error('sync-ad-insights: TOKEN_ENCRYPTION_KEY eksik')
    return json({ error: 'Sunucu yapılandırması eksik' }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: connections } = await admin
    .from('business_ad_connections')
    .select('business_id, ad_account_id, encrypted_access_token')
    .eq('status', 'connected')

  let synced = 0
  let failed = 0
  const nowIso = new Date().toISOString()

  for (const conn of connections ?? []) {
    if (!conn.ad_account_id || !conn.encrypted_access_token) continue
    let connectionFailed = false
    try {
      const accessToken = await decryptToken(conn.encrypted_access_token, encryptionKey)
      for (const rangeDays of [7, 30] as const) {
        const insights = await fetchAdInsights(accessToken, conn.ad_account_id, rangeDays)
        if (!insights.ok) {
          connectionFailed = true
          await admin
            .from('business_ad_connections')
            .update({ last_error: insights.error })
            .eq('business_id', conn.business_id)
          continue
        }
        // onConflict ZORUNLU — bkz. get-ad-insights'teki ayni aciklama:
        // birincil anahtar 'id', (business_id, range_days) ayri bir UNIQUE
        // kisit, belirtilmezse her cron turunda yeni satir eklenmeye
        // calisilir ve ikinci turda UNIQUE ihlaliyle patlar.
        await admin.from('ad_insight_snapshots').upsert(
          {
            business_id: conn.business_id,
            range_days: rangeDays,
            ...periodFor(rangeDays),
            ...insights.data,
            generated_at: nowIso,
          },
          { onConflict: 'business_id,range_days' },
        )
      }
      if (!connectionFailed) {
        await admin
          .from('business_ad_connections')
          .update({ last_synced_at: nowIso, last_error: null })
          .eq('business_id', conn.business_id)
        synced++
      } else {
        failed++
      }
    } catch (err) {
      console.error('sync-ad-insights: işletme için beklenmeyen hata', conn.business_id, err)
      await admin
        .from('business_ad_connections')
        .update({ last_error: 'Senkronizasyon sırasında beklenmeyen hata' })
        .eq('business_id', conn.business_id)
      failed++
    }
  }

  return json({ ok: true, synced, failed }, 200)
})
