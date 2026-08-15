// Dis-AI-cagrisi deseni appointmentExtraction.ts ile AYNI: raw fetch, SDK
// yok, model gpt-5-mini (projede zaten kullanilan tek model) — bu proje
// zaten OpenAI kullaniyor, yeni bir saglayici/API key eklemeye gerek yok.
const MODEL = 'gpt-5-mini'
const TOOL_NAME = 'submit_business_analysis'

// appointments.source CHECK kisitindaki TAM 7 deger (DashboardPage'in
// kendi SOURCE_ORDER'i sadece 5 tanesini kapsiyor, Instagram/WhatsApp
// reklamlarini sessizce atliyor — bu yuzden src/lib/sourceLabels.ts'ten
// AYRI, tam bir kopya burada tutuluyor).
export const SOURCE_LABEL: Record<string, string> = {
  reklam_instagram: 'Instagram Reklamı',
  reklam_whatsapp: 'WhatsApp Reklamı',
  kullanici_uzerinden: 'Çalışan Üzerinden',
  dogrudan_musteri: 'Doğrudan Müşteri',
  chatbot: 'Chatbot',
  online_randevu: 'Online Randevu',
  diger: 'Diğer',
}

export interface RevenueSummary {
  totalRevenue: number
  taxAmount: number
  commissionAmount: number
  totalExpenses: number
  netProfit: number
  unpaidExpensesCount: number
}

export interface SegmentSummary {
  totalCustomers: number
  yeni: number
  sadik: number
}

export interface AppointmentSummary {
  total: number
  noShowRate: number
  cancelRate: number
  sourceCounts: Record<string, number>
}

export interface AdsSummary {
  connected: boolean
  adAccountName?: string | null
  spend30d?: number | null
  roas30d?: number | null
  clicks30d?: number | null
  impressions30d?: number | null
}

export interface InsightsInput {
  businessName?: string | null
  periodLabel: string
  revenue: RevenueSummary
  segments: SegmentSummary
  appointments: AppointmentSummary
  ads: AdsSummary
}

export interface InsightsResult {
  summary: string
  highlights: string[]
  risks: string[]
  recommendations: string[]
}

function toolSchema() {
  return [
    {
      type: 'function' as const,
      function: {
        name: TOOL_NAME,
        description: 'İşletme analizi sonucunu yapılandırılmış şekilde bildir.',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: '2-3 kısa cümlelik yorum paragrafı, Türkçe. Sayısal detay (tutar/oran) tekrarlama, o veriler zaten grafiklerle gösteriliyor.',
            },
            highlights: {
              type: 'array',
              items: { type: 'string' },
              description: 'En fazla 3 madde. Öne çıkan olumlu noktalar, her biri tek kısa cümle, rakam tekrarı yok.',
            },
            risks: {
              type: 'array',
              items: { type: 'string' },
              description: 'En fazla 3 madde. Dikkat edilmesi gereken riskler/sorunlar, her biri tek kısa cümle, rakam tekrarı yok.',
            },
            recommendations: {
              type: 'array',
              items: { type: 'string' },
              description: 'En fazla 3 madde. Somut, uygulanabilir öneriler, her biri tek kısa cümle.',
            },
          },
          required: ['summary', 'highlights', 'risks', 'recommendations'],
        },
      },
    },
  ]
}

const currency = (n: number) => `${n.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL`

