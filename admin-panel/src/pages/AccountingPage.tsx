import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PdfProgressModal from '../components/PdfProgressModal'
import {
  WalletIcon,
  CheckCircleIcon,
  ReceiptIcon,
  TrendingUpIcon,
  AlertTriangleIcon,
  ChevronRightIcon,
} from '../components/icons'
import { generateAccountingReportPdf } from '../lib/pdf/accountingReportPdf'
import { currency } from '../lib/currency'
import { toLocalDateString, presetDateRange, type DateRangePreset } from '../lib/date'
import styles from './AccountingPage.module.css'

interface Appointment {
  id: string
  service_id: string | null
  employee_id: string | null
  scheduled_at: string
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
}

interface Service {
  id: string
  name: string
  price: number | null
}

interface Profile {
  id: string
  full_name: string | null
}

interface Expense {
  id: string
  description: string
  amount: number
  expense_date: string
  due_date: string | null
  is_recurring: boolean
  is_paid: boolean
}

interface ServicePackage {
  id: string
  service_id: string | null
}

interface Payment {
  id: string
  amount: number
  appointment_id: string | null
  package_id: string | null
}

type Preset = DateRangePreset
const presetRange = presetDateRange

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'bugun', label: 'Bugün' },
  { value: 'bu_hafta', label: 'Bu Hafta' },
  { value: 'bu_ay', label: 'Bu Ay' },
  { value: 'gecen_ay', label: 'Geçen Ay' },
]

