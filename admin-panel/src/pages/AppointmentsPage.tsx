import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { TIME_OPTIONS } from '../lib/timeOptions'
import Avatar from '../components/Avatar'
import StatusDropdown, { type StatusDropdownOption } from '../components/StatusDropdown'
import Select from '../components/Select'
import type { LayoutOutletContext } from '../layouts/DashboardLayout'
import styles from './AppointmentsPage.module.css'

interface Customer {
  id: string
  full_name: string
  phone: string | null
}

interface Service {
  id: string
  name: string
  duration_minutes: number
  price: number | null
}

interface Profile {
  id: string
  full_name: string | null
}

interface EmployeeServiceRow {
  profile_id: string
  service_id: string
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
  starts_at: string
  ends_at: string
}

interface Appointment {
  id: string
  customer_id: string | null
  service_id: string | null
  employee_id: string | null
  created_by_user_id: string | null
  scheduled_at: string
  duration_minutes: number | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal'
  source: string
  source_note: string | null
}

const SOURCE_OPTIONS = [
  { value: 'kullanici_uzerinden', label: 'Çalışan Üzerinden' },
  { value: 'dogrudan_musteri', label: 'Doğrudan Müşteri' },
  { value: 'chatbot', label: 'Chatbot' },
  { value: 'online_randevu', label: 'Online Randevu' },
  { value: 'diger', label: 'Diğer' },
]

const STATUS_OPTIONS: { value: Appointment['status']; label: string }[] = [
  { value: 'bekliyor', label: 'Bekliyor' },
  { value: 'onaylandi', label: 'Onaylandı' },
  { value: 'tamamlandi', label: 'Tamamlandı' },
  { value: 'iptal', label: 'İptal' },
]

const STATUS_CLASS: Record<Appointment['status'], string> = {
  bekliyor: styles.statusBekliyor,
  onaylandi: styles.statusOnaylandi,
  tamamlandi: styles.statusTamamlandi,
  iptal: styles.statusIptal,
}

const STATUS_DROPDOWN_OPTIONS: StatusDropdownOption[] = [
  { value: 'bekliyor', label: 'Bekliyor', color: 'var(--warn-text)', bg: 'var(--warn-bg)' },
  { value: 'onaylandi', label: 'Onaylandı', color: 'var(--info-text)', bg: 'var(--info-bg)' },
  { value: 'tamamlandi', label: 'Tamamlandı', color: 'var(--ok-text)', bg: 'var(--ok-bg)' },
  { value: 'iptal', label: 'İptal', color: 'var(--danger-text)', bg: 'var(--danger-bg)' },
]

const SLOT_MINUTES = 30
const WEEKDAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']

type ViewMode = 'gunluk' | 'liste' | 'haftalik'

