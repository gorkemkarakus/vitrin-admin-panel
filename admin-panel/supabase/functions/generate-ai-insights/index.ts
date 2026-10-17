import { corsHeaders, json } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/requireAdmin.ts'
import { generateBusinessInsights } from '../_shared/aiInsights.ts'
import { consumeDailyQuota } from '../_shared/limits.ts'

const COOLDOWN_MS = 10 * 60 * 1000 // 10 dakika — yanlışlıkla çift tıklamaya karşı, yeni tablo gerekmiyor
const WINDOW_DAYS = 30
const LOYAL_APPT_THRESHOLD = 3

interface Appointment {
  id: string
  customer_id: string | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  scheduled_at: string
  source: string | null
}
interface Payment {
  customer_id: string
  amount: number
  paid_at: string
  voided_at: string | null
}
interface Customer {
  id: string
  created_at: string
}
interface Expense {
  amount: number
  expense_date: string
  is_paid: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const { businessId, admin } = auth

  // Frontend'deki tarih aralığı seçiciden (AiInsightsPage.tsx) opsiyonel
  // rangeStart/rangeEnd/periodLabel/periodKey gelebilir — gelmezse eski sabit
  // "son 30 gün"/"bu_ay" davranışına düşer (geriye dönük uyumlu).
  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const customStart = typeof body.rangeStart === 'string' ? body.rangeStart : null
  const customEnd = typeof body.rangeEnd === 'string' ? body.rangeEnd : null
  const periodLabel = typeof body.periodLabel === 'string' && body.periodLabel ? body.periodLabel : 'son 30 gün'
  const periodKey = typeof body.periodKey === 'string' && body.periodKey ? body.periodKey : 'bu_ay'

  // Cooldown artik DONEM BAZLI — "Bu Ay" icin az once analiz alinmasi "Son
  // Yil"in cooldown'unu ETKILEMEZ, her donem kendi generated_at'ini tasir.
  const { data: existing } = await admin
    .from('business_ai_insights')
    .select('generated_at')
    .eq('business_id', businessId)
    .eq('period_key', periodKey)
    .maybeSingle()

  if (existing && Date.now() - new Date(existing.generated_at).getTime() < COOLDOWN_MS) {
    return json({ error: 'Az önce bu dönem için bir analiz oluşturuldu, lütfen birkaç dakika sonra tekrar deneyin.' }, 429)
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    console.error('generate-ai-insights: OPENAI_API_KEY eksik')
    return json({ error: 'Sunucu yapılandırması eksik' }, 500)
  }

  const quotaBlocked = await consumeDailyQuota(admin, businessId, 'ai_insights')
  if (quotaBlocked) return quotaBlocked

  const now = new Date()
  const windowStart = customStart ? new Date(`${customStart}T00:00:00Z`) : new Date(now.getTime() - WINDOW_DAYS * 86400000)
  const windowEnd = customEnd ? new Date(`${customEnd}T23:59:59Z`) : now
  const windowStartStr = windowStart.toISOString().slice(0, 10)
  const windowEndStr = windowEnd.toISOString().slice(0, 10)

  const [
    { data: businessRow },
    { data: appointments },
    { data: payments },
    { data: customers },
    { data: expenses },
    { data: financeSettings },
    { data: adConnection },
  ] = await Promise.all([
    admin.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    admin.from('appointments').select('id, customer_id, status, scheduled_at, source').eq('business_id', businessId),
    admin.from('payments').select('customer_id, amount, paid_at, voided_at').eq('business_id', businessId),
    admin.from('customers').select('id, created_at').eq('business_id', businessId),
    admin.from('business_expenses').select('amount, expense_date, is_paid').eq('business_id', businessId),
    admin.from('business_finance_settings').select('commission_pct, tax_pct').eq('business_id', businessId).maybeSingle(),
    admin
      .from('business_ad_connections')
      .select('status, ad_account_name')
      .eq('business_id', businessId)
      .maybeSingle(),
  ])

  const apptList = (appointments ?? []) as Appointment[]
  const paymentList = ((payments ?? []) as Payment[]).filter((p) => !p.voided_at)
  const customerList = (customers ?? []) as Customer[]
  const expenseList = (expenses ?? []) as Expense[]

  // ---- Muhasebe: AccountingPage.tsx'teki AYNI sıra (vergi -> vergi-sonrası
  // üzerinden prim -> ödenmiş giderler) ----
  const revenueInWindow = paymentList
    .filter((p) => p.paid_at >= windowStartStr && p.paid_at <= windowEndStr)
    .reduce((sum, p) => sum + p.amount, 0)
  const taxPct = financeSettings?.tax_pct ?? 0
  const commissionPct = financeSettings?.commission_pct ?? 0
  const taxAmount = revenueInWindow * (taxPct / 100)
  const afterTax = revenueInWindow - taxAmount
  const commissionAmount = afterTax * (commissionPct / 100)
  const afterCommission = afterTax - commissionAmount
  const totalExpenses = expenseList
    .filter((e) => e.is_paid && e.expense_date >= windowStartStr && e.expense_date <= windowEndStr)
    .reduce((sum, e) => sum + e.amount, 0)
  const netProfit = afterCommission - totalExpenses
  const unpaidExpensesCount = expenseList.filter((e) => !e.is_paid).length