export function buildInsightsPrompt(input: InsightsInput): { system: string; user: string } {
  const { revenue, segments, appointments, ads, periodLabel } = input

  const sourceLines = Object.entries(appointments.sourceCounts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `  - ${SOURCE_LABEL[key] ?? key}: ${count}`)
    .join('\n')

  const adsBlock = ads.connected
    ? `Reklam hesabı bağlı (${ads.adAccountName ?? 'isimsiz hesap'}). Son 30 gün: harcama ${
        ads.spend30d != null ? currency(ads.spend30d) : 'bilinmiyor'
      }, ROAS ${ads.roas30d != null ? ads.roas30d.toFixed(2) : 'hesaplanamadı'}, tıklama ${
        ads.clicks30d ?? 'bilinmiyor'
      }, gösterim ${ads.impressions30d ?? 'bilinmiyor'}.`
    : 'Bu işletme henüz reklam hesabı bağlamadı — reklam performansı hakkında yorum yapma, bu veri yok.'

  const system = `Sen bir kuaför/güzellik salonu işletmesinin verilerini analiz eden, Türkçe konuşan bir iş danışmanısın. Sana verilen SADECE toplu (aggregate) sayısal verilere dayanarak kısa, somut, uygulanabilir bir değerlendirme yaz.

ÇALIŞAN VERİSİ KURALI (kesinlikle uyulacak):
Sana çalışan bazlı hiçbir veri (isim, kişisel performans, kıyaslama) VERİLMEDİ ve verilmeyecek. Cevabında ASLA "en başarılı çalışan", "en çok kazanan personel" gibi bir çalışanı diğerine üstün gösteren, sıralayan veya kıyaslayan hiçbir ifade KULLANMA — böyle bir yorum yapman istenmiyor, tamamen yasak. Sadece işletme genelinde (çalışanlardan bağımsız) değerlendirme yap.

Diğer kurallar:
- Sadece sana verilen sayılara dayan, uydurma veya varsayımda bulunma.
- Müşteri isim/telefon gibi kişisel bilgi hiç verilmedi, zaten böyle bir veri kullanma.
- Türkçe, kısa ve öz cümleler kullan; her madde (highlights/risks/recommendations) tek bir cümle olsun, en fazla 3'er madde.
- ÖNEMLİ: Ciro, gider, net kâr, müşteri segment sayıları (Yeni/Sadık) ve randevu gelmedi/iptal oranları kullanıcıya ZATEN GRAFİK OLARAK gösteriliyor — bu ham sayıları veya yüzdeleri metninde TEKRARLAMA. Bunun yerine bu sayıların ne anlama geldiğine, işletme için ne ifade ettiğine dair YORUM ve İÇGÖRÜ yaz.`

  const user = `İşletme verileri (${periodLabel}):

MUHASEBE:
- Toplam ciro (tahsilat bazlı): ${currency(revenue.totalRevenue)}
- Vergi kesintisi: ${currency(revenue.taxAmount)}
- Prim/komisyon kesintisi: ${currency(revenue.commissionAmount)}
- Ödenmiş giderler: ${currency(revenue.totalExpenses)}
- Net kâr: ${currency(revenue.netProfit)}
- Ödenmemiş/vadesi gelen gider sayısı: ${revenue.unpaidExpensesCount}

MÜŞTERİ SEGMENTLERİ (toplam ${segments.totalCustomers} müşteri):
- Bu ay yeni müşteri: ${segments.yeni}
- Sadık müşteri: ${segments.sadik}

RANDEVULAR (toplam ${appointments.total}):
- Gelmedi oranı: %${appointments.noShowRate.toFixed(1)}
- İptal oranı: %${appointments.cancelRate.toFixed(1)}
- Kaynak dağılımı:
${sourceLines || '  (veri yok)'}

REKLAM:
${adsBlock}

Bu verilere dayanarak submit_business_analysis fonksiyonunu çağırarak bir özet, öne çıkanlar, riskler ve öneriler listesi üret.`

  return { system, user }
}

export async function generateBusinessInsights(
  apiKey: string,
  input: InsightsInput,
): Promise<{ ok: true; result: InsightsResult; model: string } | { ok: false; error: string; status: number }> {
  const { system, user } = buildInsightsPrompt(input)

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      tool_choice: { type: 'function', function: { name: TOOL_NAME } },
      tools: toolSchema(),
    }),
  })

  if (!openaiRes.ok) {
    const errText = await openaiRes.text()
    console.error('OpenAI API hatası:', openaiRes.status, errText)
    return { ok: false, error: 'Analiz oluşturulamadı, lütfen tekrar deneyin', status: 502 }
  }

  const openaiBody = await openaiRes.json()
  const choice = openaiBody?.choices?.[0]
  if (choice?.finish_reason === 'content_filter') {
    return { ok: false, error: 'Bu veriler işlenemedi, lütfen tekrar deneyin', status: 422 }
  }

  const toolCall = choice?.message?.tool_calls?.[0] as { function?: { arguments?: string } } | undefined
  let raw: Record<string, unknown> | null = null
  if (toolCall?.function?.arguments) {
    try {
      raw = JSON.parse(toolCall.function.arguments)
    } catch {
      raw = null
    }
  }
  if (!raw) return { ok: false, error: 'Analiz oluşturulamadı, lütfen tekrar deneyin', status: 502 }

  const asStringArray = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

  return {
    ok: true,
    model: MODEL,
    result: {
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      highlights: asStringArray(raw.highlights),
      risks: asStringArray(raw.risks),
      recommendations: asStringArray(raw.recommendations),
    },
  }
}
