import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { clientKey, rateLimit } from '../_shared/limits.ts'
import { verifyTurnstile } from '../_shared/turnstile.ts'

// Herkese acik — uygulamaya giremeyen kullanicinin (veya salon musterisinin)
// hesap/veri silme talebi. Google Play "hesap silme URL'si" ve KVKK md. 11
// basvurulari icin. Burada HICBIR SEY silinmez: talep kaydedilir, platform
// operatoru kimligi dogrulayip isler (bkz. RELEASE_CHECKLIST.md). Bu yuzden
// sahte talep zarar vermez; yine de spam'e karsi IP basina sinir var.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const kind = body.kind === 'customer' ? 'customer' : body.kind === 'account' ? 'account' : null
  const contact = clean(body.contact, 254)
  const fullName = clean(body.full_name, 120)
  const businessName = clean(body.business_name, 120)
  const note = clean(body.note, 1000)

  if (!kind) return json({ error: 'Talep türünü seçin' }, 400)
  if (!contact) return json({ error: 'E-posta veya telefon zorunlu' }, 400)
  const digits = contact.replace(/\D/g, '')
  if (!EMAIL_RE.test(contact) && !(digits.length >= 10 && digits.length <= 13)) {
    return json({ error: 'Geçerli bir e-posta adresi veya telefon numarası girin' }, 400)
  }
  if (kind === 'customer' && !businessName) {
    return json({ error: 'Randevu aldığınız işletmenin adını yazın' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const ipHash = await clientKey(req)
  const limited = await rateLimit(admin, 'account-deletion-request', ipHash, 5, 3600)
  if (limited) return limited

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : undefined
  if (!(await verifyTurnstile(admin, token, ip))) {
    return json({ error: 'Doğrulama başarısız, lütfen sayfayı yenileyip tekrar deneyin.' }, 400)
  }

  const { error } = await admin.from('account_deletion_requests').insert({
    kind,
    contact,
    full_name: fullName,
    business_name: businessName,
    note,
    ip_hash: ipHash,
  })
  if (error) {
    console.error('account-deletion-request insert error:', error.message)
    return json({ error: 'Talep kaydedilemedi, lütfen daha sonra tekrar deneyin.' }, 500)
  }
  return json({ data: { received: true } }, 200)
})
