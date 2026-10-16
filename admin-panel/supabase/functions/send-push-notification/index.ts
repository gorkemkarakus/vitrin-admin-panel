import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { timingSafeEqualString } from '../_shared/crypto.ts'

// Telefon bildirimi (Firebase Cloud Messaging, HTTP v1). appointments
// trigger'i (bkz. 20261016000003_push_notifications.sql) pg_net ile cagirir.
//
// Kime gider:
//  - Yeni randevu, islemi yapan biri yoksa (online sayfa, chatbot):
//    yoneticiler + randevuya atanan calisan.
//  - Yeni randevu, panelden biri ekledi: sadece atanan calisan (ekleyen degilse).
//  - Iptal: yoneticiler + atanan calisan, iptal eden haric.
//
// FCM_SERVICE_ACCOUNT (Firebase servis hesabi JSON'u) tanimli degilse hicbir
// sey gondermeden 200 doner — altyapi hazir olmadan da trigger zararsizdir.

type ServiceAccount = { project_id: string; client_email: string; private_key: string }

function b64url(data: Uint8Array | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) throw new Error('Google token alinamadi: ' + JSON.stringify(data))
  return data.access_token
}

function whenLabel(iso: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Trigger'in gonderdigi anahtar _app_secrets'ta (yalnizca service role okur);
  // istenirse PUSH_WEBHOOK_SECRET ortam degiskeniyle de verilebilir.
  let secret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? null
  if (!secret) {
    const { data } = await admin.from('_app_secrets').select('value').eq('name', 'push_webhook_secret').maybeSingle()
    secret = data?.value ?? null
  }
  const provided = req.headers.get('x-webhook-secret')
  if (!secret || !provided || !timingSafeEqualString(provided, secret)) {
    return json({ error: 'Yetkisiz' }, 401)
  }

  let body: { event?: string; appointment_id?: string; actor_id?: string | null }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }
  const { event, appointment_id, actor_id } = body
  if (!appointment_id || (event !== 'created' && event !== 'cancelled')) return json({ error: 'Geçersiz olay' }, 400)

  const saRaw = Deno.env.get('FCM_SERVICE_ACCOUNT')
  if (!saRaw) return json({ skipped: 'fcm-not-configured' })
  let sa: ServiceAccount
  try {
    sa = JSON.parse(saRaw)
  } catch {
    return json({ error: 'FCM_SERVICE_ACCOUNT okunamadı' }, 500)
  }

  const { data: appt } = await admin
    .from('appointments')
    .select('id, business_id, customer_id, service_id, employee_id, scheduled_at, source, status')
    .eq('id', appointment_id)
    .maybeSingle()
  if (!appt) return json({ error: 'Randevu bulunamadı' }, 404)

  // Gecmise toplu kayit (veri aktarimi vb.) bildirim yagdirmasin.
  if (event === 'created' && new Date(appt.scheduled_at).getTime() < Date.now() - 3600_000) {
    return json({ skipped: 'past-appointment' })
  }

  const [{ data: customer }, { data: service }, { data: admins }] = await Promise.all([
    appt.customer_id
      ? admin.from('customers').select('full_name').eq('id', appt.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    appt.service_id
      ? admin.from('services').select('name').eq('id', appt.service_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('profiles').select('id').eq('business_id', appt.business_id).eq('role', 'admin').eq('is_active', true),
  ])

  const recipients = new Set<string>()
  const includeAdmins = event === 'cancelled' || !actor_id
  if (includeAdmins) for (const a of admins ?? []) recipients.add(a.id)
  if (appt.employee_id) recipients.add(appt.employee_id)
  if (actor_id) recipients.delete(actor_id)
  if (recipients.size === 0) return json({ sent: 0 })

  const { data: devices } = await admin
    .from('push_devices')
    .select('token, profile_id')
    .eq('business_id', appt.business_id)
    .in('profile_id', [...recipients])
  if (!devices?.length) return json({ sent: 0 })

  const who = customer?.full_name ?? 'Müşteri'
  const what = [service?.name, whenLabel(appt.scheduled_at)].filter(Boolean).join(' · ')
  const online = appt.source === 'online_randevu'
  const bot = appt.source === 'chatbot'
  const title =
    event === 'cancelled'
      ? 'Randevu iptal edildi'
      : online
        ? 'Yeni online randevu'
        : bot
          ? 'Chatbot randevu aldı'
          : 'Sana yeni randevu'
  const text = `${who} · ${what}`
  const route = `/randevular?tarih=${new Date(appt.scheduled_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })}`

  let accessToken: string
  try {
    accessToken = await googleAccessToken(sa)
  } catch (e) {
    console.error(e)
    return json({ error: 'FCM yetkilendirme hatası' }, 502)
  }

  let sent = 0
  const stale: string[] = []
  await Promise.all(
    devices.map(async (d) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: d.token,
            notification: { title, body: text },
            data: { route, appointment_id: appt.id, event },
            android: { priority: 'high', notification: { channel_id: 'randevular', sound: 'default' } },
            apns: { payload: { aps: { sound: 'default' } } },
          },
        }),
      })
      if (res.ok) {
        sent++
        return
      }
      const err = await res.text()
      // Uygulama silinmis / token yenilenmis: kaydi temizle.
      if (res.status === 404 || /UNREGISTERED/.test(err)) stale.push(d.token)
      else console.error('FCM hatası', res.status, err)
    }),
  )
  if (stale.length) await admin.from('push_devices').delete().in('token', stale)

  return json({ sent, removed: stale.length })
})
