import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatPersonName } from '../lib/formatName'
import { currency } from '../lib/currency'
import Avatar from '../components/Avatar'
import Select from '../components/Select'
import { ChevronRightIcon, PhoneIcon, MailIcon, WalletIcon, PencilIcon, TrashIcon, ClockIcon, ServicesIcon, TrendingUpIcon, CalendarIcon } from '../components/icons'
import styles from './CustomerDetailPage.module.css'

interface Customer {
  id: string
  full_name: string
  phone: string | null
  contact_phone: string | null
  email: string | null
  created_at: string
}

interface Service {
  id: string
  name: string
  price: number | null
}

interface Appointment {
  id: string
  service_id: string | null
  employee_id: string | null
  scheduled_at: string
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  package_id: string | null
  price_override: number | null
}

interface Employee {
  id: string
  full_name: string | null
}

interface ServicePackage {
  id: string
  service_id: string | null
  total_sessions: number
  session_offset: number
  status: 'aktif' | 'tamamlandi'
  created_at: string
}

interface Payment {
  id: string
  amount: number
  method: 'nakit' | 'kart' | 'havale' | 'diger' | 'bakiye'
  paid_at: string
  appointment_id: string | null
  package_id: string | null
  note: string | null
  created_by_user_id: string | null
  voided_at: string | null
}

const METHOD_LABEL: Record<Payment['method'], string> = {
  nakit: 'Nakit',
  kart: 'Kredi Kartı',
  havale: 'Havale / EFT',
  diger: 'Diğer',
  bakiye: 'Bakiyeden',
}
const SESSION_STATUS_LABEL: Record<Appointment['status'], string> = {
  bekliyor: 'Bekliyor',
  onaylandi: 'Onaylandı',
  tamamlandi: 'Tamamlandı',
  iptal: 'İptal',
  gelmedi: 'Gelmedi',
}
const PAYMENT_METHOD_OPTIONS = [
  { value: 'nakit', label: 'Nakit' },
  { value: 'kart', label: 'Kredi Kartı' },
  { value: 'havale', label: 'Havale / EFT' },
  { value: 'diger', label: 'Diğer' },
]

function customerPhone(c: Customer) {
  return c.contact_phone || c.phone || null
}

function remainingLabel(remaining: number): { text: string; positive: boolean } {
  if (remaining > 0) return { text: `Kalan ${currency.format(remaining)}`, positive: false }
  if (remaining < 0) return { text: `+${currency.format(-remaining)} fazla ödendi`, positive: true }
  return { text: 'Ödendi', positive: true }
}

