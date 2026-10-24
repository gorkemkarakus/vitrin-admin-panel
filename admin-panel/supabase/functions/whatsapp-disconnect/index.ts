import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { decryptToken } from '../_shared/crypto.ts'
import { unsubscribeApp } from '../_shared/metaWhatsApp.ts'
import { forgetWhatsappAccessToken } from '../_shared/whatsappToken.ts'

// "Bağlantıyı kaldır": asistan bu numaraya artik cevap vermez. Meta'daki
// abonelik kapatilir (basarisiz olursa yine de bizim taraf temizlenir);
// numara salonun WhatsApp Business uygulamasinda calismaya devam eder.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  const { data: conn } = await admin
    .from('business_whatsapp_connections')
    .select('waba_id, phone_number_id, encrypted_access_token')
    .eq('business_id', businessId)
    .maybeSingle()
  if (!conn) return json({ data: { ok: true } }, 200)

  const key = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (key) {
    try {
      const token = await decryptToken(conn.encrypted_access_token, key)
      const res = await unsubscribeApp(conn.waba_id, token)
      if (!res.ok) console.error('whatsapp-disconnect: abonelik kapatılamadı', res.error)
    } catch (e) {
      console.error('whatsapp-disconnect: anahtar çözülemedi', e instanceof Error ? e.message : e)
    }
  }

  const { error: delErr } = await admin.from('business_whatsapp_connections').delete().eq('business_id', businessId)
  if (delErr) {
    console.error('whatsapp-disconnect: bağlantı silinemedi', delErr.message)
    return json({ error: 'Bağlantı kaldırılamadı' }, 500)
  }
  await admin
    .from('businesses')
    .update({ whatsapp_phone_number_id: null })
    .eq('id', businessId)
    .eq('whatsapp_phone_number_id', conn.phone_number_id)
  forgetWhatsappAccessToken(conn.phone_number_id)

  return json({ data: { ok: true } }, 200)
})
