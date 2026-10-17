import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { clientKey, rateLimit } from '../_shared/limits.ts'
import { verifyTurnstile } from '../_shared/turnstile.ts'
import { isPwnedPassword, PWNED_PASSWORD_MESSAGE } from '../_shared/pwned.ts'
import { sha256Hex } from '../_shared/crypto.ts'

// Herkese acik — kendi kendine kayit: isletme + yonetici hesabi Ucretsiz
// paketle acilir. Supabase'in herkese acik kaydi KAPALI kalir (disable_signup);
// hesap yalnizca burada, Turnstile + IP siniri arkasinda acilir.
//
// E-posta onaylanmadan giris yapilamaz (mailer_autoconfirm kapali): hesap
// email_confirm=false ile acilir, onay e-postasi Supabase'in kendi
// e-posta altyapisiyla gider (canliya cikmadan once ozel SMTP sart — varsayilan
// SMTP yalnizca ekip uyelerinin adreslerine ve saatte birkac e-posta gonderir).
//
// action 'resend': onay e-postasini tekrar gonderir (e-posta basina sinirli).
//
// Kayitli bir e-postayla gelinirse de AYNI "e-postani kontrol et" yaniti
// doner: hangi adresin kayitli oldugu disari sizmaz.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TERMS_VERSION = '2026-10'

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : ''
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const email = clean(body.email, 254).toLowerCase()
  if (!EMAIL_RE.test(email)) return json({ error: 'Geçerli bir e-posta adresi girin.' }, 400)
  // Onay baglantisinin donecegi adres; Supabase izinli adres listesinde
  // degilse kendi Site URL'sine doner.
  const redirectTo = typeof body.redirect_to === 'string' ? body.redirect_to.slice(0, 300) : undefined

  const ipHash = await clientKey(req)

  if (body.action === 'resend') {
    const limited =
      (await rateLimit(admin, 'register-resend-ip', ipHash, 10, 3600)) ??
      (await rateLimit(admin, 'register-resend-email', await sha256Hex(`email:${email}`), 3, 3600))
    if (limited) return limited
    const { error } = await admin.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } })
    if (error) console.error('register-business resend error:', error.message)
    return json({ data: { sent: true } }, 200)
  }

  const businessName = clean(body.business_name, 120)
  const fullName = clean(body.full_name, 120)
  const password = typeof body.password === 'string' ? body.password : ''

  if (businessName.length < 2) return json({ error: 'İşletme adını yazın.' }, 400)
  if (fullName.length < 2) return json({ error: 'Adınızı ve soyadınızı yazın.' }, 400)
  if (password.length < 8 || password.length > 72) return json({ error: 'Şifre 8-72 karakter olmalı.' }, 400)
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    return json({ error: 'Şifre harf ve rakam içermeli.' }, 400)
  }
  if (body.accept_terms !== true) {
    return json({ error: 'Devam etmek için Kullanım Koşulları’nı kabul edin.' }, 400)
  }

  const limited = await rateLimit(admin, 'register-business', ipHash, 5, 3600)
  if (limited) return limited

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : undefined
  if (!(await verifyTurnstile(admin, token, ip))) {
    return json({ error: 'Doğrulama başarısız, lütfen sayfayı yenileyip tekrar deneyin.' }, 400)
  }

  if (await isPwnedPassword(password)) return json({ error: PWNED_PASSWORD_MESSAGE, code: 'PWNED' }, 400)

  const checkEmail = json({ data: { status: 'check_email', email } }, 200)

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { full_name: fullName },
  })
  if (userErr || !created?.user) {
    // Ayni e-posta zaten kayitliysa ayni yanit (bkz. ust aciklama).
    if (/already|registered|exists/i.test(userErr?.message ?? '')) return checkEmail
    console.error('register-business createUser error:', userErr?.message)
    return json({ error: 'Hesap oluşturulamadı, lütfen tekrar deneyin.' }, 500)
  }
  const userId = created.user.id

  const { data: business, error: bizErr } = await admin
    .from('businesses')
    .insert({
      name: businessName,
      plan: 'free',
      plan_source: null,
      signup_source: 'self',
      terms_accepted_at: new Date().toISOString(),
      terms_version: TERMS_VERSION,
    })
    .select('id')
    .single()
  if (bizErr || !business) {
    console.error('register-business business insert error:', bizErr?.message)
    await admin.auth.admin.deleteUser(userId)
    return json({ error: 'Hesap oluşturulamadı, lütfen tekrar deneyin.' }, 500)
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: userId,
    business_id: business.id,
    role: 'admin',
    full_name: fullName,
  })
  if (profileErr) {
    console.error('register-business profile insert error:', profileErr.message)
    await admin.auth.admin.deleteUser(userId)
    await admin.from('businesses').delete().eq('id', business.id)
    return json({ error: 'Hesap oluşturulamadı, lütfen tekrar deneyin.' }, 500)
  }

  const { error: mailErr } = await admin.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } })
  if (mailErr) console.error('register-business confirmation mail error:', mailErr.message)

  return checkEmail
})
