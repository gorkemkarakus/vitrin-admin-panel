import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import Avatar from '../components/Avatar'
import PdfProgressModal from '../components/PdfProgressModal'
import {
  CalendarIcon,
  UsersIcon,
  WalletIcon,
  SearchIcon,
  RobotIcon,
  ReceiptIcon,
} from '../components/icons'
import { generatePerformanceReportPdf } from '../lib/pdf/performanceReportPdf'
import { currencyWhole as currency } from '../lib/currency'
import { toLocalDateString, presetDateRange } from '../lib/date'
import styles from './PerformanceReportPage.module.css'
import { FIELD_LIMITS } from '../lib/fieldLimits'

interface Profile {
  id: string
  full_name: string | null
}

interface Appointment {
  id: string
  employee_id: string | null
  customer_id: string | null
  service_id: string | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  scheduled_at: string
  duration_minutes: number | null
  price_override: number | null
  source: string
}

interface Service {
  id: string
  name: string
  price: number | null
}

interface Schedule {
  profile_id: string
  day_of_week: number
  starts_at: string
  ends_at: string
}

interface TimeBlock {
  profile_id: string
  day_of_week: number | null
  block_date: string | null
  end_date: string | null
  starts_at: string
  ends_at: string
}

interface Payment {
  amount: number
  paid_at: string
  appointment_id: string | null
}

interface EmployeeServiceRow {
  profile_id: string
  service_id: string
}

type Preset = 'bugun' | 'bu_hafta' | 'bu_ay' | 'ozel'
const presetRange = presetDateRange

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'bugun', label: 'Bugün' },
  { value: 'bu_hafta', label: 'Bu Hafta' },
  { value: 'bu_ay', label: 'Bu Ay' },
]

function timeStringToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function datesInRange(startStr: string, endStr: string): string[] {
  const out: string[] = []
  let cur = new Date(`${startStr}T00:00:00`)
  const end = new Date(`${endStr}T00:00:00`)
  while (cur <= end) {
    out.push(toLocalDateString(cur))
    cur = new Date(cur.getTime() + 86400000)
  }
  return out
}

function leaveDaysInRange(profileId: string, blocks: TimeBlock[], startStr: string, endStr: string): Set<string> {
  const days = new Set<string>()
  for (const b of blocks) {
    if (b.profile_id !== profileId) continue
    if (b.block_date !== null) {
      const blockEnd = b.end_date ?? b.block_date
      const s = b.block_date > startStr ? b.block_date : startStr
      const e = blockEnd < endStr ? blockEnd : endStr
      if (s > e) continue
      for (const d of datesInRange(s, e)) days.add(d)
    } else if (b.day_of_week !== null) {
      for (const d of datesInRange(startStr, endStr)) {
        if (new Date(`${d}T00:00:00`).getDay() === b.day_of_week) days.add(d)
      }
    }
  }
  return days
}

function scheduledMinutesInRange(profileId: string, schedules: Schedule[], blocks: TimeBlock[], startStr: string, endStr: string) {
  let total = 0
  const mySchedules = schedules.filter((s) => s.profile_id === profileId)
  const myBlocks = blocks.filter((b) => b.profile_id === profileId)
  for (const d of datesInRange(startStr, endStr)) {
    const dow = new Date(`${d}T00:00:00`).getDay()
    const daySchedules = mySchedules.filter((s) => s.day_of_week === dow)
    for (const s of daySchedules) {
      let minutes = timeStringToMinutes(s.ends_at.slice(0, 5)) - timeStringToMinutes(s.starts_at.slice(0, 5))
      for (const b of myBlocks) {
        const blockAppliesToday =
          b.day_of_week === dow || (b.block_date !== null && b.block_date <= d && d <= (b.end_date ?? b.block_date))
        if (!blockAppliesToday) continue
        const bs = Math.max(timeStringToMinutes(s.starts_at.slice(0, 5)), timeStringToMinutes(b.starts_at.slice(0, 5)))
        const be = Math.min(timeStringToMinutes(s.ends_at.slice(0, 5)), timeStringToMinutes(b.ends_at.slice(0, 5)))
        if (be > bs) minutes -= be - bs
      }
      total += Math.max(0, minutes)
    }
  }
  return total
}

