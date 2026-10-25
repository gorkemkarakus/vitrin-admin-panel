import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { ensureTemplates, templateStatuses } from '../_shared/metaWhatsApp.ts'
import { businessWhatsappAccount } from '../_shared/whatsappAccount.ts'

// WhatsApp hesabi ekrani: randevu onay/hatirlatma sablonlarinin Meta'daki
// onay durumu ("list") ve eksik olanlari kurma ("ensure"). Sablonlar salon
// numarasini bagladiginda zaten kurulur; bu, durumu gormek ve kurulum
// basarisiz olduysa yeniden denemek icin.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  const body = await req.json().catch(() => ({}))
  const action = body?.action === 'ensure' ? 'ensure' : 'list'

  const account = await businessWhatsappAccount(admin, businessId)
  if (!account) return json({ data: { connected: false, templates: [] } }, 200)

  const res =
    action === 'ensure' ? await ensureTemplates(account.wabaId, account.token) : await templateStatuses(account.wabaId, account.token)
  if (!res.ok) {
    console.error('whatsapp-templates: Meta hatası', res.error)
    return json({ error: 'Şablon durumu alınamadı, birazdan tekrar deneyin.' }, 502)
  }
  return json({ data: { connected: true, templates: res.data } }, 200)
})