export default function AccountingPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [preset, setPreset] = useState<Preset>('bu_ay')
  const [rangeStart, setRangeStart] = useState(() => presetRange('bu_ay').start)
  const [rangeEnd, setRangeEnd] = useState(() => presetRange('bu_ay').end)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [packages, setPackages] = useState<ServicePackage[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [commissionPct, setCommissionPct] = useState(0)
  const [taxPct, setTaxPct] = useState(0)
  const [rateInput, setRateInput] = useState('0')
  const [taxInput, setTaxInput] = useState('0')
  const [loading, setLoading] = useState(true)
  const [savedHint, setSavedHint] = useState(false)
  const [pdfState, setPdfState] = useState<{ progress: number; step: string; error: string | null } | null>(null)

  function applyPreset(p: Preset) {
    setPreset(p)
    const { start, end } = presetRange(p)
    setRangeStart(start)
    setRangeEnd(end)
  }

  async function loadAll() {
    setLoading(true)
    const [{ data: appts }, { data: svcs }, { data: profs }, { data: settings }, { data: exps }, { data: pkgs }, { data: pays }] =
      await Promise.all([
        supabase.from('appointments').select('id, service_id, employee_id, scheduled_at, status'),
        supabase.from('services').select('id, name, price'),
        supabase.from('profiles').select('id, full_name'),
        supabase.from('business_finance_settings').select('commission_pct, tax_pct').maybeSingle(),
        supabase
          .from('business_expenses')
          .select('id, description, amount, expense_date, due_date, is_recurring, is_paid')
          .gte('expense_date', rangeStart)
          .lte('expense_date', rangeEnd)
          .order('expense_date', { ascending: false }),
        supabase.from('service_packages').select('id, service_id'),
        supabase
          .from('payments')
          .select('id, amount, appointment_id, package_id')
          .is('voided_at', null)
          .gte('paid_at', rangeStart)
          .lte('paid_at', rangeEnd),
      ])
    setAppointments(appts ?? [])
    setServices(svcs ?? [])
    setProfiles(profs ?? [])
    setExpenses(exps ?? [])
    setPackages(pkgs ?? [])
    setPayments(pays ?? [])
    const cPct = settings?.commission_pct ?? 0
    const tPct = settings?.tax_pct ?? 0
    setCommissionPct(cPct)
    setTaxPct(tPct)
    setRateInput(String(cPct))
    setTaxInput(String(tPct))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd])

  async function saveSettings() {
    if (!profile?.business_id) return
    const cPct = Math.min(100, Math.max(0, Number(rateInput) || 0))
    const tPct = Math.min(100, Math.max(0, Number(taxInput) || 0))
    await supabase
      .from('business_finance_settings')
      .upsert({ business_id: profile.business_id, commission_pct: cPct, tax_pct: tPct })
    setCommissionPct(cPct)
    setTaxPct(tPct)
    setSavedHint(true)
    setTimeout(() => setSavedHint(false), 2000)
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  const profileNameById = new Map(profiles.map((p) => [p.id, p.full_name ?? 'Bilinmeyen']))
  const serviceNameById = new Map(services.map((s) => [s.id, s.name]))
  const appointmentById = new Map(appointments.map((a) => [a.id, a]))
  const packageServiceById = new Map(packages.map((p) => [p.id, p.service_id]))
  const todayStr = toLocalDateString(new Date())

  const rangeStartDate = new Date(`${rangeStart}T00:00:00`)
  const rangeEndDate = new Date(`${rangeEnd}T23:59:59.999`)

  const rangedCompleted = appointments.filter((a) => {
    if (a.status !== 'tamamlandi') return false
    const d = new Date(a.scheduled_at)
    return d >= rangeStartDate && d <= rangeEndDate
  })

  const employeeStatsMap = new Map<string, { id: string; name: string; count: number; revenue: number }>()
  for (const a of rangedCompleted) {
    if (!a.employee_id) continue
    const entry = employeeStatsMap.get(a.employee_id) ?? {
      id: a.employee_id,
      name: profileNameById.get(a.employee_id) ?? 'Bilinmeyen',
      count: 0,
      revenue: 0,
    }
    entry.count += 1
    employeeStatsMap.set(a.employee_id, entry)
  }
  for (const p of payments) {
    const employeeId = p.appointment_id ? appointmentById.get(p.appointment_id)?.employee_id : null
    if (!employeeId) continue
    const entry = employeeStatsMap.get(employeeId) ?? {
      id: employeeId,
      name: profileNameById.get(employeeId) ?? 'Bilinmeyen',
      count: 0,
      revenue: 0,
    }
    entry.revenue += p.amount
    employeeStatsMap.set(employeeId, entry)
  }
  const allEmployeeStats = Array.from(employeeStatsMap.values()).sort((a, b) => b.revenue - a.revenue)

  const serviceStatsMap = new Map<string, { id: string; name: string; count: number; revenue: number }>()
  for (const a of rangedCompleted) {
    if (!a.service_id) continue
    const entry = serviceStatsMap.get(a.service_id) ?? {
      id: a.service_id,
      name: serviceNameById.get(a.service_id) ?? 'Silinmiş hizmet',
      count: 0,
      revenue: 0,
    }
    entry.count += 1
    serviceStatsMap.set(a.service_id, entry)
  }
  for (const p of payments) {
    const serviceId = p.appointment_id
      ? appointmentById.get(p.appointment_id)?.service_id
      : p.package_id
        ? packageServiceById.get(p.package_id)
        : null
    if (!serviceId) continue
    const entry = serviceStatsMap.get(serviceId) ?? {
      id: serviceId,
      name: serviceNameById.get(serviceId) ?? 'Silinmiş hizmet',
      count: 0,
      revenue: 0,
    }
    entry.revenue += p.amount
    serviceStatsMap.set(serviceId, entry)
  }
  const serviceStats = Array.from(serviceStatsMap.values()).sort((a, b) => b.revenue - a.revenue)

  const periodLabel =
    preset === 'ozel'
      ? `${new Date(rangeStart + 'T00:00:00').toLocaleDateString('tr-TR')} – ${new Date(rangeEnd + 'T00:00:00').toLocaleDateString('tr-TR')}`
      : (PRESETS.find((p) => p.value === preset)?.label ?? 'Bu Dönem')

  const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0)
  const taxAmount = totalRevenue * (taxPct / 100)
  const afterTax = totalRevenue - taxAmount
  const commissionAmount = afterTax * (commissionPct / 100)
  const afterCommission = afterTax - commissionAmount
  const paidExpenses = expenses.filter((e) => e.is_paid)
  const unpaidExpenses = expenses.filter((e) => !e.is_paid)
  const overdueExpenses = unpaidExpenses.filter((e) => e.due_date && e.due_date < todayStr)
  const totalExpenses = paidExpenses.reduce((sum, e) => sum + e.amount, 0)
  const netProfit = afterCommission - totalExpenses

  async function handleExportPdf() {
    if (!profile?.business_id) return
    setPdfState({ progress: 0, step: 'Başlatılıyor…', error: null })
    try {
      await generateAccountingReportPdf({
        businessId: profile.business_id,
        rangeStart,
        rangeEnd,
        kpis: { totalRevenue, completedCount: rangedCompleted.length, totalExpenses, netProfit },
        waterfall: { totalRevenue, taxPct, taxAmount, afterTax, commissionPct, commissionAmount, afterCommission, totalExpenses, netProfit },
        employeeStats: allEmployeeStats,
        serviceStats,
        expenses,
        appointmentById,
        packageServiceById,
        profileNameById,
        serviceNameById,
        onProgress: (progress, step) => setPdfState({ progress, step, error: null }),
      })
      setPdfState(null)
    } catch (err) {
      setPdfState({ progress: 0, step: '', error: err instanceof Error ? err.message : 'Bilinmeyen bir hata oluştu.' })
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.stickyFilter}>
        <h2 className={styles.sectionLabel}>Tarih Aralığı</h2>
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

        <div className={`card ${styles.customRangeRow}`}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rangeStart">Başlangıç</label>
            <input
              id="rangeStart"
              type="date"
              value={rangeStart}
              max={rangeEnd}
              onChange={(e) => {
                setPreset('ozel')
                setRangeStart(e.target.value)
              }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rangeEnd">Bitiş</label>
            <input
              id="rangeEnd"
              type="date"
              value={rangeEnd}
              min={rangeStart}
              onChange={(e) => {
                setPreset('ozel')
                setRangeEnd(e.target.value)
              }}
            />
          </div>
        </div>
      </div>

      <button type="button" className={`btn-secondary ${styles.exportBtn}`} onClick={handleExportPdf}>
        <ReceiptIcon width={15} height={15} />
        Detaylı Özet (PDF)
      </button>

      <h2 className={styles.sectionLabel}>Dönem Özeti</h2>
      <div className={styles.statsGrid}>
        <div className={`${styles.statCard} ${styles.statCardSignal}`}>
          <span className={`${styles.statIcon} ${styles.statIconSignal}`}>
            <WalletIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{currency.format(totalRevenue)}</span>
          <span className={styles.statLabel}>Toplam Ciro</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCardInfo}`}>
          <span className={`${styles.statIcon} ${styles.statIconInfo}`}>
            <CheckCircleIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{rangedCompleted.length}</span>
          <span className={styles.statLabel}>Tamamlanan Randevu</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCardDanger}`}>
          <span className={`${styles.statIcon} ${styles.statIconDanger}`}>
            <ReceiptIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{currency.format(totalExpenses)}</span>
          <span className={styles.statLabel}>Toplam Gider</span>
        </div>
        <div className={`${styles.statCard} ${netProfit >= 0 ? styles.statCardOk : styles.statCardDanger}`}>
          <span className={`${styles.statIcon} ${netProfit >= 0 ? styles.statIconOk : styles.statIconDanger}`}>
            <TrendingUpIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{currency.format(netProfit)}</span>
          <span className={styles.statLabel}>Net Kâr</span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 14 }}>{periodLabel} Nasıl Hesaplandı</h2>
        <div className={styles.waterfall}>
          <div className={styles.waterfallRow}>
            <span>Toplam ciro</span>
            <span>{currency.format(totalRevenue)}</span>
          </div>
          <div className={styles.waterfallRow}>
            <span>− Vergi (%{taxPct})</span>
            <span className={styles.waterfallMinus}>−{currency.format(taxAmount)}</span>
          </div>
          <div className={`${styles.waterfallRow} ${styles.waterfallSubtotal}`}>
            <span>Vergi sonrası kalan</span>
            <span>{currency.format(afterTax)}</span>
          </div>
          <div className={styles.waterfallRow}>
            <span>− Çalışan primi (%{commissionPct})</span>
            <span className={styles.waterfallMinus}>−{currency.format(commissionAmount)}</span>
          </div>
          <div className={`${styles.waterfallRow} ${styles.waterfallSubtotal}`}>
            <span>Prim sonrası kalan</span>
            <span>{currency.format(afterCommission)}</span>
          </div>
          <div className={styles.waterfallRow}>
            <span>− Salon giderleri</span>
            <span className={styles.waterfallMinus}>−{currency.format(totalExpenses)}</span>
          </div>
          <div className={`${styles.waterfallRow} ${styles.waterfallNet} ${netProfit < 0 ? styles.waterfallNetDanger : ''}`}>
            <span>Net kâr</span>
            <span>{currency.format(netProfit)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 14 }}>Vergi &amp; Prim Ayarları</h2>
        <div className={styles.rateRow}>
          <div className={styles.rateField}>
            <label htmlFor="taxRate">Vergi oranı (%)</label>
            <input
              id="taxRate"
              type="number"
              min={0}
              max={100}
              step={1}
              value={taxInput}
              onChange={(e) => setTaxInput(e.target.value)}
            />
          </div>
          <div className={styles.rateField}>
            <label htmlFor="commissionRate">Genel prim oranı (%)</label>
            <input
              id="commissionRate"
              type="number"
              min={0}
              max={100}
              step={1}
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
            />
          </div>
          <button type="button" className={`btn-primary ${styles.saveBtn}`} onClick={saveSettings}>
            Kaydet
          </button>
          {savedHint && <span className={styles.savedHint}>Kaydedildi ✓</span>}
        </div>
      </div>

      <div className="card">
        <div className={styles.giderlerHead}>
          <h2 style={{ marginBottom: 0 }}>Giderler</h2>
          <button
            type="button"
            className={styles.sectionLink}
            onClick={() => navigate(`/giderler?start=${rangeStart}&end=${rangeEnd}`)}
          >
            Detaylara Bak <ChevronRightIcon width={14} height={14} />
          </button>
        </div>
        <div className={styles.giderMiniGrid}>
          <div className={styles.statCard}>
            <span className={`${styles.statIcon} ${styles.statIconSignal}`}>
              <ReceiptIcon width={14} height={14} />
            </span>
            <span className={styles.statValue}>{expenses.length}</span>
            <span className={styles.statLabel}>Toplam Kayıt</span>
          </div>
          <div className={`${styles.statCard} ${styles.statCardOk}`}>
            <span className={`${styles.statIcon} ${styles.statIconOk}`}>
              <CheckCircleIcon width={14} height={14} />
            </span>
            <span className={styles.statValue}>{currency.format(paidExpenses.reduce((sum, e) => sum + e.amount, 0))}</span>
            <span className={styles.statLabel}>{paidExpenses.length} Ödenmiş</span>
          </div>
          <div className={`${styles.statCard} ${styles.statCardDanger}`}>
            <span className={`${styles.statIcon} ${styles.statIconDanger}`}>
              <AlertTriangleIcon width={14} height={14} />
            </span>
            <span className={styles.statValue}>{currency.format(unpaidExpenses.reduce((sum, e) => sum + e.amount, 0))}</span>
            <span className={styles.statLabel}>{unpaidExpenses.length} Ödenmemiş</span>
          </div>
          <div className={`${styles.statCard} ${styles.statCardDanger}`}>
            <span className={`${styles.statIcon} ${styles.statIconDanger}`}>
              <AlertTriangleIcon width={14} height={14} />
            </span>
            <span className={styles.statValue}>{currency.format(overdueExpenses.reduce((sum, e) => sum + e.amount, 0))}</span>
            <span className={styles.statLabel}>{overdueExpenses.length} Vadesi Geçen</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 14 }}>İşlem Bazlı Ciro</h2>
        {serviceStats.length === 0 ? (
          <p className={styles.empty}>Bu aralıkta randevu veya ödeme kaydı yok.</p>
        ) : (
          <div className={styles.list}>
            {serviceStats.map((s, i) => (
              <div className={styles.employeeRow} key={s.id}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.employeeName}>{s.name}</span>
                <div className={styles.employeeStats}>
                  <div className={styles.employeeStatBlock}>
                    <span className={styles.employeeStatLabel}>Randevu</span>
                    <span className={styles.employeeStatValue}>{s.count}</span>
                  </div>
                  <div className={styles.employeeStatBlock}>
                    <span className={styles.employeeStatLabel}>Ciro</span>
                    <span className={styles.employeeStatValueSignal}>{currency.format(s.revenue)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pdfState && (
        <PdfProgressModal
          progress={pdfState.progress}
          step={pdfState.step}
          error={pdfState.error}
          onClose={() => setPdfState(null)}
        />
      )}
    </div>
  )
}
