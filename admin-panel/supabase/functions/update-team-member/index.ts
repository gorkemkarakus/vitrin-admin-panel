import { corsHeaders, json } from '../_shared/http.ts'
import { isPwnedPassword, PWNED_PASSWORD_MESSAGE } from '../_shared/pwned.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  let body: { id?: string; email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { id, email, password } = body
  if (!id) return json({ error: 'id zorunlu' }, 400)
  if (!email && !password) return json({ error: 'Güncellenecek e-posta veya şifre girin' }, 400)
  if (password && password.length < 8) return json({ error: 'Şifre en az 8 karakter olmalı' }, 400)
  if (password && (await isPwnedPassword(password))) {
    return json({ error: PWNED_PASSWORD_MESSAGE, code: 'PWNED' }, 400)
  }

  // Hedef calisanin cagiranla AYNI isletmeye ait oldugunu dogrula — baska
  // isletmenin hesabini degistirmeyi engeller.
  const { data: targetProfile, error: targetErr } = await admin
    .from('profiles')
    .select('business_id')
    .eq('id', id)
    .maybeSingle()

  if (targetErr || !targetProfile || targetProfile.business_id !== businessId) {
    return json({ error: 'Çalışan bulunamadı' }, 404)
  }

  const updates: { email?: string; password?: string } = {}
  if (email) updates.email = email
  if (password) updates.password = password

  const { error: updateErr } = await admin.auth.admin.updateUserById(id, updates)

  if (updateErr) {
    console.error('update-team-member error:', updateErr.message)
    const msg = updateErr.message.toLowerCase()
    const isDupEmail = msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists')
    return json({ error: isDupEmail ? 'Bu e-posta zaten kullanılıyor' : 'Hesap güncellenemedi' }, 400)
  }

  return json({ data: { id } }, 200)
})
