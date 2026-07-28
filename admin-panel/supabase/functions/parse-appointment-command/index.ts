import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { buildExtractionSystemPrompt, extractAppointmentCommand, istanbulDateString } from '../_shared/appointmentExtraction.ts'

const RATE_LIMIT_MAX_PER_HOUR = 30

// Personelin serbest metinle yazdigi randevu komutunu ("yarına 15'te
// manikür randevusu yaz, müşteri Ayşe") yapılandırılmış alanlara ayırır.
// Gerçek randevu KAYDI burada olusturulmuyor — sonuc panelde zaten var olan
// "Yeni Randevu" formunu ON-DOLDURMAK icin kullaniliyor; kullanici formu
// gözden geçirip normal "Randevu oluştur" akışıyla onaylıyor (mevcut RLS ve
// müsaitlik kontrolleri hiç değişmeden çalışmaya devam ediyor).
//
// Gercek bir kullanici oturumu gerektirir (bu fonksiyon --no-verify-jwt
// OLMADAN deploy edilir) — sadece cagiranin kimligini kriptografik olarak
// dogruluyoruz, is_active/business_id kontrolüne gerek yok çünkü bu
// fonksiyon veritabanina hicbir yazma yapmiyor, sadece LLM'e soruyor.
interface RequestBody {
  text?: string
  today?: string // YYYY-MM-DD, İstanbul takvimi — client'tan gelir
  services?: { id: string; name: string; duration_minutes: number }[]
  employees?: { id: string; name: string }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Yetkilendirme başlığı eksik' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'Geçersiz oturum' }, 401)

  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) return json({ error: 'Yapay zeka servisi yapılandırılmamış' }, 500)

  // Ucretli bir OpenAI cagrisi tetikliyor — gecerli bir oturum yeterli
  // korumayi saglamiyordu (bkz. migration 20260725000009), bu yuzden
  // kullanici basina saatlik ust sinir eklendi.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await admin.from('parse_command_attempts').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  const { count: recentAttempts } = await admin
    .from('parse_command_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userData.user.id)
    .gte('created_at', oneHourAgo)
  if ((recentAttempts ?? 0) >= RATE_LIMIT_MAX_PER_HOUR) {
    return json({ error: 'Çok fazla deneme yapıldı, lütfen daha sonra tekrar deneyin.' }, 429)
  }
  await admin.from('parse_command_attempts').insert({ user_id: userData.user.id })

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek gövdesi' }, 400)
  }

  const text = (body.text ?? '').trim()
  if (!text) return json({ error: 'Metin zorunlu' }, 400)
  const today = body.today && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : istanbulDateString(new Date())
  const services = Array.isArray(body.services) ? body.services : []
  const employees = Array.isArray(body.employees) ? body.employees : []

  const systemPrompt = buildExtractionSystemPrompt({ today, services, employees })
  const result = await extractAppointmentCommand(openaiKey, systemPrompt, text)
  if (!result.ok) return json({ error: result.error }, result.status)

  return json(result.draft, 200)
})