  // ---- CRM segmentleri: CustomersPage.tsx'teki AYNI formüller ----
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const paymentsByCustomer = new Map<string, Payment[]>()
  for (const p of paymentList) {
    const list = paymentsByCustomer.get(p.customer_id) ?? []
    list.push(p)
    paymentsByCustomer.set(p.customer_id, list)
  }
  const apptsByCustomer = new Map<string, Appointment[]>()
  for (const a of apptList) {
    if (!a.customer_id) continue
    const list = apptsByCustomer.get(a.customer_id) ?? []
    list.push(a)
    apptsByCustomer.set(a.customer_id, list)
  }

  interface CustStats {
    totalSpend: number
    completedCount: number
    isNewThisMonth: boolean
  }
  const statsByCustomer = new Map<string, CustStats>()
  for (const c of customerList) {
    const appts = apptsByCustomer.get(c.id) ?? []
    const completed = appts.filter((a) => a.status === 'tamamlandi')
    const totalSpend = (paymentsByCustomer.get(c.id) ?? []).reduce((sum, p) => sum + p.amount, 0)
    const isNewThisMonth = new Date(c.created_at) >= monthStart
    statsByCustomer.set(c.id, { totalSpend, completedCount: completed.length, isNewThisMonth })
  }

  let yeniCount = 0
  let sadikCount = 0
  for (const s of statsByCustomer.values()) {
    if (s.isNewThisMonth) yeniCount++
    else if (s.completedCount >= LOYAL_APPT_THRESHOLD) sadikCount++
  }

  // ---- Randevu istatistikleri: seçili pencere ----
  const apptsInWindow = apptList.filter(
    (a) => a.scheduled_at >= windowStart.toISOString() && a.scheduled_at <= windowEnd.toISOString(),
  )
  const noShowCount = apptsInWindow.filter((a) => a.status === 'gelmedi').length
  const cancelCount = apptsInWindow.filter((a) => a.status === 'iptal').length
  const sourceCounts: Record<string, number> = {}
  for (const a of apptsInWindow) {
    const key = a.source ?? 'diger'
    sourceCounts[key] = (sourceCounts[key] ?? 0) + 1
  }

  // ---- Meta Ads: sadece bağlıysa, önbellekten (ad_insight_snapshots) ----
  let adsSummary = { connected: false } as {
    connected: boolean
    adAccountName?: string | null
    spend30d?: number | null
    roas30d?: number | null
    clicks30d?: number | null
    impressions30d?: number | null
  }
  if (adConnection?.status === 'connected') {
    const { data: snapshot } = await admin
      .from('ad_insight_snapshots')
      .select('spend, roas, clicks, impressions')
      .eq('business_id', businessId)
      .eq('range_days', 30)
      .maybeSingle()
    adsSummary = {
      connected: true,
      adAccountName: adConnection.ad_account_name,
      spend30d: snapshot?.spend ?? null,
      roas30d: snapshot?.roas ?? null,
      clicks30d: snapshot?.clicks ?? null,
      impressions30d: snapshot?.impressions ?? null,
    }
  }

  const insightsInput = {
    businessName: businessRow?.name ?? null,
    periodLabel,
    revenue: {
      totalRevenue: revenueInWindow,
      taxAmount,
      commissionAmount,
      totalExpenses,
      netProfit,
      unpaidExpensesCount,
    },
    segments: {
      totalCustomers: customerList.length,
      yeni: yeniCount,
      sadik: sadikCount,
    },
    appointments: {
      total: apptsInWindow.length,
      noShowRate: apptsInWindow.length ? (noShowCount / apptsInWindow.length) * 100 : 0,
      cancelRate: apptsInWindow.length ? (cancelCount / apptsInWindow.length) * 100 : 0,
      sourceCounts,
    },
    ads: adsSummary,
  }

  const result = await generateBusinessInsights(apiKey, insightsInput)
  if (!result.ok) return json({ error: result.error }, result.status)

  const generatedAt = new Date().toISOString()
  const { data: saved, error: saveErr } = await admin
    .from('business_ai_insights')
    .upsert(
      {
        business_id: businessId,
        period_key: periodKey,
        generated_at: generatedAt,
        summary: result.result.summary,
        highlights: result.result.highlights,
        risks: result.result.risks,
        recommendations: result.result.recommendations,
        model: result.model,
        // Frontend'deki grafikler (ciro/gider/net kar cubugu, segment donut'u,
        // gelmedi/iptal orani) icin — insightsInput'un TAMAMI degil, sadece
        // grafiklenecek dar alt kume (ads/tax/commission/sourceCounts haric).
        metrics: {
          revenue: {
            totalRevenue: insightsInput.revenue.totalRevenue,
            totalExpenses: insightsInput.revenue.totalExpenses,
            netProfit: insightsInput.revenue.netProfit,
          },
          segments: {
            totalCustomers: insightsInput.segments.totalCustomers,
            yeni: insightsInput.segments.yeni,
            sadik: insightsInput.segments.sadik,
          },
          appointments: {
            total: insightsInput.appointments.total,
            noShowRate: insightsInput.appointments.noShowRate,
            cancelRate: insightsInput.appointments.cancelRate,
          },
        },
      },
      { onConflict: 'business_id,period_key' },
    )
    .select()
    .maybeSingle()

  if (saveErr) {
    console.error('generate-ai-insights: kayıt hatası:', saveErr.message)
    return json({ error: 'Analiz oluşturuldu ama kaydedilemedi' }, 500)
  }

  return json({ data: saved }, 200)
})
