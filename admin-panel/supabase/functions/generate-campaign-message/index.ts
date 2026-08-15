import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'

// Diger OpenAI cagrilarimizla (appointmentExtraction.ts, aiInsights.ts) AYNI
// desen: raw fetch, model gpt-5-mini, yapilandirilmis cikti icin tool-forcing.
const MODEL = 'gpt-5-mini'
const TOOL_NAME = 'submit_campaign_message'
const RATE_LIMIT_MAX_PER_HOUR = 30

function toolSchema() {
  return [
    {
      type: 'function' as const,
      function: {
        name: TOOL_NAME,
        description: 'Musteriye WhatsApp ile gonderilecek, hazir kampanya mesajini bildir.',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description:
                'Musteriye doğrudan gonderilebilecek, tamamen hazir Turkce WhatsApp mesaji. Sadece mesajin kendisi — başlık, tırnak işareti, aciklama YOK.',
            },
          },
          required: ['message'],
        },
      },
    },
  ]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    console.error('generate-campaign-message: OPENAI_API_KEY eksik')
    return json({ error: 'Sunucu yapılandırması eksik' }, 500)
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return json({ error: 'Ne yazmak istediğinizi kısaca belirtin' }, 400)
  if (prompt.length > 300) return json({ error: 'Açıklama çok uzun, kısaltın' }, 400)

  // Ucretli bir OpenAI cagrisi tetikliyor — parse-appointment-command ile
  // AYNI desen, isletme basina saatlik ust sinir.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await admin.from('campaign_message_attempts').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  const { count: recentAttempts } = await admin
    .from('campaign_message_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('created_at', oneHourAgo)
  if ((recentAttempts ?? 0) >= RATE_LIMIT_MAX_PER_HOUR) {
    return json({ error: 'Çok fazla deneme yapıldı, lütfen daha sonra tekrar deneyin.' }, 429)
  }
  await admin.from('campaign_message_attempts').insert({ business_id: businessId })

  // AI'in olmayan hizmet ismi uydurmasini (ör. "saç kesimi, renklendirme")
  // engellemek icin isletmenin GERCEK hizmet listesi promta veriliyor —
  // AI sadece bu listedeki isimleri kullanabilir, baska bir hizmet UYDURAMAZ.
  const { data: servicesRows } = await admin.from('services').select('name').eq('business_id', businessId).eq('is_active', true)
  const serviceNames = (servicesRows ?? []).map((s) => s.name).filter(Boolean)
  const servicesBlock =
    serviceNames.length > 0
      ? `Bu işletmenin GERÇEKTEN sunduğu hizmetler: ${serviceNames.join(', ')}.`
      : 'Bu işletmenin hizmet listesi bilinmiyor.'

  const system = `Sen bir kuaför/güzellik salonu için Türkçe WhatsApp kampanya mesajları yazan bir metin yazarısın. Kullanıcı sana kısa bir istek verecek (ör. "%15 indirim mesajı"), sen bunu müşteriye DOĞRUDAN gönderilebilecek, tamamen hazır, sıcak ve samimi ama profesyonel bir WhatsApp mesajına çevireceksin.

${servicesBlock}

Kurallar:
- Türkçe yaz, 2-4 cümle, kısa ve akıcı olsun.
- En fazla 1-2 emoji kullan, abartma.
- Müşteriye "siz" diye hitap et.
- Rakam/oran gibi somut bir bilgi verilmişse (ör. "%15 indirim") AYNEN kullan, uydurma başka bir rakam ekleme.
- ÖNEMLİ: Mesajda belirli bir hizmet adı geçecekse SADECE yukarıdaki gerçek hizmet listesinden seç — asla var olmayan bir hizmet ismi (ör. "saç kesimi", "renklendirme" gibi listede olmayan bir şey) UYDURMA. Kullanıcının isteği belirli bir hizmete işaret etmiyorsa hizmet adı hiç anma, genel bir ifade kullan (ör. "hizmetlerimizde" yerine "sizi salonumuzda ağırlamaktan mutluluk duyarız" gibi).
- Sadece mesajın kendisini üret — başlık, açıklama, tırnak işareti YOK, doğrudan gönderilecek metin.`

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      tool_choice: { type: 'function', function: { name: TOOL_NAME } },
      tools: toolSchema(),
    }),
  })

  if (!openaiRes.ok) {
    const errText = await openaiRes.text()
    console.error('generate-campaign-message: OpenAI API hatası:', openaiRes.status, errText)
    return json({ error: 'Mesaj oluşturulamadı, lütfen tekrar deneyin' }, 502)
  }

  const openaiBody = await openaiRes.json()
  const choice = openaiBody?.choices?.[0]
  if (choice?.finish_reason === 'content_filter') {
    return json({ error: 'Bu istek işlenemedi, lütfen farklı ifade edin' }, 422)
  }

  const toolCall = choice?.message?.tool_calls?.[0] as { function?: { arguments?: string } } | undefined
  let message = ''
  if (toolCall?.function?.arguments) {
    try {
      const parsed = JSON.parse(toolCall.function.arguments)
      if (typeof parsed.message === 'string') message = parsed.message.trim()
    } catch {
      message = ''
    }
  }
  if (!message) return json({ error: 'Mesaj oluşturulamadı, lütfen tekrar deneyin' }, 502)

  return json({ data: { message } }, 200)
})
