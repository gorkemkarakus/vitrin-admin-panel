import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import Avatar from '../components/Avatar'
import { SearchIcon, FilterIcon, CheckCircleIcon, UsersIcon, UserPlusIcon, StarIcon, WalletIcon, ChevronRightIcon } from '../components/icons'
import { currencyWhole as currency } from '../lib/currency'
import { toLocalDateString } from '../lib/date'
import { segmentForStats, type CustomerSegment } from '../lib/customerSegments'
import styles from './CustomersPage.module.css'

interface Customer {
  id: string
  full_name: string
  phone: string | null
  contact_phone: string | null
  email: string | null
  created_at: string
}

interface Appointment {
  id: string
  customer_id: string | null
  service_id: string | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  scheduled_at: string
  package_id: string | null
  price_override: number | null
}

interface Service {
  id: string
  price: number | null
}

interface ServicePackage {
  id: string
  customer_id: string
  service_id: string | null
  total_sessions: number
  session_offset: number
}

interface Payment {
  id: string
  customer_id: string
  amount: number
  appointment_id: string | null
  package_id: string | null
  paid_at: string
}

type Segment = CustomerSegment
type SegmentFilter = 'tumu' | Segment | 'borclu'
type SortBy = 'ad' | 'son_randevu' | 'harcama'
type StatsPeriod = 'tumu' | 'hafta' | 'ay'

const STATS_PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'tumu', label: 'Tüm Zamanlar' },
  { value: 'hafta', label: 'Son Hafta' },
  { value: 'ay', label: 'Son Ay' },
]

const PAGE_SIZE = 60

const SEGMENT_TABS: { value: SegmentFilter; label: string }[] = [
  { value: 'tumu', label: 'Tümü' },
  { value: 'borclu', label: 'Borçlu' },
  { value: 'sadik', label: 'Sadık' },
  { value: 'yeni', label: 'Yeni' },
]

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'ad', label: 'Ada Göre (A-Z)' },
  { value: 'son_randevu', label: 'Son Randevuya Göre' },
  { value: 'harcama', label: 'Harcamaya Göre' },
]

const SEGMENT_BADGE: Record<Segment, { label: string; icon: typeof StarIcon; className: string }> = {
  sadik: { label: 'Sadık Müşteri', icon: StarIcon, className: 'badgeSadik' },
  yeni: { label: 'Yeni Müşteri', icon: UserPlusIcon, className: 'badgeYeni' },
}

function monthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function customerPhone(c: Customer) {
  return c.contact_phone || c.phone || null
}