function todayLocalDateString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toLocalDateString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function timeStringToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export default function AppointmentsPage() {
  const { profile } = useAuth()
  const { searchQuery, setSearchPlaceholder } = useOutletContext<LayoutOutletContext>()
  const [searchParams, setSearchParams] = useSearchParams()

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [employeeServices, setEmployeeServices] = useState<EmployeeServiceRow[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('gunluk')
  const [viewDate, setViewDate] = useState(todayLocalDateString())
  const [now] = useState(new Date())

  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    setSearchPlaceholder('Müşteri veya randevu ara…')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let changed = false
    if (searchParams.get('yeni') === '1') {
      setShowForm(true)
      searchParams.delete('yeni')
      changed = true
    }
    const tarih = searchParams.get('tarih')
    if (tarih) {
      setViewDate(tarih)
      setViewMode('gunluk')
      searchParams.delete('tarih')
      changed = true
    }
    if (changed) setSearchParams(searchParams, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [useNewCustomer, setUseNewCustomer] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [apptDate, setApptDate] = useState(todayLocalDateString())
  const [apptTime, setApptTime] = useState('')
  const [source, setSource] = useState(SOURCE_OPTIONS[0].value)
  const [sourceNote, setSourceNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // "silent=true" bir mutasyondan sonra cagrilir — veriyi arka planda
  // tazeler ama "loading" bayragini geri true yapmaz, boylece sayfa her
  // islemden sonra bos "Yükleniyor…" yazisina donup yeniden cizilmiyor.
  async function loadData(silent = false) {
    if (!silent) setLoading(true)
    const [
      { data: appts },
      { data: custs },
      { data: svcs },
      { data: profs },
      { data: empSvcs },
      { data: scheds },
      { data: blocks },
    ] = await Promise.all([
      supabase
        .from('appointments')
        .select(
          'id, customer_id, service_id, employee_id, created_by_user_id, scheduled_at, duration_minutes, status, source, source_note',
        )
        .order('scheduled_at', { ascending: true }),
      supabase.from('customers').select('id, full_name, phone').order('full_name'),
      supabase
        .from('services')
        .select('id, name, duration_minutes, price')
        .eq('is_active', true)
        .order('name'),
      supabase.from('profiles').select('id, full_name'),
      supabase.from('employee_services').select('profile_id, service_id'),
      supabase.from('employee_schedules').select('profile_id, day_of_week, starts_at, ends_at'),
      supabase.from('employee_time_blocks').select('profile_id, day_of_week, block_date, starts_at, ends_at'),
    ])
    setAppointments(appts ?? [])
    setCustomers(custs ?? [])
    setServices(svcs ?? [])
    setProfiles(profs ?? [])
    setEmployeeServices(empSvcs ?? [])
    setSchedules(scheds ?? [])
    setTimeBlocks(blocks ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const customerName = (id: string | null) => customers.find((c) => c.id === id)?.full_name ?? '—'
  const customerPhone = (id: string | null) => customers.find((c) => c.id === id)?.phone ?? null
  const serviceName = (id: string | null) => services.find((s) => s.id === id)?.name ?? '—'
  const employeeName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name ?? '—'

  function canEdit(appt: Appointment) {
    return profile?.role === 'admin' || appt.created_by_user_id === profile?.id
  }

  const selectedService = services.find((s) => s.id === serviceId) ?? null

  // Bir hizmete hic kimse atanmamissa (bkz. Ekip sayfasi "Verebildigi
  // Hizmetler") o hizmete kimse randevu alamaz — kasitli, fallback yok.
  const eligibleEmployees = useMemo(() => {
    if (!selectedService) return profiles
    const ids = new Set(
      employeeServices.filter((es) => es.service_id === selectedService.id).map((es) => es.profile_id),
    )
    return profiles.filter((p) => ids.has(p.id))
  }, [selectedService, employeeServices, profiles])

  function isEmployeeAvailable(employeeId: string, start: Date, durationMinutes: number) {
    const dayOfWeek = start.getDay()
    const startMinutes = start.getHours() * 60 + start.getMinutes()
    const endMinutes = startMinutes + durationMinutes

    const worksThen = schedules.some(
      (s) =>
        s.profile_id === employeeId &&
        s.day_of_week === dayOfWeek &&
        timeStringToMinutes(s.starts_at.slice(0, 5)) <= startMinutes &&
        timeStringToMinutes(s.ends_at.slice(0, 5)) >= endMinutes,
    )
    if (!worksThen) return false

    const dateStr = toLocalDateString(start)
    const isBlocked = timeBlocks.some(
      (b) =>
        b.profile_id === employeeId &&
        (b.day_of_week === dayOfWeek || b.block_date === dateStr) &&
        timeStringToMinutes(b.starts_at.slice(0, 5)) < endMinutes &&
        timeStringToMinutes(b.ends_at.slice(0, 5)) > startMinutes,
    )
    if (isBlocked) return false

    const end = new Date(start.getTime() + durationMinutes * 60000)
    const hasConflict = appointments.some((a) => {
      if (a.employee_id !== employeeId || a.status === 'iptal') return false
      const aStart = new Date(a.scheduled_at)
      const aEnd = new Date(aStart.getTime() + (a.duration_minutes ?? SLOT_MINUTES) * 60000)
      return aStart < end && aEnd > start
    })
    return !hasConflict
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!serviceId || !apptDate || !apptTime) {
      setError('Hizmet ve tarih/saat zorunlu.')
      return
    }
    if (!useNewCustomer && !customerId) {
      setError('Bir müşteri seçin veya yeni müşteri ekleyin.')
      return
    }
    if (useNewCustomer && !newCustomerName.trim()) {
      setError('Yeni müşteri için ad soyad zorunlu.')
      return
    }

    const service = services.find((s) => s.id === serviceId)
    const start = new Date(`${apptDate}T${apptTime}`)
    const duration = service?.duration_minutes ?? SLOT_MINUTES

    let finalEmployeeId = employeeId
    if (employeeId) {
      if (!isEmployeeAvailable(employeeId, start, duration)) {
        setError('Seçilen çalışan bu saatte müsait değil (mesai dışı veya dolu).')
        return
      }
    } else {
      if (eligibleEmployees.length === 0) {
        setError('Bu hizmete atanmış çalışan yok. Önce Ekip sayfasından bir çalışana bu hizmeti atayın.')
        return
      }
      const candidates = eligibleEmployees.filter((p) => isEmployeeAvailable(p.id, start, duration))
      if (candidates.length === 0) {
        setError('Bu saatte bu hizmet için uygun çalışan yok. Başka bir saat deneyin.')
        return
      }
      finalEmployeeId = candidates[0].id
    }

    setSubmitting(true)
    try {
      let finalCustomerId = customerId

      if (useNewCustomer) {
        const { data: newCustomer, error: custErr } = await supabase
          .from('customers')
          .insert({
            business_id: profile?.business_id,
            full_name: newCustomerName.trim(),
            phone: newCustomerPhone.trim() || null,
          })
          .select('id')
          .single()
        if (custErr || !newCustomer) {
          setError('Müşteri oluşturulamadı: ' + (custErr?.message ?? ''))
          setSubmitting(false)
          return
        }
        finalCustomerId = newCustomer.id
      }

      const { error: apptErr } = await supabase.from('appointments').insert({
        business_id: profile?.business_id,
        customer_id: finalCustomerId,
        service_id: serviceId,
        employee_id: finalEmployeeId,
        created_by_user_id: profile?.id,
        scheduled_at: start.toISOString(),
        duration_minutes: duration,
        source,
        source_note: sourceNote.trim() || null,
      })

      if (apptErr) {
        const isOverlap = /exclusion|conflicting key|deadlock/i.test(apptErr.message)
        setError(
          isOverlap
            ? 'Seçilen çalışan bu saatte az önce başka bir randevuyla dolmuş. Lütfen farklı bir saat seçin.'
            : 'Randevu oluşturulamadı: ' + apptErr.message,
        )
        return
      }

      setSuccess(`Randevu oluşturuldu (${employeeName(finalEmployeeId)}).`)
      setCustomerId('')
      setNewCustomerName('')
      setNewCustomerPhone('')
      setUseNewCustomer(false)
      setServiceId('')
      setEmployeeId('')
      setApptTime('')
      setSourceNote('')
      await loadData(true)
      setShowForm(false)
    } finally {
      setSubmitting(false)
    }
  }

  async function updateStatus(appt: Appointment, status: Appointment['status']) {
    await supabase.from('appointments').update({ status }).eq('id', appt.id)
    await loadData(true)
  }

  function shiftDate(days: number) {
    const d = new Date(viewDate + 'T00:00:00')
    d.setDate(d.getDate() + days)
    setViewDate(toLocalDateString(d))
  }

  function shiftWeek(weeks: number) {
    const d = new Date(viewDate + 'T00:00:00')
    d.setDate(d.getDate() + weeks * 7)
    setViewDate(toLocalDateString(d))
  }

  const diffDays = Math.round(
    (new Date(viewDate + 'T00:00:00').getTime() - new Date(todayLocalDateString() + 'T00:00:00').getTime()) /
      86400000,
  )
  const viewWeekday = new Date(viewDate + 'T00:00:00').toLocaleDateString('tr-TR', { weekday: 'long' })
  let dayLabel: string
  if (diffDays === 0) dayLabel = 'Bugün'
  else if (diffDays === 1) dayLabel = 'Yarın'
  else if (diffDays === -1) dayLabel = 'Dün'
  else if (Math.abs(diffDays) <= 7)
    dayLabel = `${viewWeekday} · ${diffDays > 0 ? `${diffDays} gün sonra` : `${Math.abs(diffDays)} gün önce`}`
  else dayLabel = viewWeekday

  // Arama sorgusuna göre süzülmüş randevu listesi (müşteri/hizmet/çalışan adına göre).
  const q = searchQuery.trim().toLowerCase()
  const searchFiltered = q
    ? appointments.filter(
        (a) =>
          customerName(a.customer_id).toLowerCase().includes(q) ||
          serviceName(a.service_id).toLowerCase().includes(q) ||
          employeeName(a.employee_id).toLowerCase().includes(q),
      )
    : appointments

  // --- Görünüm moduna göre gösterilecek randevuları hesapla ---
  let visible: Appointment[] = []
  let groupedByDate: { dateKey: string; label: string; items: Appointment[] }[] = []

  if (viewMode === 'gunluk') {
    visible = searchFiltered.filter((a) => toLocalDateString(new Date(a.scheduled_at)) === viewDate)
  } else if (viewMode === 'liste') {
    const todayStr = todayLocalDateString()
    const windowEnd = new Date()
    windowEnd.setDate(windowEnd.getDate() + 30)
    const windowEndStr = toLocalDateString(windowEnd)
    visible = searchFiltered.filter((a) => {
      const dk = toLocalDateString(new Date(a.scheduled_at))
      return dk >= todayStr && dk <= windowEndStr
    })
    const byDate = new Map<string, Appointment[]>()
    for (const a of visible) {
      const dk = toLocalDateString(new Date(a.scheduled_at))
      const list = byDate.get(dk) ?? []
      list.push(a)
      byDate.set(dk, list)
    }
    groupedByDate = Array.from(byDate.keys())
      .sort()
      .map((dateKey) => ({
        dateKey,
        label: new Date(dateKey + 'T00:00:00').toLocaleDateString('tr-TR', {
          day: 'numeric',
          month: 'long',
          weekday: 'long',
        }),
        items: byDate.get(dateKey)!,
      }))
  } else {
    // haftalik: viewDate'in içinde bulunduğu Pazartesi-Pazar aralığı
    const anchor = new Date(viewDate + 'T00:00:00')
    const isoDay = (anchor.getDay() + 6) % 7
    const monday = new Date(anchor)
    monday.setDate(anchor.getDate() - isoDay)
    const days: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      days.push(toLocalDateString(d))
    }
    const byDate = new Map<string, Appointment[]>(days.map((d) => [d, []]))
    for (const a of searchFiltered) {
      const dk = toLocalDateString(new Date(a.scheduled_at))
      if (byDate.has(dk)) byDate.get(dk)!.push(a)
    }
    groupedByDate = days.map((dateKey) => ({
      dateKey,
      label: new Date(dateKey + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }),
      items: byDate.get(dateKey) ?? [],
    }))
  }

  function renderRow(a: Appointment) {
    const d = new Date(a.scheduled_at)
    const isPast = new Date(d.getTime() + (a.duration_minutes ?? SLOT_MINUTES) * 60000) < now
    // "bekliyor" durumunda kalıp saati geçmiş randevular unutulmuş olabilir —
    // bunları soluklaştırmak (diğer geçmiş randevularda yaptığımız gibi) tam
    // tersi etki yaratır, gözden daha da kaçarlar. Bu yüzden ayrı, dikkat
    // çeken bir durum olarak işaretliyoruz; zaten sonuçlanmış (onaylandı/
    // tamamlandı/iptal) geçmiş randevular soluklaşmaya devam eder.
    const isOverdue = isPast && a.status === 'bekliyor'
    const rowClass = [styles.apptRow, isOverdue ? styles.apptRowOverdue : isPast ? styles.apptRowPast : '']
      .filter(Boolean)
      .join(' ')
    return (
      <div className={rowClass} key={a.id}>
        <div className={styles.apptTime}>
          {d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className={styles.apptCustomer}>
          <Avatar name={customerName(a.customer_id)} size={32} />
          <div className={styles.apptCustomerText}>
            <span className={styles.apptCustomerName}>{customerName(a.customer_id)}</span>
            {customerPhone(a.customer_id) && (
              <span className={styles.apptCustomerPhone}>{customerPhone(a.customer_id)}</span>
            )}
          </div>
        </div>
        <div>
          <span className={styles.serviceTag}>{serviceName(a.service_id)}</span>
        </div>
        <div className={styles.apptEmployee}>{employeeName(a.employee_id)}</div>
        <div className={styles.statusCell}>
          {canEdit(a) ? (
            <StatusDropdown
              value={a.status}
              options={STATUS_DROPDOWN_OPTIONS}
              urgent={isOverdue}
              onChange={(v) => updateStatus(a, v as Appointment['status'])}
            />
          ) : (
            <span className={`${styles.statusBadge} ${STATUS_CLASS[a.status]}`}>
              {STATUS_OPTIONS.find((o) => o.value === a.status)?.label ?? a.status}
            </span>
          )}
          {isOverdue && <span className={styles.overdueHint}>Süresi geçti, güncelle</span>}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {(error || success) && (
        <div className={`${styles.banner} ${error ? styles.bannerError : styles.bannerSuccess}`}>
          <span>{error ?? success}</span>
          <button
            type="button"
            className={styles.bannerClose}
            onClick={() => {
              setError(null)
              setSuccess(null)
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className={styles.topRow}>
        <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => setShowForm(true)}>
          + Yeni Randevu
        </button>

        <div className={styles.viewToggle}>
          {(
            [
              { value: 'gunluk', label: 'Günlük' },
              { value: 'liste', label: 'Liste' },
              { value: 'haftalik', label: 'Haftalık' },
            ] as { value: ViewMode; label: string }[]
          ).map((v) => (
            <button
              key={v.value}
              type="button"
              className={viewMode === v.value ? styles.viewToggleBtnActive : styles.viewToggleBtn}
              onClick={() => setViewMode(v.value)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {showForm && (
        <div className={styles.modalBackdrop} onClick={() => setShowForm(false)}>
          <div className={`card ${styles.modalCard}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Yeni randevu</h2>
              <button type="button" className={styles.bannerClose} onClick={() => setShowForm(false)}>
                ✕
              </button>
            </div>

            <form className={styles.form} onSubmit={handleCreate}>
              {!useNewCustomer ? (
                <div className="field">
                  <label htmlFor="customer">Müşteri</label>
                  <Select
                    id="customer"
                    value={customerId}
                    onChange={setCustomerId}
                    options={customers.map((c) => ({ value: c.id, label: c.full_name, sub: c.phone ?? undefined }))}
                  />
                  <button type="button" className={styles.newCustomerToggle} onClick={() => setUseNewCustomer(true)}>
                    + Yeni müşteri ekle
                  </button>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="newCustomerName">Yeni müşteri</label>
                  <input
                    id="newCustomerName"
                    placeholder="Ad Soyad"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    style={{ marginBottom: 8 }}
                  />
                  <input
                    placeholder="Telefon (opsiyonel)"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                  />
                  <button type="button" className={styles.newCustomerToggle} onClick={() => setUseNewCustomer(false)}>
                    Mevcut müşteri seç
                  </button>
                </div>
              )}

              <div className="field">
                <label htmlFor="service">Hizmet</label>
                <Select
                  id="service"
                  value={serviceId}
                  onChange={(v) => {
                    setServiceId(v)
                    setEmployeeId('')
                  }}
                  options={services.map((s) => ({ value: s.id, label: s.name, sub: `${s.duration_minutes} dk` }))}
                />
              </div>

              <div className="field">
                <label htmlFor="employee">Çalışan</label>
                <Select
                  id="employee"
                  value={employeeId}
                  onChange={setEmployeeId}
                  options={[
                    { value: '', label: 'Farketmez' },
                    ...eligibleEmployees.map((p) => ({ value: p.id, label: p.full_name ?? '—' })),
                  ]}
                />
              </div>

              <div className="field">
                <label htmlFor="apptDate">Tarih</label>
                <input id="apptDate" type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
              </div>

              <div className="field">
                <label htmlFor="apptTime">Saat</label>
                <Select
                  id="apptTime"
                  value={apptTime}
                  onChange={setApptTime}
                  options={TIME_OPTIONS.map((t) => ({ value: t, label: t }))}
                />
              </div>

              <div className="field">
                <label htmlFor="source">Kaynak</label>
                <Select id="source" value={source} onChange={setSource} options={SOURCE_OPTIONS} />
              </div>

              <div className="field">
                <label htmlFor="sourceNote">Not (opsiyonel)</label>
                <input
                  id="sourceNote"
                  placeholder="ör. kampanya adı"
                  value={sourceNote}
                  onChange={(e) => setSourceNote(e.target.value)}
                />
              </div>

              <div className={styles.formActions}>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Oluşturuluyor…' : 'Randevu oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        {viewMode === 'gunluk' && (
          <div className={styles.dayNav}>
            <button type="button" className="btn-secondary" onClick={() => shiftDate(-1)}>
              ← Önceki gün
            </button>
            <div className={styles.dateColumn}>
              <input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} />
              <span className={styles.dayLabel}>{dayLabel}</span>
            </div>
            <button type="button" className="btn-secondary" onClick={() => shiftDate(1)}>
              Sonraki gün →
            </button>
            {diffDays !== 0 && (
              <button type="button" className={styles.todayButton} onClick={() => setViewDate(todayLocalDateString())}>
                Bugüne dön
              </button>
            )}
          </div>
        )}

        {viewMode === 'haftalik' && (
          <div className={styles.dayNav}>
            <button type="button" className="btn-secondary" onClick={() => shiftWeek(-1)}>
              ← Önceki hafta
            </button>
            <span className={styles.dayLabel}>{groupedByDate[0]?.label} – {groupedByDate[6]?.label}</span>
            <button type="button" className="btn-secondary" onClick={() => shiftWeek(1)}>
              Sonraki hafta →
            </button>
          </div>
        )}

        {loading ? (
          <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
        ) : viewMode === 'gunluk' ? (
          visible.length === 0 ? (
            <p style={{ color: 'var(--text-dim)' }}>Bu tarihte randevu yok.</p>
          ) : (
            <div className={styles.apptList}>
              <div className={styles.apptListHead}>
                <span>Saat</span>
                <span>Müşteri</span>
                <span>Hizmet</span>
                <span>Uzman</span>
                <span>Durum</span>
              </div>
              {visible.map((a) => renderRow(a))}
            </div>
          )
        ) : (
          groupedByDate.map((group) => (
            <div key={group.dateKey} className={styles.dateGroup}>
              <div className={styles.dateGroupLabel}>
                {WEEKDAY_SHORT[new Date(group.dateKey + 'T00:00:00').getDay()]} · {group.label}
              </div>
              {group.items.length === 0 ? (
                <p className={styles.sourceNote}>Randevu yok.</p>
              ) : (
                <div className={styles.apptList}>
                  <div className={styles.apptListHead}>
                    <span>Saat</span>
                    <span>Müşteri</span>
                    <span>Hizmet</span>
                    <span>Uzman</span>
                    <span>Durum</span>
                  </div>
                  {group.items.map((a) => renderRow(a))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
