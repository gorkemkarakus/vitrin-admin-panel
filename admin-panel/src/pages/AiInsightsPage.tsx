import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  SparkleIcon,
  TrendingUpIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  WalletIcon,
  PieChartIcon,
  UsersIcon,
} from '../components/icons'
import DonutChart from '../components/DonutChart'
import LineChart from '../components/LineChart'
import { currencyWhole as currency } from '../lib/currency'
import { toLocalDateString, firstOfMonth } from '../lib/date'
import { segmentForStats } from '../lib/customerSegments'
import styles from './AiInsightsPage.module.css'

interface Insight {
  generated_at: string
  summary: string
  highlights: string[]
  risks: string[]
  recommendations: string[]
}

interface Appointment {
  id: string
  customer_id: string | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  scheduled_at: string
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

// generate-ai-insights edge function'ındaki COOLDOWN_MS ile AYNI — bir
// dönemin analizi bu kadar taze ise otomatik yeniden üretmeyi atlıyoruz
// (sunucu zaten 429 dönecekti, gereksiz istek/hata göstermemek için).
const COOLDOWN_MS = 10 * 60 * 1000

// ---------- Tarih aralığı ----------

type Preset = 'bu_ay' | 'son_3_ay' | 'son_yil' | 'tum_zamanlar' | 'ozel'

function presetRange(preset: Preset): { start: string; end: string } {
  const today = new Date()
  switch (preset) {
    case 'son_3_ay': {
      const start = new Date(today)
      start.setMonth(start.getMonth() - 3)
      return { start: toLocalDateString(start), end: toLocalDateString(today) }
    }
    case 'son_yil': {
      const start = new Date(today)
      start.setFullYear(start.getFullYear() - 1)
      return { start: toLocalDateString(start), end: toLocalDateString(today) }
    }
    case 'tum_zamanlar':
      return { start: toLocalDateString(new Date(2000, 0, 1)), end: toLocalDateString(today) }
    case 'bu_ay':
    default:
      return { start: toLocalDateString(firstOfMonth(today)), end: toLocalDateString(today) }
  }
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'bu_ay', label: 'Bu Ay' },
  { value: 'son_3_ay', label: 'Son 3 Ay' },
  { value: 'son_yil', label: 'Son Yıl' },
  { value: 'tum_zamanlar', label: 'Tüm Zamanlar' },
]

function daysBetween(start: string, end: string) {
  return Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1
}

function inRange(dateStr: string, start: string, end: string) {
  const d = dateStr.slice(0, 10)
  return d >= start && d <= end
}