export default function CustomersPage() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [packages, setPackages] = useState<ServicePackage[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>('ay')
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>('tumu')
  const [sortBy, setSortBy] = useState<SortBy>('ad')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const sortMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sortMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setSortMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [sortMenuOpen])

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const [{ data: custs }, { data: appts }, { data: pkgs }, { data: pays }, { data: svcs }] = await Promise.all([
        fetchAll(() => supabase
          .from('customers')
          .select('id, full_name, phone, contact_phone, email, created_at')
          .order('full_name').order('id')),
        fetchAll(() => supabase
          .from('appointments')
          .select('id, customer_id, service_id, status, scheduled_at, package_id, price_override').order('id')),
        fetchAll(() => supabase.from('service_packages').select('id, customer_id, service_id, total_sessions, session_offset').order('id')),
        fetchAll(() => supabase.from('payments').select('id, customer_id, amount, appointment_id, package_id, paid_at').is('voided_at', null).order('id')),
        supabase.from('services').select('id, price'),
      ])
      setCustomers(custs ?? [])
      setAppointments(appts ?? [])
      setPackages(pkgs ?? [])
      setPayments(pays ?? [])
      setServices(svcs ?? [])
      setLoading(false)
    }
    loadData()
  }, [])

  const now = useMemo(() => new Date(), [])
  const currentMonthStart = useMemo(() => monthStart(now), [now])

  const servicePriceById = useMemo(() => new Map(services.map((s) => [s.id, s.price ?? 0])), [services])

  const apptsByCustomer = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      if (!a.customer_id) continue
      const list = map.get(a.customer_id) ?? []
      list.push(a)
      map.set(a.customer_id, list)
    }
    return map
  }, [appointments])

  const paymentsByCustomer = useMemo(() => {
    const map = new Map<string, Payment[]>()
    for (const p of payments) {
      const list = map.get(p.customer_id) ?? []
      list.push(p)
      map.set(p.customer_id, list)
    }
    return map
  }, [payments])

  const statsByCustomer = useMemo(() => {
    const map = new Map<
      string,
      {
        totalSpend: number
        completedCount: number
        lastApptAt: Date | null
        isNewThisMonth: boolean
      }
    >()
    for (const c of customers) {
      const appts = apptsByCustomer.get(c.id) ?? []
      const completed = appts.filter((a) => a.status === 'tamamlandi')
      const totalSpend = (paymentsByCustomer.get(c.id) ?? []).reduce((sum, p) => sum + p.amount, 0)
      const relevant = appts.filter((a) => a.status !== 'iptal' && a.status !== 'gelmedi')
      const lastApptAt = relevant.length
        ? new Date(Math.max(...relevant.map((a) => new Date(a.scheduled_at).getTime())))
        : null
      const isNewThisMonth = new Date(c.created_at) >= currentMonthStart
      map.set(c.id, {
        totalSpend,
        completedCount: completed.length,
        lastApptAt,
        isNewThisMonth,
      })
    }
    return map
  }, [customers, apptsByCustomer, paymentsByCustomer, currentMonthStart])

  const debtByCustomer = useMemo(() => {
    const map = new Map<string, number>()
    for (const pkg of packages) {
      const standardPrice = pkg.service_id ? (servicePriceById.get(pkg.service_id) ?? 0) : 0
      const sessions = appointments
        .filter((a) => a.package_id === pkg.id)
        .slice()
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      const price = sessions[0]?.price_override ?? standardPrice
      const knownSessionsTotal = sessions.reduce((sum, a) => sum + (a.price_override ?? price), 0)
      const remainingSessionsEstimate = Math.max(0, pkg.total_sessions - pkg.session_offset - sessions.length) * price
      const expected = knownSessionsTotal + remainingSessionsEstimate
      const paid = payments.filter((p) => p.package_id === pkg.id).reduce((sum, p) => sum + p.amount, 0)
      const remaining = Math.max(0, expected - paid)
      map.set(pkg.customer_id, (map.get(pkg.customer_id) ?? 0) + remaining)
    }
    for (const a of appointments) {
      if (!a.customer_id || a.package_id || a.status !== 'tamamlandi') continue
      const expected = a.price_override ?? (a.service_id ? (servicePriceById.get(a.service_id) ?? 0) : 0)
      const paid = payments.filter((p) => p.appointment_id === a.id).reduce((sum, p) => sum + p.amount, 0)
      const remaining = Math.max(0, expected - paid)
      if (remaining > 0) map.set(a.customer_id, (map.get(a.customer_id) ?? 0) + remaining)
    }
    return map
  }, [packages, payments, appointments, servicePriceById])

  function segmentFor(customerId: string): Segment | null {
    const s = statsByCustomer.get(customerId)
    if (!s) return null
    return segmentForStats(s)
  }

  const counts = useMemo(() => {
    const c = { tumu: customers.length, sadik: 0, yeni: 0, borclu: 0 }
    for (const cust of customers) {
      const seg = segmentFor(cust.id)
      if (seg) c[seg]++
      if ((debtByCustomer.get(cust.id) ?? 0) > 0) c.borclu++
    }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, statsByCustomer, debtByCustomer])

  const statsPeriodStart = useMemo(() => {
    if (statsPeriod === 'tumu') return null
    const d = new Date(now)
    d.setDate(d.getDate() - (statsPeriod === 'hafta' ? 7 : 30))
    return d
  }, [statsPeriod, now])

  const newCustomerCountForPeriod = useMemo(
    () => customers.filter((c) => !statsPeriodStart || new Date(c.created_at) >= statsPeriodStart).length,
    [customers, statsPeriodStart],
  )

  const totalSpendForPeriod = useMemo(() => {
    const startStr = statsPeriodStart ? toLocalDateString(statsPeriodStart) : null
    return payments
      .filter((p) => !startStr || p.paid_at >= startStr)
      .reduce((sum, p) => sum + p.amount, 0)
  }, [payments, statsPeriodStart])

  const statsPeriodLabel = STATS_PERIODS.find((p) => p.value === statsPeriod)?.label ?? ''

  const q = search.trim().toLowerCase()
  const filteredSorted = useMemo(() => {
    let list = customers.filter(
      (c) => !q || c.full_name.toLowerCase().includes(q) || (customerPhone(c) ?? '').toLowerCase().includes(q),
    )
    if (segmentFilter === 'borclu') list = list.filter((c) => (debtByCustomer.get(c.id) ?? 0) > 0)
    else if (segmentFilter !== 'tumu') list = list.filter((c) => segmentFor(c.id) === segmentFilter)
    list = [...list].sort((a, b) => {
      if (segmentFilter === 'borclu') return (debtByCustomer.get(b.id) ?? 0) - (debtByCustomer.get(a.id) ?? 0)
      if (sortBy === 'ad') return a.full_name.localeCompare(b.full_name, 'tr')
      const sa = statsByCustomer.get(a.id)
      const sb = statsByCustomer.get(b.id)
      if (sortBy === 'harcama') return (sb?.totalSpend ?? 0) - (sa?.totalSpend ?? 0)
      const ta = sa?.lastApptAt?.getTime() ?? -Infinity
      const tb = sb?.lastApptAt?.getTime() ?? -Infinity
      return tb - ta
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, q, segmentFilter, sortBy, statsByCustomer, debtByCustomer])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [q, segmentFilter, sortBy])

  const visibleCustomers = filteredSorted.slice(0, visibleCount)

  return (
    <div className={styles.wrap}>
      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <SearchIcon width={16} height={16} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Müşteri ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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

      <div className={styles.periodRow}>
        {STATS_PERIODS.map((p) => (
          <button
            type="button"
            key={p.value}
            className={statsPeriod === p.value ? styles.periodBtnActive : styles.periodBtn}
            onClick={() => setStatsPeriod(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.statsGrid}>
        <div className={`${styles.statCard} ${styles.statCardSignal}`}>
          <span className={`${styles.statIcon} ${styles.statIconSignal}`}>
            <UsersIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{customers.length}</span>
          <span className={styles.statLabel}>Toplam Müşteri</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCardOk}`}>
          <span className={`${styles.statIcon} ${styles.statIconOk}`}>
            <UserPlusIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{newCustomerCountForPeriod}</span>
          <span className={styles.statLabel}>Yeni Müşteri ({statsPeriodLabel})</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCardWarn}`}>
          <span className={`${styles.statIcon} ${styles.statIconWarn}`}>
            <StarIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{counts.sadik}</span>
          <span className={styles.statLabel}>Sadık Müşteri</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCardInfo}`}>
          <span className={`${styles.statIcon} ${styles.statIconInfo}`}>
            <WalletIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{currency.format(totalSpendForPeriod)}</span>
          <span className={styles.statLabel}>Toplam Harcama ({statsPeriodLabel})</span>
        </div>
      </div>

      <div className={styles.segmentRow}>
        {SEGMENT_TABS.map((tab) => (
          <button
            type="button"
            key={tab.value}
            className={segmentFilter === tab.value ? styles.segmentBtnActive : styles.segmentBtn}
            onClick={() => setSegmentFilter(tab.value)}
          >
            {tab.label} ({counts[tab.value]})
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
      ) : filteredSorted.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>Müşteri bulunamadı.</p>
      ) : (
        <div className="card">
          <div className={styles.list}>
            {visibleCustomers.map((c) => {
              const seg = segmentFor(c.id)
              const s = statsByCustomer.get(c.id)
              const badge = seg ? SEGMENT_BADGE[seg] : null
              const BadgeIcon = badge?.icon
              return (
                <div
                  key={c.id}
                  className={styles.row}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/musteriler/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/musteriler/${c.id}`)
                  }}
                >
                  <Avatar name={c.full_name} size={44} />
                  <div className={styles.rowMain}>
                    <span className={styles.rowName}>{c.full_name}</span>
                    {customerPhone(c) && <span className={styles.rowPhone}>{customerPhone(c)}</span>}
                    {badge && BadgeIcon && (
                      <span className={`${styles.badge} ${styles[badge.className]}`}>
                        <BadgeIcon width={11} height={11} />
                        {badge.label}
                      </span>
                    )}
                    {(debtByCustomer.get(c.id) ?? 0) > 0 && (
                      <span className={styles.debtBadge}>
                        Borç: {currency.format(debtByCustomer.get(c.id) ?? 0)}
                      </span>
                    )}
                  </div>
                  <div className={styles.rowStats}>
                    <div className={styles.rowStatBlock}>
                      <span className={styles.rowStatLabel}>Son Randevu</span>
                      <span className={styles.rowStatValueSignal}>
                        {s?.lastApptAt
                          ? s.lastApptAt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
                          : '—'}
                      </span>
                    </div>
                    <div className={styles.rowStatBlock}>
                      <span className={styles.rowStatLabel}>Toplam Harcama</span>
                      <span className={styles.rowStatValue}>{currency.format(s?.totalSpend ?? 0)}</span>
                    </div>
                  </div>
                  <ChevronRightIcon width={16} height={16} className={styles.rowChevron} />
                </div>
              )
            })}
          </div>
          {filteredSorted.length > visibleCustomers.length && (
            <button
              type="button"
              className={styles.loadMoreBtn}
              onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
            >
              Daha Fazla Göster ({filteredSorted.length - visibleCustomers.length} kaldı)
            </button>
          )}
        </div>
      )}

    </div>
  )
}