export default function PerformanceReportPage() {
  const { profile } = useAuth()
  const [preset, setPreset] = useState<Preset>('bugun')
  const [customStart, setCustomStart] = useState(() => presetRange('bugun').start)
  const [customEnd, setCustomEnd] = useState(() => presetRange('bugun').end)
  const [showCustomRange, setShowCustomRange] = useState(false)
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [employeeServices, setEmployeeServices] = useState<EmployeeServiceRow[]>([])
  const [commissionPct, setCommissionPct] = useState(0)
  const [search, setSearch] = useState('')
  const [pdfState, setPdfState] = useState<{ progress: number; step: string; error: string | null } | null>(null)

  const { start: rangeStart, end: rangeEnd } = showCustomRange ? { start: customStart, end: customEnd } : presetRange(preset)

  useEffect(() => {
    let cancelled = false
    async function loadData() {
      setLoading(true)
      const [
        { data: profs },
        { data: appts },
        { data: svcs },
        { data: scheds },
        { data: blocks },
        { data: pays },
        { data: empSvcs },
        { data: settings },
      ] = await Promise.all([
        supabase.from('profiles').select('id, full_name').order('full_name'),
        fetchAll(() => supabase
          .from('appointments')
          .select('id, employee_id, customer_id, service_id, status, scheduled_at, duration_minutes, price_override, source')
          .gte('scheduled_at', `${rangeStart}T00:00:00`)
          .lte('scheduled_at', `${rangeEnd}T23:59:59`).order('id')),
        supabase.from('services').select('id, name, price'),
        supabase.from('employee_schedules').select('profile_id, day_of_week, starts_at, ends_at'),
        supabase.from('employee_time_blocks').select('profile_id, day_of_week, block_date, end_date, starts_at, ends_at'),
        fetchAll(() => supabase
          .from('payments')
          .select('amount, paid_at, appointment_id')
          .is('voided_at', null)
          .gte('paid_at', rangeStart)
          .lte('paid_at', rangeEnd).order('id')),
        supabase.from('employee_services').select('profile_id, service_id'),
        supabase.from('business_finance_settings').select('commission_pct').maybeSingle(),
      ])
      if (cancelled) return
      setProfiles(profs ?? [])
      setAppointments(appts ?? [])
      setServices(svcs ?? [])
      setSchedules(scheds ?? [])
      setTimeBlocks(blocks ?? [])
      setPayments(pays ?? [])
      setEmployeeServices(empSvcs ?? [])
      setCommissionPct(settings?.commission_pct ?? 0)
      setLoading(false)
    }
    loadData()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd])

  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  const appointmentById = useMemo(() => new Map(appointments.map((a) => [a.id, a])), [appointments])

  const employeeStats = useMemo(() => {
    const base = profiles.map((p) => {
      const empAppts = appointments.filter((a) => a.employee_id === p.id)
      const completed = empAppts.filter((a) => a.status === 'tamamlandi')
      const notCancelled = empAppts.filter((a) => a.status !== 'iptal')
      const tahsilat = payments
        .filter((pay) => pay.appointment_id && appointmentById.get(pay.appointment_id)?.employee_id === p.id)
        .reduce((sum, pay) => sum + pay.amount, 0)
      const uniqueCustomers = new Set(empAppts.map((a) => a.customer_id).filter(Boolean)).size
      const leaveDays = leaveDaysInRange(p.id, timeBlocks, rangeStart, rangeEnd)
      const scheduledMinutes = scheduledMinutesInRange(p.id, schedules, timeBlocks, rangeStart, rangeEnd)
      const bookedMinutes = notCancelled.reduce((sum, a) => sum + (a.duration_minutes ?? 30), 0)
      const utilization = scheduledMinutes > 0 ? Math.min(100, (bookedMinutes / scheduledMinutes) * 100) : 0
      const completionRate = empAppts.length > 0 ? (completed.length / empAppts.length) * 100 : 0

      const serviceCounts = new Map<string, number>()
      for (const a of completed) {
        if (!a.service_id) continue
        serviceCounts.set(a.service_id, (serviceCounts.get(a.service_id) ?? 0) + 1)
      }
      const topServiceId = Array.from(serviceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
      const sourceCounts = new Map<string, number>()
      for (const a of empAppts) {
        sourceCounts.set(a.source, (sourceCounts.get(a.source) ?? 0) + 1)
      }
      const myServiceNames = employeeServices
        .filter((es) => es.profile_id === p.id)
        .map((es) => serviceById.get(es.service_id)?.name)
        .filter((n): n is string => !!n)
      const serviceTag =
        myServiceNames.length > 0
          ? myServiceNames.slice(0, 2).join(' • ') + (myServiceNames.length > 2 ? ` +${myServiceNames.length - 2}` : '')
          : null

      return {
        profile: p,
        isBot: false as const,
        serviceTag,
        totalRandevu: empAppts.length,
        completedCount: completed.length,
        revenue: tahsilat,
        primOrani: commissionPct,
        primHakedis: tahsilat * (commissionPct / 100),
        uniqueCustomers,
        leaveDayCount: leaveDays.size,
        utilization,
        completionRate,
        topServiceName: topServiceId ? (serviceById.get(topServiceId)?.name ?? null) : null,
        sourceCounts,
      }
    })
    return base
  }, [
    profiles,
    appointments,
    payments,
    appointmentById,
    serviceById,
    employeeServices,
    commissionPct,
    timeBlocks,
    schedules,
    rangeStart,
    rangeEnd,
  ])

  const botStats = useMemo(() => {
    const botAppts = appointments.filter((a) => !a.employee_id)
    const completed = botAppts.filter((a) => a.status === 'tamamlandi')
    const tahsilat = payments
      .filter((pay) => pay.appointment_id && !appointmentById.get(pay.appointment_id)?.employee_id)
      .reduce((sum, pay) => sum + pay.amount, 0)
    return { totalRandevu: botAppts.length, completedCount: completed.length, tahsilat }
  }, [appointments, payments, appointmentById])

  const toplamCalisan = profiles.length
  const toplamRandevu = employeeStats.reduce((s, e) => s + e.completedCount, 0) + botStats.completedCount
  const toplamTahsilat = payments.reduce((s, p) => s + p.amount, 0)
  const toplamPrimHakedis = employeeStats.reduce((s, e) => s + e.primHakedis, 0)

  // Calisanlar birbiriyle kiyaslanmiyor/siralanmiyor — liste her zaman
  // isme gore (alfabetik) gosterilir, secilebilir bir "puana gore sirala"
  // seceneği yok.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    const filtered = q ? employeeStats.filter((e) => (e.profile.full_name ?? '').toLocaleLowerCase('tr-TR').includes(q)) : employeeStats
    return filtered.slice().sort((a, b) => (a.profile.full_name ?? '').localeCompare(b.profile.full_name ?? '', 'tr-TR'))
  }, [employeeStats, search])

  const showBotRow =
    botStats.completedCount > 0 &&
    (!search.trim() || 'randevu al chatbot'.includes(search.trim().toLocaleLowerCase('tr-TR')))

  async function handleExportPdf() {
    if (!profile?.business_id) return
    setPdfState({ progress: 0, step: 'Başlatılıyor…', error: null })
    try {
      await generatePerformanceReportPdf({
        businessId: profile.business_id,
        rangeStart,
        rangeEnd,
        kpis: {
          totalRandevu: toplamRandevu,
          kazandirilanTutar: toplamTahsilat,
          izinGunleri: employeeStats.reduce((s, e) => s + e.leaveDayCount, 0),
          toplamCalisan,
        },
        employeeStats,
        currentAppts: appointments,
        serviceById,
        onProgress: (progress, step) => setPdfState({ progress, step, error: null }),
      })
      setPdfState(null)
    } catch (err) {
      setPdfState({ progress: 0, step: '', error: err instanceof Error ? err.message : 'Bilinmeyen bir hata oluştu.' })
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.presetRow}>
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={!showCustomRange && preset === p.value ? styles.presetBtnActive : styles.presetBtn}
            onClick={() => {
              setShowCustomRange(false)
              setPreset(p.value)
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={showCustomRange ? styles.presetBtnActive : styles.presetBtn}
          onClick={() => setShowCustomRange(true)}
        >
          <CalendarIcon width={14} height={14} />
          Tarih Aralığı
        </button>
      </div>

      {showCustomRange && (
        <div className={`card ${styles.customRangeRow}`}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="perfRangeStart">Başlangıç</label>
            <input
              id="perfRangeStart"
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="perfRangeEnd">Bitiş</label>
            <input
              id="perfRangeEnd"
              type="date"
              value={customEnd}
              min={customStart}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Yükleniyor…</p>
      ) : (
        <>
          <div className={styles.kpiGrid}>
            <div className={styles.kpiCard}>
              <span className={styles.kpiIcon} style={{ background: '#dbeafe', color: '#2563eb' }}>
                <UsersIcon width={17} height={17} />
              </span>
              <span className={styles.kpiValue}>{toplamCalisan.toLocaleString('tr-TR')}</span>
              <span className={styles.kpiLabel}>Toplam Çalışan</span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiIcon} style={{ background: '#dbeafe', color: '#2563eb' }}>
                <CalendarIcon width={17} height={17} />
              </span>
              <span className={styles.kpiValue}>{toplamRandevu.toLocaleString('tr-TR')}</span>
              <span className={styles.kpiLabel}>Toplam Randevu</span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiIcon} style={{ background: '#d1fae5', color: '#0e9668' }}>
                <WalletIcon width={17} height={17} />
              </span>
              <span className={styles.kpiValue}>{currency.format(toplamTahsilat)}</span>
              <span className={styles.kpiLabel}>Toplam Tahsilat</span>
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiIcon} style={{ background: '#fef3c7', color: '#c9971c' }}>
                <WalletIcon width={17} height={17} />
              </span>
              <span className={styles.kpiValue}>{currency.format(toplamPrimHakedis)}</span>
              <span className={styles.kpiLabel}>Toplam Prim Hakediş</span>
            </div>
          </div>

          <button type="button" className={`btn-secondary ${styles.exportBtn}`} onClick={handleExportPdf}>
            <ReceiptIcon width={15} height={15} />
            Detaylı Özet (PDF)
          </button>

          <div className={styles.controlRow}>
            <div className={styles.searchBox}>
              <SearchIcon width={15} height={15} className={styles.searchIcon} />
              <input maxLength={FIELD_LIMITS.search}
                className={styles.searchInput}
                placeholder="Çalışan ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.sectionHead}>
            <h2 className={styles.sectionLabel}>Çalışanlar</h2>
            <span className={styles.sectionCount}>{toplamCalisan} çalışan</span>
          </div>

          <div className={styles.employeeList}>
            {visibleRows.length === 0 && !showBotRow && <p className={styles.empty}>Sonuç bulunamadı.</p>}
            {visibleRows.map((e) => (
              <div key={e.profile.id} className={`card ${styles.employeeRow}`}>
                <Avatar name={e.profile.full_name ?? '—'} size={44} />
                <div className={styles.employeeMain}>
                  <span className={styles.employeeNameRow}>
                    <span className={styles.employeeName}>{e.profile.full_name ?? '—'}</span>
                    {e.serviceTag && <span className={styles.employeeTag}>{e.serviceTag}</span>}
                  </span>
                  <div className={styles.employeeStatsRow}>
                    <span className={styles.employeeStat}>
                      <CalendarIcon width={12} height={12} />
                      {e.completedCount} Randevu
                    </span>
                    <span className={styles.employeeStat}>{currency.format(e.revenue)} Tahsilat</span>
                  </div>
                </div>
                <div className={styles.primBox}>
                  <span className={styles.primRate}>%{e.primOrani} Prim Oranı</span>
                  <span className={styles.primAmount}>
                    <WalletIcon width={13} height={13} />
                    {currency.format(e.primHakedis)}
                  </span>
                  <span className={styles.primAmountLabel}>Prim Hakediş</span>
                </div>
              </div>
            ))}

            {showBotRow && (
              <div className={styles.employeeRow + ' card'}>
                <span className={styles.botAvatar}>
                  <RobotIcon width={20} height={20} />
                </span>
                <div className={styles.employeeMain}>
                  <span className={styles.employeeNameRow}>
                    <span className={styles.employeeName}>Randevu Al</span>
                    <span className={styles.employeeTag}>Chatbot</span>
                  </span>
                  <div className={styles.employeeStatsRow}>
                    <span className={styles.employeeStat}>
                      <CalendarIcon width={12} height={12} />
                      {botStats.completedCount} Randevu
                    </span>
                    <span className={styles.employeeStat}>{currency.format(botStats.tahsilat)} Tahsilat</span>
                  </div>
                </div>
                <div className={styles.primBox}>
                  <span className={styles.primRate}>%0 Prim Oranı</span>
                  <span className={styles.primAmount}>
                    <WalletIcon width={13} height={13} />
                    {currency.format(0)}
                  </span>
                  <span className={styles.primAmountLabel}>Prim Hakediş</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

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