function prevPeriodBounds(start: string, end: string): { start: string; end: string } {
  const s = new Date(`${start}T00:00:00`)
  const lengthMs = new Date(`${end}T00:00:00`).getTime() - s.getTime()
  const prevEnd = new Date(s.getTime() - 86400000)
  const prevStart = new Date(prevEnd.getTime() - lengthMs)
  return { start: toLocalDateString(prevStart), end: toLocalDateString(prevEnd) }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

export default function AiInsightsPage() {
  const { session } = useAuth()
  const [insight, setInsight] = useState<Insight | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [preset, setPreset] = useState<Preset>('bu_ay')
  const [rangeStart, setRangeStart] = useState(() => presetRange('bu_ay').start)
  const [rangeEnd, setRangeEnd] = useState(() => presetRange('bu_ay').end)

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [taxPct, setTaxPct] = useState(0)
  const [commissionPct, setCommissionPct] = useState(0)
  const [dataLoading, setDataLoading] = useState(true)

  function applyPreset(p: Preset) {
    setPreset(p)
    const { start, end } = presetRange(p)
    setRangeStart(start)
    setRangeEnd(end)
  }

  async function loadInsightForPeriod(periodKey: string): Promise<Insight | null> {
    const { data } = await supabase
      .from('business_ai_insights')
      .select('generated_at, summary, highlights, risks, recommendations')
      .eq('period_key', periodKey)
      .maybeSingle()
    return data
  }

  // Grafik/KPI verisi AI analizinden BAĞIMSIZ, ücretsiz ve canlı — tarih
  // aralığı değiştikçe yeniden hesaplanır ama OpenAI çağrısı YAPMAZ. Tüm-zaman
  // veri tek seferde çekilip pencereleme client-side yapılıyor (AccountingPage
  // ile aynı desen).
  useEffect(() => {
    async function loadLiveData() {
      setDataLoading(true)
      const [{ data: appts }, { data: pays }, { data: custs }, { data: exps }, { data: settings }] = await Promise.all([
        supabase.from('appointments').select('id, customer_id, status, scheduled_at'),
        supabase.from('payments').select('customer_id, amount, paid_at, voided_at'),
        supabase.from('customers').select('id, created_at'),
        supabase.from('business_expenses').select('amount, expense_date, is_paid'),
        supabase.from('business_finance_settings').select('commission_pct, tax_pct').maybeSingle(),
      ])
      setAppointments(appts ?? [])
      setPayments(pays ?? [])
      setCustomers(custs ?? [])
      setExpenses(exps ?? [])
      setTaxPct(settings?.tax_pct ?? 0)
      setCommissionPct(settings?.commission_pct ?? 0)
      setDataLoading(false)
    }
    loadLiveData()
  }, [])

  async function handleGenerate() {
    if (!session || generating) return
    setGenerating(true)
    setError(null)
    try {
      const periodLabel = PRESETS.find((p) => p.value === preset)?.label ?? 'Bu Dönem'
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-ai-insights`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rangeStart, rangeEnd, periodLabel, periodKey: preset }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Analiz oluşturulamadı.')
        return
      }
      setInsight(body.data)
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setGenerating(false)
    }
  }

  // Dönem değiştiğinde (preset tıklanınca) o dönemin kendi önbelleklenmiş
  // analizini yükler. Cooldown artık DÖNEM BAZLI olduğu için (bkz. edge
  // function), o dönemin analizi 10dk'dan eskiyse (veya hiç yoksa) otomatik
  // yeniden üretir — tazeyse sessizce önbellekten gösterir, gereksiz 429
  // hatası çıkmaz. İLK sayfa yüklemesinde otomatik ÜRETMEZ, sadece var olanı
  // gösterir — kullanıcı ilk analizi elle "Analiz Oluştur"la başlatmalı.
  const isFirstPeriodLoad = useRef(true)
  useEffect(() => {
    let cancelled = false
    async function run() {
      const data = await loadInsightForPeriod(preset)
      if (cancelled) return
      setInsight(data)
      const wasFirst = isFirstPeriodLoad.current
      isFirstPeriodLoad.current = false
      if (wasFirst) {
        setLoading(false)
        return
      }
      const isFresh = data && Date.now() - new Date(data.generated_at).getTime() < COOLDOWN_MS
      if (!isFresh) handleGenerate()
    }
    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  // ---------- Canlı KPI/grafik hesaplamaları ----------

  const hasPrev = preset !== 'tum_zamanlar'
  const prev = useMemo(() => (hasPrev ? prevPeriodBounds(rangeStart, rangeEnd) : null), [hasPrev, rangeStart, rangeEnd])

  function periodTotals(start: string, end: string) {
    const rev = payments.filter((p) => !p.voided_at && inRange(p.paid_at, start, end)).reduce((s, p) => s + p.amount, 0)
    const exp = expenses.filter((e) => e.is_paid && inRange(e.expense_date, start, end)).reduce((s, e) => s + e.amount, 0)
    const afterTax = rev * (1 - taxPct / 100)
    const afterCommission = afterTax * (1 - commissionPct / 100)
    const netProfit = afterCommission - exp
    const newCustomers = customers.filter((c) => inRange(c.created_at, start, end)).length
    return { revenue: rev, expenses: exp, netProfit, newCustomers }
  }

  const current = useMemo(
    () => periodTotals(rangeStart, rangeEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeStart, rangeEnd, payments, expenses, customers, taxPct, commissionPct],
  )
  const previous = useMemo(
    () => (prev ? periodTotals(prev.start, prev.end) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prev, payments, expenses, customers, taxPct, commissionPct],
  )

  const profitMarginPct = current.revenue > 0 ? (current.netProfit / current.revenue) * 100 : 0
  const prevProfitMarginPct = previous && previous.revenue > 0 ? (previous.netProfit / previous.revenue) * 100 : 0
  const totalCustomers = customers.filter((c) => c.created_at.slice(0, 10) <= rangeEnd).length
  const prevTotalCustomers = prev ? customers.filter((c) => c.created_at.slice(0, 10) <= prev.end).length : 0

  function pctDelta(curr: number, prevVal: number): number | null {
    if (!previous) return null
    if (prevVal === 0) return curr > 0 ? 100 : 0
    return ((curr - prevVal) / Math.abs(prevVal)) * 100
  }

  const apptsInRange = useMemo(
    () => appointments.filter((a) => inRange(a.scheduled_at, rangeStart, rangeEnd)),
    [appointments, rangeStart, rangeEnd],
  )
  const cancelRate = apptsInRange.length
    ? (apptsInRange.filter((a) => a.status === 'iptal').length / apptsInRange.length) * 100
    : 0
  const noShowRate = apptsInRange.length
    ? (apptsInRange.filter((a) => a.status === 'gelmedi').length / apptsInRange.length) * 100
    : 0

  // ---------- Müşteri segmentleri (tarih aralığından bağımsız, her zaman güncel) ----------

  const now = useMemo(() => new Date(), [])
  const currentMonthStart = useMemo(() => firstOfMonth(now), [now])

  const segmentCounts = useMemo(() => {
    const paymentsByCustomer = new Map<string, Payment[]>()
    for (const p of payments) {
      const list = paymentsByCustomer.get(p.customer_id) ?? []
      list.push(p)
      paymentsByCustomer.set(p.customer_id, list)
    }
    const apptsByCustomer = new Map<string, Appointment[]>()
    for (const a of appointments) {
      if (!a.customer_id) continue
      const list = apptsByCustomer.get(a.customer_id) ?? []
      list.push(a)
      apptsByCustomer.set(a.customer_id, list)
    }
    interface Stats {
      totalSpend: number
      completedCount: number
      isNewThisMonth: boolean
    }
    const statsByCustomer = new Map<string, Stats>()
    for (const c of customers) {
      const appts = apptsByCustomer.get(c.id) ?? []
      const completed = appts.filter((a) => a.status === 'tamamlandi')
      const totalSpend = (paymentsByCustomer.get(c.id) ?? [])
        .filter((p) => !p.voided_at)
        .reduce((sum, p) => sum + p.amount, 0)
      const isNewThisMonth = new Date(c.created_at) >= currentMonthStart
      statsByCustomer.set(c.id, { totalSpend, completedCount: completed.length, isNewThisMonth })
    }

    let yeni = 0,
      sadik = 0
    for (const s of statsByCustomer.values()) {
      const seg = segmentForStats(s)
      if (seg === 'yeni') yeni++
      else if (seg === 'sadik') sadik++
    }
    return { yeni, sadik, total: customers.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, appointments, payments, currentMonthStart])

  // ---------- Tahsilat/Net Kâr trend grafiği ----------

  const chart = useMemo(() => {
    const spanDays = daysBetween(rangeStart, rangeEnd)
    const useMonthly = spanDays > 31
    const bucketKeys: string[] = []
    if (useMonthly) {
      const cur = new Date(`${rangeStart}T00:00:00`)
      cur.setDate(1)
      const endD = new Date(`${rangeEnd}T00:00:00`)
      while (cur <= endD) {
        bucketKeys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
        cur.setMonth(cur.getMonth() + 1)
      }
    } else {
      const cur = new Date(`${rangeStart}T00:00:00`)
      const endD = new Date(`${rangeEnd}T00:00:00`)
      while (cur <= endD) {
        bucketKeys.push(toLocalDateString(cur))
        cur.setDate(cur.getDate() + 1)
      }
    }

    const revenueByBucket = new Map<string, number>()
    const expenseByBucket = new Map<string, number>()
    for (const p of payments) {
      if (p.voided_at || !inRange(p.paid_at, rangeStart, rangeEnd)) continue
      const d = p.paid_at.slice(0, 10)
      const key = useMonthly ? d.slice(0, 7) : d
      revenueByBucket.set(key, (revenueByBucket.get(key) ?? 0) + p.amount)
    }
    for (const e of expenses) {
      if (!e.is_paid || !inRange(e.expense_date, rangeStart, rangeEnd)) continue
      const d = e.expense_date.slice(0, 10)
      const key = useMonthly ? d.slice(0, 7) : d
      expenseByBucket.set(key, (expenseByBucket.get(key) ?? 0) + e.amount)
    }

    const revenueSeries = bucketKeys.map((k) => revenueByBucket.get(k) ?? 0)
    const netProfitSeries = bucketKeys.map((k, i) => {
      const afterTaxB = revenueSeries[i] * (1 - taxPct / 100)
      const afterCommissionB = afterTaxB * (1 - commissionPct / 100)
      return afterCommissionB - (expenseByBucket.get(k) ?? 0)
    })

    const labelStep = Math.max(1, Math.ceil(bucketKeys.length / 12))
    const xLabels = bucketKeys.map((k, i) => {
      if (i % labelStep !== 0 && i !== bucketKeys.length - 1) return ''
      if (useMonthly) return new Date(`${k}-01T00:00:00`).toLocaleDateString('tr-TR', { month: 'short' })
      return String(new Date(`${k}T00:00:00`).getDate())
    })

    return { revenueSeries, netProfitSeries, xLabels }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd, payments, expenses, taxPct, commissionPct])

  // ---------- Sağlık skoru ----------
  // Kârlılık (%40) + operasyonel güvenilirlik (%35, düşük iptal/gelmedi = yüksek puan)
  // + büyüme (%25, önceki döneme göre yeni müşteri değişimi) — 0-100'e ağırlıklı ortalama.
  const profitScore = clamp(profitMarginPct * 2, 0, 100)
  const reliabilityScore = clamp(100 - (cancelRate + noShowRate) * 2, 0, 100)
  const growthDeltaPct = previous
    ? previous.newCustomers > 0
      ? ((current.newCustomers - previous.newCustomers) / previous.newCustomers) * 100
      : current.newCustomers > 0
        ? 100
        : 0
    : 0
  const growthScore = clamp(50 + growthDeltaPct, 0, 100)
  const healthScore = Math.round(0.4 * profitScore + 0.35 * reliabilityScore + 0.25 * growthScore)
  const healthLabel = healthScore >= 70 ? 'İyi' : healthScore >= 40 ? 'Orta' : 'Geliştirilmeli'
  // Turuncu marka rengi mavi gradyanla catisiyordu (neredeyse tamamlayici
  // renkler yuksek doygunlukta yan yana "titresim" yaratir) — halka rengi
  // artik durum anlamina gore (ok/warn/danger), "Genel Durum" etiketiyle
  // de gorsel olarak tutarli.
  const gaugeColor = healthScore >= 70 ? 'var(--ok-text)' : healthScore >= 40 ? 'var(--warn-text)' : 'var(--danger-text)'

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  const kpis = [
    {
      icon: WalletIcon,
      label: 'Tahsilat',
      value: currency.format(current.revenue),
      delta: pctDelta(current.revenue, previous?.revenue ?? 0),
    },
    {
      icon: TrendingUpIcon,
      label: 'Net Kâr',
      value: currency.format(current.netProfit),
      delta: pctDelta(current.netProfit, previous?.netProfit ?? 0),
    },
    {
      icon: PieChartIcon,
      label: 'Kâr Marjı',
      value: `%${profitMarginPct.toFixed(1)}`,
      delta: pctDelta(profitMarginPct, prevProfitMarginPct),
    },
    {
      icon: UsersIcon,
      label: 'Toplam Müşteri',
      value: `${totalCustomers}`,
      delta: pctDelta(totalCustomers, prevTotalCustomers),
    },
  ]

  return (
    <div className={styles.wrap}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>AI İş Analizi</h1>
          <p className={styles.pageSub}>İşletmenizin güncel durumu</p>
        </div>
        <div className={styles.filterRow}>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={preset === p.value ? styles.filterBtnActive : styles.filterBtn}
              onClick={() => applyPreset(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.heroCard}>
        <div className={styles.heroText}>
          <span className={styles.heroEyebrow}>
            <SparkleIcon width={14} height={14} />
            {insight ? `Son analiz: ${new Date(insight.generated_at).toLocaleString('tr-TR')}` : 'Henüz analiz oluşturulmadı'}
          </span>
          <div className={styles.heroStatus}>Genel Durum: {healthLabel}</div>
          {insight ? (
            <p className={styles.heroSummary}>{insight.summary}</p>
          ) : (
            <p className={styles.heroSummary}>
              Aşağıdaki KPI'lar ve grafikler canlı verinizden hesaplanıyor. Yapay zekadan yazılı bir değerlendirme almak için
              analiz oluşturun.
            </p>
          )}
          <button type="button" className={styles.heroBtn} onClick={handleGenerate} disabled={generating}>
            {generating ? 'Oluşturuluyor…' : insight ? 'Yenile' : 'Analiz Oluştur'}
          </button>
          {error && <p className={styles.heroError}>{error}</p>}
        </div>
        <div className={styles.heroGauge}>
          <DonutChart
            segments={[
              { value: healthScore, color: gaugeColor },
              { value: 100 - healthScore, color: 'var(--line)' },
            ]}
            size={108}
            strokeWidth={11}
            centerLabel={`${healthScore}`}
            centerSubLabel="/100"
          />
        </div>
      </div>

      {dataLoading ? (
        <p className={styles.hint}>Grafikler yükleniyor…</p>
      ) : (
        <>
          <div className={styles.kpiRow}>
            {kpis.map((k) => {
              const Icon = k.icon
              return (
                <div className={styles.kpiTile} key={k.label}>
                  <span className={styles.kpiIcon}>
                    <Icon width={16} height={16} />
                  </span>
                  <span className={styles.kpiValue}>{k.value}</span>
                  <span className={styles.kpiLabel}>{k.label}</span>
                  {k.delta !== null && (
                    <span className={k.delta >= 0 ? styles.kpiDeltaUp : styles.kpiDeltaDown}>
                      {k.delta >= 0 ? '↑' : '↓'} %{Math.abs(k.delta).toFixed(1)} vs önceki dönem
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <div className={styles.chartsRow}>
            <div className="card">
              <h2 style={{ marginBottom: 14 }}>Tahsilat ve Net Kâr Trendi</h2>
              <div className={styles.donutLegend} style={{ flexDirection: 'row', gap: 16, marginBottom: 10 }}>
                <div className={styles.legendRow} style={{ fontSize: 12 }}>
                  <span className={styles.legendDot} style={{ background: 'var(--signal)' }} />
                  <span>Tahsilat</span>
                </div>
                <div className={styles.legendRow} style={{ fontSize: 12 }}>
                  <span className={styles.legendDot} style={{ background: 'var(--ok-text)' }} />
                  <span>Net Kâr</span>
                </div>
              </div>
              <LineChart
                series={[
                  { label: 'Tahsilat', color: 'var(--signal)', points: chart.revenueSeries },
                  { label: 'Net Kâr', color: 'var(--ok-text)', points: chart.netProfitSeries },
                ]}
                xLabels={chart.xLabels}
              />
            </div>

            <div className="card">
              <h2 style={{ marginBottom: 14 }}>Müşteri Segmentleri</h2>
              {segmentCounts.total === 0 ? (
                <p className={styles.hint}>Henüz müşteri yok.</p>
              ) : (
                <div className={styles.donutRow}>
                  <DonutChart
                    segments={[
                      { value: segmentCounts.yeni, color: 'var(--warn-text)' },
                      { value: segmentCounts.sadik, color: 'var(--ok-text)' },
                    ]}
                    centerLabel={`${segmentCounts.total}`}
                    centerSubLabel="Müşteri"
                  />
                  <div className={styles.donutLegend}>
                    <div className={styles.legendRow}>
                      <span className={styles.legendDot} style={{ background: 'var(--warn-text)' }} />
                      <span>Yeni</span>
                      <strong>{segmentCounts.yeni}</strong>
                    </div>
                    <div className={styles.legendRow}>
                      <span className={styles.legendDot} style={{ background: 'var(--ok-text)' }} />
                      <span>Sadık</span>
                      <strong>{segmentCounts.sadik}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {generating && <p className={styles.hint}>Analiz oluşturuluyor, bu işlem 30 saniyeye kadar sürebilir…</p>}

      {insight && (
        <>
          {insight.highlights.length > 0 && (
            <div className="card">
              <h2 style={{ marginBottom: 14 }}>Öne Çıkanlar</h2>
              <ul className={styles.list}>
                {insight.highlights.map((item, i) => (
                  <li key={i} className={styles.listItem}>
                    <span className={`${styles.listIcon} ${styles.listIconInfo}`}>
                      <TrendingUpIcon width={13} height={13} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {insight.risks.length > 0 && (
            <div className={`card ${styles.riskCard}`}>
              <h2 style={{ marginBottom: 14 }}>Riskler</h2>
              <ul className={styles.list}>
                {insight.risks.map((item, i) => (
                  <li key={i} className={styles.listItem}>
                    <span className={`${styles.listIcon} ${styles.listIconDanger}`}>
                      <AlertTriangleIcon width={13} height={13} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {insight.recommendations.length > 0 && (
            <div className={`card ${styles.recCard}`}>
              <h2 style={{ marginBottom: 14 }}>Öneriler</h2>
              <ul className={styles.list}>
                {insight.recommendations.map((item, i) => (
                  <li key={i} className={styles.listItem}>
                    <span className={`${styles.listIcon} ${styles.listIconOk}`}>
                      <CheckCircleIcon width={13} height={13} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
