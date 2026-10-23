import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { resolveBusiness } from '../_shared/resolveBusiness.ts'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  let body: { customer_phone?: string; messages?: Turn[]; phone_number_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const business = await resolveBusiness(admin, req, body.phone_number_id)
  if (!business) return json({ error: 'Geçersiz API anahtarı' }, 401)

  const { customer_phone, messages } = body
  if (!customer_phone || !messages || messages.length === 0) {
    return json({ error: 'customer_phone ve messages zorunlu' }, 400)
  }

  // Ayni istekte gelen mesajlar (musteri mesaji + asistan cevabi) ayni anda
  // yaziliyordu; created_at esit olunca gecmis sorgusunda sira rastgele
  // geliyor, cevap kendi sorusundan once gorunebiliyordu. Her satira 1 ms
  // arayla artan zaman verilir, sira korunur.
  const base = Date.now()
  const rows = messages.map((m, i) => ({
    business_id: business.id,
    customer_phone,
    role: m.role,
    content: m.content,
    created_at: new Date(base + i).toISOString(),
  }))

  const { error: insertErr } = await admin.from('chatbot_messages').insert(rows)
  if (insertErr) {
    console.error('chatbot-log-message insert error:', insertErr.message)
    return json({ error: 'Mesaj kaydedilemedi' }, 500)
  }

  return json({ status: 'ok' }, 200)
})
