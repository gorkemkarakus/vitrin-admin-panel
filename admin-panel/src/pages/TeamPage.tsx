import { useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import {
  SearchIcon,
  FilterIcon,
  CheckCircleIcon,
  PhoneIcon,
  UmbrellaIcon,
  ChevronRightIcon,
  UserPlusIcon,
} from '../components/icons'
import Avatar from '../components/Avatar'
import { toLocalDateString } from '../lib/date'
import styles from './TeamPage.module.css'
import { FIELD_LIMITS } from '../lib/fieldLimits'

interface Employee {
  id: string
  full_name: string | null
  role: 'admin' | 'user'
  is_active: boolean
  whatsapp_phone: string | null
}

interface TimeBlock {
  profile_id: string
  block_date: string | null
  end_date: string | null
}

interface Appointment {
  id: string
  employee_id: string | null
  service_id: string | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  scheduled_at: string
}

interface Payment {
  id: string
  amount: number
  appointment_id: string | null
}

type StatusFilter = 'tumu' | 'aktif' | 'izinli' | 'pasif'
type SortBy = 'ad' | 'randevu' | 'kazanc'

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'tumu', label: 'Tümü' },
  { value: 'aktif', label: 'Aktif' },
  { value: 'izinli', label: 'İzinli' },
  { value: 'pasif', label: 'Pasif' },
]

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'ad', label: 'Ada Göre (A-Z)' },
  { value: 'randevu', label: 'Bugünkü Randevuya Göre' },
  { value: 'kazanc', label: 'Bugünkü Kazanca Göre' },
]

function todayLocalDateString() {
  return toLocalDateString(new Date())
}

function roleLabel(role: Employee['role']) {
  return role === 'admin' ? 'Yönetici' : 'Çalışan'
}