function humanizeDuration(days: number): string {
  if (days < 1) return 'Bugün'
  if (days < 30) return `${Math.round(days)} gün`
  if (days < 365) return `${Math.round(days / 30)} ay`
  const years = Math.floor(days / 365)
  const months = Math.round((days % 365) / 30)
  return months > 0 ? `${years} yıl ${months} ay` : `${years} yıl`
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [packages, setPackages] = useState<ServicePackage[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [payTarget, setPayTarget] = useState('')
  const [payNote, setPayNote] = useState('')
  const [paySubmitting, setPaySubmitting] = useState(false)

  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editMethod, setEditMethod] = useState('nakit')
  const [editDate, setEditDate] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [editCustomerOpen, setEditCustomerOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editCustomerSubmitting, setEditCustomerSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadData() {
    if (!id) return
    setLoading(true)
    const [{ data: cust }, { data: appts }, { data: pkgs }, { data: pays }, { data: svcs }, { data: emps }] = await Promise.all([
      supabase
        .from('customers')
        .select('id, full_name, phone, contact_phone, email, created_at')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('appointments')
        .select('id, service_id, employee_id, scheduled_at, status, package_id, price_override')
        .eq('customer_id', id)
        .order('scheduled_at', { ascending: false }),
      supabase
        .from('service_packages')
        .select('id, service_id, total_sessions, session_offset, status, created_at')
        .eq('customer_id', id),
      supabase
        .from('payments')
        .select('id, amount, method, paid_at, appointment_id, package_id, note, created_by_user_id, voided_at')
        .eq('customer_id', id)
        .order('paid_at', { ascending: false }),
      supabase.from('services').select('id, name, price'),
      supabase.from('profiles').select('id, full_name'),
    ])
    setCustomer(cust ?? null)
    setAppointments(appts ?? [])
    setPackages(pkgs ?? [])
    setPayments(pays ?? [])
    setServices(svcs ?? [])
    setEmployees(emps ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const now = useMemo(() => new Date(), [])

  const activePayments = useMemo(() => payments.filter((p) => !p.voided_at), [payments])

  const packageStats = useMemo(
    () =>
      packages.map((pkg) => {
        const svc = pkg.service_id ? serviceById.get(pkg.service_id) : undefined
        const sessions = appointments.filter((a) => a.package_id === pkg.id)
        const completed = sessions.filter((a) => a.status === 'tamamlandi').length + pkg.session_offset
        const sortedSessions = sessions.slice().sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
        const sessionPrice = sortedSessions[0]?.price_override ?? svc?.price ?? 0
        const knownSessionsTotal = sessions.reduce((sum, a) => sum + (a.price_override ?? sessionPrice), 0)
        const remainingSessionsEstimate =
          Math.max(0, pkg.total_sessions - pkg.session_offset - sessions.length) * sessionPrice
        const expected = knownSessionsTotal + remainingSessionsEstimate
        const paid = activePayments.filter((p) => p.package_id === pkg.id).reduce((s, p) => s + p.amount, 0)
        return {
          pkg,
          svc,
          sessions: sortedSessions,
          sessionCount: sessions.length,
          completed,
          expected,
          paid,
          remaining: expected - paid,
        }
      }),
    [packages, appointments, activePayments, serviceById],
  )

  const standaloneAppts = useMemo(
    () =>
      appointments
        .filter((a) => !a.package_id && a.status === 'tamamlandi')
        .map((a) => {
          const svc = a.service_id ? serviceById.get(a.service_id) : undefined
          const expected = a.price_override ?? svc?.price ?? 0
          const paid = activePayments.filter((p) => p.appointment_id === a.id).reduce((s, p) => s + p.amount, 0)
          return { appt: a, svc, expected, paid, remaining: expected - paid }
        }),
    [appointments, activePayments, serviceById],
  )

  const totalPaid = useMemo(() => activePayments.reduce((s, p) => s + p.amount, 0), [activePayments])
  const totalRemaining = useMemo(
    () =>
      packageStats.reduce((s, p) => s + Math.max(0, p.remaining), 0) +
      standaloneAppts.reduce((s, a) => s + Math.max(0, a.remaining), 0),
    [packageStats, standaloneAppts],
  )

  const paymentTargetOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    for (const p of packageStats) {
      if (p.remaining > 0) {
        opts.push({
          value: `pkg:${p.pkg.id}`,
          label: `${p.svc?.name ?? 'Paket'} (${p.completed}/${p.pkg.total_sessions} seans) — kalan ${currency.format(p.remaining)}`,
        })
      }
    }
    for (const a of standaloneAppts) {
      if (a.remaining > 0) {
        opts.push({
          value: `appt:${a.appt.id}`,
          label: `${a.svc?.name ?? 'Randevu'} — ${new Date(a.appt.scheduled_at).toLocaleDateString('tr-TR')} — kalan ${currency.format(a.remaining)}`,
        })
      }
    }
    return opts
  }, [packageStats, standaloneAppts])

  const insights = useMemo(() => {
    // appointments query is sorted descending by scheduled_at, so index 0 = most recent
    const completedAppts = appointments.filter((a) => a.status === 'tamamlandi')
    const totalVisits = completedAppts.length

    let avgIntervalDays: number | null = null
    if (completedAppts.length >= 2) {
      const mostRecent = new Date(completedAppts[0].scheduled_at).getTime()
      const oldest = new Date(completedAppts[completedAppts.length - 1].scheduled_at).getTime()
      avgIntervalDays = (mostRecent - oldest) / (completedAppts.length - 1) / 86400000
    }

    function pickFavorite(getKey: (a: Appointment) => string | null): string | null {
      const tally = new Map<string, { count: number; mostRecentIndex: number }>()
      completedAppts.forEach((a, i) => {
        const key = getKey(a)
        if (!key) return
        const cur = tally.get(key)
        if (cur) cur.count++
        else tally.set(key, { count: 1, mostRecentIndex: i })
      })
      let bestId: string | null = null
      let best: { count: number; mostRecentIndex: number } | null = null
      for (const [key, v] of tally) {
        if (!best || v.count > best.count || (v.count === best.count && v.mostRecentIndex < best.mostRecentIndex)) {
          best = v
          bestId = key
        }
      }
      return bestId
    }

    const favoriteServiceId = pickFavorite((a) => a.service_id)
    const favoriteEmployeeId = pickFavorite((a) => a.employee_id)
    const favoriteServiceName = favoriteServiceId ? serviceById.get(favoriteServiceId)?.name ?? null : null
    const favoriteEmployeeName = favoriteEmployeeId ? employeeById.get(favoriteEmployeeId)?.full_name ?? null : null

    const lastRelevantAppt = appointments.find((a) => a.status !== 'iptal' && a.status !== 'gelmedi') ?? null
    let lastVisitLabel = '—'
    if (lastRelevantAppt) {
      const t = new Date(lastRelevantAppt.scheduled_at).getTime()
      if (t > now.getTime()) lastVisitLabel = 'Yaklaşan randevu var'
      else {
        const daysAgo = (now.getTime() - t) / 86400000
        lastVisitLabel = daysAgo < 1 ? 'Bugün' : `${humanizeDuration(daysAgo)} önce`
      }
    }

    const tenureLabel = customer ? humanizeDuration((now.getTime() - new Date(customer.created_at).getTime()) / 86400000) : '—'

    return {
      lastVisitLabel,
      favoriteServiceName,
      favoriteEmployeeName,
      avgIntervalLabel: avgIntervalDays !== null ? `${Math.round(avgIntervalDays)} gün` : '—',
      totalVisits,
      tenureLabel,
    }
  }, [appointments, customer, serviceById, employeeById, now])

  async function submitPayment(e: FormEvent) {
    e.preventDefault()
    const amount = Number(payAmount)
    if (!amount || amount <= 0 || !id || !payMethod) return
    setError(null)
    setPaySubmitting(true)
    try {
      const package_id = payTarget.startsWith('pkg:') ? payTarget.slice(4) : null
      const appointment_id = payTarget.startsWith('appt:') ? payTarget.slice(5) : null
      const { error: insertErr } = await supabase.from('payments').insert({
        business_id: profile?.business_id,
        customer_id: id,
        appointment_id,
        package_id,
        amount,
        method: payMethod,
        note: payNote.trim() || null,
        created_by_user_id: profile?.id,
      })
      if (insertErr) {
        setError('Ödeme kaydedilemedi, tekrar deneyin.')
        return
      }
      setPayModalOpen(false)
      setPayAmount('')
      setPayMethod('')
      setPayTarget('')
      setPayNote('')
      await loadData()
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setPaySubmitting(false)
    }
  }

  async function voidPayment(p: Payment) {
    const ok = window.confirm(
      `${currency.format(p.amount)} tutarındaki ödemeyi iptal etmek istediğinize emin misiniz?\n\nBu işlem geri alınamaz; ödeme "Silindi" olarak listede kalır ama tüm bakiye hesaplarından düşer.`,
    )
    if (!ok) return
    try {
      const { error: updateErr } = await supabase
        .from('payments')
        .update({ voided_at: new Date().toISOString() })
        .eq('id', p.id)
      if (updateErr) {
        window.alert('Ödeme iptal edilemedi, tekrar deneyin.')
        return
      }
      await loadData()
    } catch {
      window.alert('Sunucuya ulaşılamadı, tekrar deneyin.')
    }
  }

  function canEditPayment(p: Payment) {
    if (p.method === 'bakiye') return false
    return profile?.role === 'admin' || p.created_by_user_id === profile?.id
  }

  function openEditPayment(p: Payment) {
    setError(null)
    setEditingPayment(p)
    setEditAmount(String(p.amount))
    setEditMethod(p.method === 'bakiye' ? 'nakit' : p.method)
    setEditDate(p.paid_at)
    setEditNote(p.note ?? '')
  }

  async function submitEditPayment(e: FormEvent) {
    e.preventDefault()
    if (!editingPayment) return
    const amount = Number(editAmount)
    if (!amount || amount <= 0) return
    setError(null)
    setEditSubmitting(true)
    try {
      const { error: updateErr } = await supabase
        .from('payments')
        .update({ amount, method: editMethod, paid_at: editDate, note: editNote.trim() || null })
        .eq('id', editingPayment.id)
      if (updateErr) {
        setError('Ödeme güncellenemedi, tekrar deneyin.')
        return
      }
      setEditingPayment(null)
      await loadData()
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setEditSubmitting(false)
    }
  }

  function openEditCustomer() {
    if (!customer) return
    setError(null)
    setEditName(customer.full_name)
    setEditPhone(customerPhone(customer) ?? '')
    setEditEmail(customer.email ?? '')
    setEditCustomerOpen(true)
  }

  async function submitEditCustomer(e: FormEvent) {
    e.preventDefault()
    if (!editName.trim() || !id) return
    setError(null)
    setEditCustomerSubmitting(true)
    try {
      const { error: updateErr } = await supabase
        .from('customers')
        .update({
          full_name: formatPersonName(editName),
          contact_phone: editPhone.trim() || null,
          email: editEmail.trim() || null,
        })
        .eq('id', id)
      if (updateErr) {
        setError('Müşteri güncellenemedi, tekrar deneyin.')
        return
      }
      setEditCustomerOpen(false)
      await loadData()
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setEditCustomerSubmitting(false)
    }
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
  if (!customer) return <p style={{ color: 'var(--text-dim)' }}>Müşteri bulunamadı.</p>

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.backBtn} onClick={() => navigate('/musteriler')}>
        <ChevronRightIcon width={14} height={14} className={styles.backIcon} />
        Müşterilere Dön
      </button>

      <div className={`card ${styles.headerCard}`}>
        <Avatar name={customer.full_name} size={56} />
        <div className={styles.headerInfo}>
          <span className={styles.headerName}>{customer.full_name}</span>
          {customerPhone(customer) && (
            <span className={styles.headerLine}>
              <PhoneIcon width={12} height={12} />
              {customerPhone(customer)}
            </span>
          )}
          {customer.email && (
            <span className={styles.headerLine}>
              <MailIcon width={12} height={12} />
              {customer.email}
            </span>
          )}
        </div>
        <button type="button" className={styles.editCustomerBtn} onClick={openEditCustomer} aria-label="Müşteri bilgilerini düzenle">
          <PencilIcon width={15} height={15} />
        </button>
      </div>

      <div className={styles.balanceRow}>
        <div className={`card ${styles.balanceCard}`}>
          <span className={styles.balanceLabel}>Toplam Ödenen</span>
          <span className={styles.balanceValueOk}>{currency.format(totalPaid)}</span>
        </div>
        <div className={`card ${styles.balanceCard}`}>
          <span className={styles.balanceLabel}>Kalan Ödeme</span>
          <span className={totalRemaining > 0 ? styles.balanceValueDanger : styles.balanceValueOk}>
            {totalRemaining > 0 ? currency.format(totalRemaining) : 'Borç yok'}
          </span>
        </div>
      </div>

      <button
        type="button"
        className={styles.payBtn}
        onClick={() => {
          setError(null)
          setPayModalOpen(true)
        }}
      >
        <WalletIcon width={16} height={16} />
        Ödeme Al
      </button>

      <div className="card">
        <h2 style={{ marginBottom: 14 }}>İçgörüler</h2>
        <div className={styles.insightsGrid}>
          <div className={styles.insightTile}>
            <span className={styles.insightIcon}>
              <ClockIcon width={13} height={13} />
            </span>
            <span className={styles.insightValue}>{insights.lastVisitLabel}</span>
            <span className={styles.insightLabel}>Son Ziyaret</span>
          </div>
          <div className={styles.insightTile}>
            <span className={styles.insightIcon}>
              <ServicesIcon width={13} height={13} />
            </span>
            <span className={styles.insightValue}>{insights.favoriteServiceName ?? '—'}</span>
            {insights.favoriteEmployeeName && (
              <span className={styles.insightSub}>Çalışan: {insights.favoriteEmployeeName}</span>
            )}
            <span className={styles.insightLabel}>Favori Hizmet</span>
          </div>
          <div className={styles.insightTile}>
            <span className={styles.insightIcon}>
              <TrendingUpIcon width={13} height={13} />
            </span>
            <span className={styles.insightValue}>{insights.avgIntervalLabel}</span>
            <span className={styles.insightLabel}>Ortalama Ziyaret Aralığı</span>
          </div>
          <div className={styles.insightTile}>
            <span className={styles.insightIcon}>
              <CalendarIcon width={13} height={13} />
            </span>
            <span className={styles.insightValue}>{insights.totalVisits} ziyaret</span>
            <span className={styles.insightSub}>{insights.tenureLabel} müşterimiz</span>
            <span className={styles.insightLabel}>Toplam Ziyaret</span>
          </div>
        </div>
      </div>

      {packageStats.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 14 }}>Paketler</h2>
          <div className={styles.list}>
            {packageStats.map((p) => (
              <div key={p.pkg.id} className={styles.packageRow}>
                <div className={styles.packageRowTop}>
                  <div className={styles.packageRowMain}>
                    <span className={styles.packageRowName}>
                      {p.svc?.name ?? 'Hizmet'}
                      {p.pkg.status === 'tamamlandi' && (
                        <span className={styles.packageDoneBadge}>Tamamlandı</span>
                      )}
                    </span>
                    <span className={styles.packageRowProgress}>
                      {p.completed}/{p.pkg.total_sessions} seans tamamlandı
                    </span>
                  </div>
                  <div className={styles.packageRowStats}>
                    <span className={styles.packageRowExpected}>{currency.format(p.expected)}</span>
                    <span className={remainingLabel(Math.max(0, p.remaining)).positive ? styles.packageRowRemainingOk : styles.packageRowRemainingDanger}>
                      {remainingLabel(Math.max(0, p.remaining)).text}
                    </span>
                  </div>
                </div>
                {p.sessions.length > 0 && (
                  <div className={styles.sessionList}>
                    {p.sessions.map((s, i) => (
                      <div key={s.id} className={styles.sessionRow}>
                        <span className={styles.sessionRowLabel}>{i + 1 + p.pkg.session_offset}. Seans</span>
                        <span className={styles.sessionRowDate}>
                          {new Date(s.scheduled_at).toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </span>
                        <span className={`${styles.sessionRowStatus} ${styles[`sessionRowStatus_${s.status}`]}`}>
                          {SESSION_STATUS_LABEL[s.status]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {standaloneAppts.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 14 }}>Tamamlanan Randevular</h2>
          <div className={styles.list}>
            {standaloneAppts.map((a) => (
              <div key={a.appt.id} className={styles.packageRow}>
                <div className={styles.packageRowMain}>
                  <span className={styles.packageRowName}>{a.svc?.name ?? 'Hizmet'}</span>
                  <span className={styles.packageRowProgress}>
                    {new Date(a.appt.scheduled_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                </div>
                <div className={styles.packageRowStats}>
                  <span className={styles.packageRowExpected}>{currency.format(a.expected)}</span>
                  <span className={remainingLabel(a.remaining).positive ? styles.packageRowRemainingOk : styles.packageRowRemainingDanger}>
                    {remainingLabel(a.remaining).text}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginBottom: 14 }}>Ödeme Geçmişi</h2>
        {payments.length === 0 ? (
          <p className={styles.empty}>Henüz ödeme kaydı yok.</p>
        ) : (
          <div className={styles.list}>
            {payments.map((p) => (
              <div key={p.id} className={p.voided_at ? `${styles.paymentRow} ${styles.paymentRowVoided}` : styles.paymentRow}>
                <div className={styles.paymentRowMain}>
                  <span className={styles.paymentRowAmount}>{currency.format(p.amount)}</span>
                  <span className={styles.paymentRowMeta}>
                    {METHOD_LABEL[p.method]} · {new Date(p.paid_at).toLocaleDateString('tr-TR')}
                    {p.note ? ` · ${p.note}` : ''}
                  </span>
                </div>
                {p.voided_at ? (
                  <span className={styles.voidedBadge}>Silindi</span>
                ) : (
                  canEditPayment(p) && (
                    <div className={styles.paymentRowActions}>
                      <button
                        type="button"
                        className={styles.editPaymentBtn}
                        onClick={() => openEditPayment(p)}
                        aria-label="Ödemeyi düzenle"
                      >
                        <PencilIcon width={14} height={14} />
                      </button>
                      <button
                        type="button"
                        className={styles.voidPaymentBtn}
                        onClick={() => voidPayment(p)}
                        aria-label="Ödemeyi iptal et"
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {payModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setPayModalOpen(false)}>
          <div className={`card ${styles.modalCard}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Ödeme Al</h2>
              <button type="button" className={styles.modalClose} onClick={() => setPayModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={submitPayment}>
              <div className="field">
                <label htmlFor="payAmount">Tutar (TL)</label>
                <input
                  id="payAmount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="payMethod">Yöntem</label>
                <Select id="payMethod" value={payMethod} onChange={setPayMethod} options={PAYMENT_METHOD_OPTIONS} />
              </div>
              <div className="field">
                <label htmlFor="payTarget">Hangi hizmete/pakete ait</label>
                <Select id="payTarget" value={payTarget} onChange={setPayTarget} options={paymentTargetOptions} />
              </div>
              <div className="field">
                <label htmlFor="payNote">Not (opsiyonel)</label>
                <input id="payNote" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="ör. indirimli ödendi" />
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <button type="submit" className="btn-primary" disabled={paySubmitting || !payMethod}>
                {paySubmitting ? 'Kaydediliyor…' : 'Ödemeyi Kaydet'}
              </button>
            </form>
          </div>
        </div>
      )}

      {editingPayment && (
        <div className={styles.modalBackdrop} onClick={() => setEditingPayment(null)}>
          <div className={`card ${styles.modalCard}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Ödemeyi Düzenle</h2>
              <button type="button" className={styles.modalClose} onClick={() => setEditingPayment(null)}>
                ✕
              </button>
            </div>
            <form onSubmit={submitEditPayment}>
              <div className="field">
                <label htmlFor="editAmount">Tutar (TL)</label>
                <input
                  id="editAmount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="editMethod">Yöntem</label>
                <Select id="editMethod" value={editMethod} onChange={setEditMethod} options={PAYMENT_METHOD_OPTIONS} />
              </div>
              <div className="field">
                <label htmlFor="editDate">Tarih</label>
                <input id="editDate" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="editNote">Not (opsiyonel)</label>
                <input id="editNote" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="ör. indirimli ödendi" />
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <button type="submit" className="btn-primary" disabled={editSubmitting}>
                {editSubmitting ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}
              </button>
            </form>
          </div>
        </div>
      )}

      {editCustomerOpen && (
        <div className={styles.modalBackdrop} onClick={() => setEditCustomerOpen(false)}>
          <div className={`card ${styles.modalCard}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Müşteriyi Düzenle</h2>
              <button type="button" className={styles.modalClose} onClick={() => setEditCustomerOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={submitEditCustomer}>
              <div className="field">
                <label htmlFor="editCustomerName">Ad Soyad</label>
                <input
                  id="editCustomerName"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="editCustomerPhone">Telefon</label>
                <input
                  id="editCustomerPhone"
                  type="tel"
                  inputMode="numeric"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="05xx xxx xx xx"
                />
              </div>
              <div className="field">
                <label htmlFor="editCustomerEmail">E-posta</label>
                <input
                  id="editCustomerEmail"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="ornek@eposta.com"
                />
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <button type="submit" className="btn-primary" disabled={editCustomerSubmitting}>
                {editCustomerSubmitting ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
