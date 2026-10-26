import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { decryptToken, encryptToken, timingSafeEqualString } from '../_shared/crypto.ts'
import { refreshToken } from '../_shared/instagram.ts'

// pg_cron her gece cagirir (bkz. 20261026000002_instagram_connections.sql).
// Instagram anahtarlari 60 gun gecerli; suresinin dolmasina REFRESH_DAYS'ten
// az kalanlar yeni 60 gune uzatilir. Yenilenemeyen (ör. salon izni Instagram'dan
// kaldirdi) baglanti loglanir; salon uygulamadan yeniden baglar.
const REFRESH_DAYS = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const webhookSecret = Deno.env.get('APPOINTMENT_WEBHOOK_SECRET')
  const provided = req.headers.get('x-webhook-secret')
  if (!webhookSecret || !provided || !timingSafeEqualString(provided, webhookSecret)) {
    return json({ error: 'Yetkisiz' }, 401)
  }
  const key = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!key) return json({ error: 'TOKEN_ENCRYPTION_KEY eksik' }, 500)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: rows } = await admin
    .from('business_instagram_connections')
    .select('business_id, encrypted_access_token, token_expires_at')
    .lt('token_expires_at', new Date(Date.now() + REFRESH_DAYS * 86400000).toISOString())

  let refreshed = 0
  for (const row of rows ?? []) {
    try {
      const res = await refreshToken(await decryptToken(row.encrypted_access_token, key))
      if (!res.ok) {
        console.error('instagram-refresh-tokens: yenilenemedi', { business_id: row.business_id, error: res.error })
        continue
      }
      await admin
        .from('business_instagram_connections')
        .update({ encrypted_access_token: await encryptToken(res.data.accessToken, key), token_expires_at: res.data.expiresAt })
        .eq('business_id', row.business_id)
      refreshed++
    } catch (e) {
      console.error('instagram-refresh-tokens: hata', { business_id: row.business_id, error: e instanceof Error ? e.message : e })
    }
  }
  return json({ ok: true, refreshed }, 200)
})