// whatsapp_phone ham rakam dizisi olarak saklaniyor (ör. "905413402738")
// — satirda okunakli olmasi icin standart TR cep telefonu bicimine ceviriyor.
function formatPhone(raw: string) {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2)
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1)
  if (digits.length !== 10) return raw
  return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`
}

export default function TeamPage() {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('tumu')
  const [sortBy, setSortBy] = useState<SortBy>('ad')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sortMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setSortMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [sortMenuOpen])

  async function loadData() {
    setLoading(true)
    const [{ data: profs }, { data: blocks }, { data: appts }, { data: pays }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, role, is_active, whatsapp_phone')
        .order('role', { ascending: false })
        .order('full_name'),
      supabase.from('employee_time_blocks').select('profile_id, block_date, end_date'),
      fetchAll(() => supabase.from('appointments').select('id, employee_id, service_id, status, scheduled_at').order('id')),
      fetchAll(() => supabase.from('payments').select('id, amount, appointment_id').is('voided_at', null).eq('paid_at', todayLocalDateString()).order('id')),
    ])
    setEmployees(profs ?? [])
    setTimeBlocks(blocks ?? [])
    setAppointments(appts ?? [])
    setPayments(pays ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const today = useMemo(() => todayLocalDateString(), [])
  const appointmentById = useMemo(() => new Map(appointments.map((a) => [a.id, a])), [appointments])

  const apptsByEmployeeToday = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      if (!a.employee_id) continue
      if (toLocalDateString(new Date(a.scheduled_at)) !== today) continue
      const list = map.get(a.employee_id) ?? []
      list.push(a)
      map.set(a.employee_id, list)
    }
    return map
  }, [appointments, today])

  // Kazanc artik gercek odemelerden (payments, paid_at = bugun) hesaplaniyor —
  // randevu tamamlandi diye ucretin tamami o an alinmis olmayabiliyor (paket/
  // taksit/gecikmeli odeme). Randevu sayisi ise is yuku gostergesi oldugu icin
  // hala randevu tablosundan (durum bazli) geliyor.
  function todayStatsFor(profileId: string) {
    const list = apptsByEmployeeToday.get(profileId) ?? []
    const count = list.filter((a) => a.status !== 'iptal').length
    const earnings = payments
      .filter((p) => p.appointment_id && appointmentById.get(p.appointment_id)?.employee_id === profileId)
      .reduce((sum, p) => sum + p.amount, 0)
    return { count, earnings }
  }

  function statusFor(emp: Employee): 'aktif' | 'izinli' | 'pasif' {
    if (!emp.is_active) return 'pasif'
    const onLeaveToday = timeBlocks.some(
      (b) => b.profile_id === emp.id && b.block_date !== null && b.block_date <= today && today <= (b.end_date ?? b.block_date),
    )
    return onLeaveToday ? 'izinli' : 'aktif'
  }

  const counts = useMemo(() => {
    const c = { tumu: employees.length, aktif: 0, izinli: 0, pasif: 0 }
    for (const emp of employees) c[statusFor(emp)]++
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, timeBlocks, today])

  const q = search.trim().toLowerCase()
  const filteredSorted = useMemo(() => {
    let list = employees.filter(
      (e) => !q || (e.full_name ?? '').toLowerCase().includes(q) || (e.whatsapp_phone ?? '').toLowerCase().includes(q),
    )
    if (statusFilter !== 'tumu') list = list.filter((e) => statusFor(e) === statusFilter)
    list = [...list].sort((a, b) => {
      if (sortBy === 'ad') return (a.full_name ?? '').localeCompare(b.full_name ?? '', 'tr')
      const sa = todayStatsFor(a.id)
      const sb = todayStatsFor(b.id)
      return sortBy === 'randevu' ? sb.count - sa.count : sb.earnings - sa.earnings
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, q, statusFilter, sortBy, apptsByEmployeeToday])

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  return (
    <div className={styles.wrap}>
      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <SearchIcon width={16} height={16} className={styles.searchIcon} />
          <input maxLength={FIELD_LIMITS.search}
            className={styles.searchInput}
            placeholder="Ekip üyesi ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="button" className={styles.addBtn} onClick={() => navigate('/ekip/yeni')} aria-label="Yeni çalışan ekle">
          <UserPlusIcon width={17} height={17} />
        </button>
        <div className={styles.filterWrap} ref={sortMenuRef}>
          <button
            type="button"
            className={styles.filterBtn}
            onClick={() => setSortMenuOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={sortMenuOpen}
          >
            <FilterIcon width={15} height={15} />
            Filtrele
          </button>
          {sortMenuOpen && (
            <div className={styles.filterMenu} role="listbox">
              {SORT_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  className={styles.filterMenuItem}
                  onClick={() => {
                    setSortBy(opt.value)
                    setSortMenuOpen(false)
                  }}
                >
                  {opt.label}
                  {sortBy === opt.value && <CheckCircleIcon width={14} height={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.segmentRow}>
        {STATUS_TABS.map((tab) => (
          <button
            type="button"
            key={tab.value}
            className={statusFilter === tab.value ? styles.segmentBtnActive : styles.segmentBtn}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label} ({counts[tab.value]})
          </button>
        ))}
      </div>

      <button type="button" className={styles.holidayRow} onClick={() => navigate('/ekip/tatiller')}>
        <span className={styles.holidayRowIcon}>
          <UmbrellaIcon width={18} height={18} />
        </span>
        <span className={styles.holidayRowText}>
          <span className={styles.holidayRowLabel}>Resmî Tatiller</span>
          <span className={styles.holidayRowSub}>Tüm ekip için toplu izin günü tanımla</span>
        </span>
        <ChevronRightIcon width={16} height={16} className={styles.holidayRowChevron} />
      </button>

      <div className="card">
        <div className={styles.list}>
          {filteredSorted.length === 0 ? (
            <p style={{ color: 'var(--text-dim)' }}>Ekip üyesi bulunamadı.</p>
          ) : (
            filteredSorted.map((emp) => {
              const status = statusFor(emp)
              const stats = todayStatsFor(emp.id)

              return (
                <div key={emp.id} className={styles.rowWrap}>
                  <div
                    className={styles.row}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/ekip/${emp.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/ekip/${emp.id}`)
                    }}
                  >
                    <div className={styles.avatarWrap}>
                      <Avatar name={emp.full_name ?? '?'} size={38} />
                      <span className={`${styles.statusDot} ${styles[`statusDot_${status}`]}`} />
                    </div>
                    <div className={styles.rowMain}>
                      <span className={styles.rowName}>{emp.full_name ?? '—'}</span>
                      <span className={styles.rowRole}>{roleLabel(emp.role)}</span>
                      {emp.whatsapp_phone && (
                        <span className={styles.rowPhone}>
                          <PhoneIcon width={11} height={11} />
                          <span className={styles.rowPhoneText}>{formatPhone(emp.whatsapp_phone)}</span>
                        </span>
                      )}
                    </div>
                    <div className={styles.rowStatBlock}>
                      <span className={styles.rowStatLabel}>Randevu</span>
                      <span className={styles.rowStatValue}>{stats.count}</span>
                    </div>
                    <span className={`${styles.statusPill} ${styles[`statusPill_${status}`]}`}>
                      {STATUS_TABS.find((t) => t.value === status)?.label}
                    </span>
                    <span className={styles.editLabel}>Düzenle</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
