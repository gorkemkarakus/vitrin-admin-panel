import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { sha256Hex } from '../_shared/crypto.ts'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return json({ error: 'x-api-key başlığı eksik' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const keyHash = await sha256Hex(apiKey)
  const { data: business, error: bizErr } = await admin
    .from('businesses')
    .select('id')
    .eq('api_key_hash', keyHash)
    .maybeSingle()

  if (bizErr || !business) return json({ error: 'Geçersiz API anahtarı' }, 401)

  let body: { customer_phone?: string; messages?: Turn[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const { customer_phone, messages } = body
  if (!customer_phone || !messages || messages.length === 0) {
    return json({ error: 'customer_phone ve messages zorunlu' }, 400)
  }

  const rows = messages.map((m) => ({
    business_id: business.id,
    customer_phone,
    role: m.role,
    content: m.content,
  }))

  const { error: insertErr } = await admin.from('chatbot_messages').insert(rows)
  if (insertErr) {
    console.error('chatbot-log-message insert error:', insertErr.message)
    return json({ error: 'Mesaj kaydedilemedi' }, 500)
  }

  return json({ status: 'ok' }, 200)
})
