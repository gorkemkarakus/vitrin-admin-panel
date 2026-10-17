import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Cloudflare Turnstile dogrulamasi (herkese acik formlar). Secret once
// function ortamindan, yoksa _app_secrets tablosundan okunur (CLI ile secret
// ayarlanamadigi durumlar icin; bkz. resolveBusiness.ts). Hic ayarlanmamissa
// dogrulama atlanir — anahtarlar kurulana kadar formlar calismaya devam etsin
// diye; hiz sinirlari bu durumda da gecerli.
export async function verifyTurnstile(
  admin: SupabaseClient,
  token: string | undefined,
  ip: string | null,
): Promise<boolean> {
  let secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret) {
    const { data } = await admin.from('_app_secrets').select('value').eq('name', 'turnstile_secret_key').maybeSingle()
    secret = (data?.value as string | undefined) || undefined
  }
  if (!secret) return true
  if (!token) return false
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  const outcome = await res.json()
  return outcome.success === true
}
