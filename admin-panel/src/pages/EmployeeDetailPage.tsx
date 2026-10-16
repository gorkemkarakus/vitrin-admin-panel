import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Avatar from '../components/Avatar'
import { colorForName } from '../lib/avatarColor'
import Select from '../components/Select'
import {
  CalendarIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from '../components/icons'
import styles from './EmployeeDetailPage.module.css'

const GENDER_OPTIONS = [
  { value: '', label: 'Belirtilmesin' },
  { value: 'kadin', label: 'Kadın' },
  { value: 'erkek', label: 'Erkek' },
]

interface Employee {
  id: string
  full_name: string | null
  role: 'admin' | 'user'
  is_active: boolean
  whatsapp_phone: string | null
  gender: 'kadin' | 'erkek' | null
  updated_at: string
}

interface ServiceLite {
  id: string
  name: string
}

interface EmployeeServiceRow {
  profile_id: string
  service_id: string
}

interface Schedule {
  id: string
  profile_id: string
  day_of_week: number
  starts_at: string
  ends_at: string
}

interface TimeBlock {
  id: string
  profile_id: string
  day_of_week: number | null
  block_date: string | null
  end_date: string | null
  starts_at: string
  ends_at: string
  label: string | null
}

interface Appointment {
  id: string
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  scheduled_at: string
}

const BREAK_LABEL = 'Öğle molası'
const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const STATUS_LABEL: Record<'aktif' | 'izinli' | 'pasif', string> = {
  aktif: 'Aktif',
  izinli: 'İzinli',
  pasif: 'Pasif',
}

function todayLocalDateString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function roleLabel(role: Employee['role']) {
  return role === 'admin' ? 'Yönetici' : 'Çalışan'
}

function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function formatHoursMinutes(totalHours: number): string {
  const totalMinutes = Math.max(0, Math.round(totalHours * 60))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}s ${String(m).padStart(2, '0')}d`
}

interface DayInfo {
  enabled: boolean
  start: string
  end: string
  breaks: { start: string; end: string }[]
}

function computeDayInfo(day: number, schedules: Schedule[], timeBlocks: TimeBlock[]): DayInfo {
  const s = schedules.find((x) => x.day_of_week === day)
  if (!s) return { enabled: false, start: '', end: '', breaks: [] }
  const breaks = timeBlocks
    .filter((b) => b.day_of_week === day && b.label === BREAK_LABEL)
    .map((b) => ({ start: b.starts_at.slice(0, 5), end: b.ends_at.slice(0, 5) }))
  return { enabled: true, start: s.starts_at.slice(0, 5), end: s.ends_at.slice(0, 5), breaks }
}

function weeklyPlannedHours(schedules: Schedule[], timeBlocks: TimeBlock[]): number {
  let total = 0
  for (const day of WEEK_ORDER) {
    const info = computeDayInfo(day, schedules, timeBlocks)
    if (!info.enabled) continue
    let minutes = timeToMinutes(info.end) - timeToMinutes(info.start)
    for (const b of info.breaks) minutes -= Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start))
    total += Math.max(0, minutes) / 60
  }
  return total
}

interface LeaveSummary {
  mode: 'day' | 'range'
  date: string
  endDate: string
  label: string
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [services, setServices] = useState<ServiceLite[]>([])
  const [employeeServices, setEmployeeServices] = useState<EmployeeServiceRow[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedDay, setSelectedDay] = useState<number>(() => new Date().getDay())
  const [leaveFilter, setLeaveFilter] = useState<'day' | 'range'>('range')

  // Ad soyad + telefon duzenleme alani da diger kartlar gibi "duzenle ->
  // Kaydet" mantigiyla calisiyor; taslak sunucudan sadece BIR KERE
  // (profileReady false iken) dolduruluyor ki baska bir aksiyonun
  // tetikledigi loadData(true) yazilmakta olan taslagi silip suzmesin.
  const [nameDraft, setNameDraft] = useState('')
  const [phoneDraft, setPhoneDraft] = useState('')
  const [genderDraft, setGenderDraft] = useState<'' | 'kadin' | 'erkek'>('')
  const [profileReady, setProfileReady] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')

  // Hesap bilgileri (e-posta/sifre) profiles tablosunda degil auth.users'ta
  // tutuluyor — bu yuzden normal supabase.from() ile degil, service_role
  // yetkisiyle calisan update-team-member edge function'iyla degistiriliyor.
  // Alanlar bos birakilirsa o alan degistirilmez (mevcut sifre asla
  // gosterilmiyor/on-doldurulmuyor).
  const [accountEmail, setAccountEmail] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [accountSuccess, setAccountSuccess] = useState('')

  async function loadData(silent = false) {
    if (!id) return
    if (!silent) setLoading(true)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
    const [{ data: emp }, { data: svcs }, { data: empSvcs }, { data: scheds }, { data: blocks }, { data: appts }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, role, is_active, whatsapp_phone, gender, updated_at')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('services').select('id, name').eq('is_active', true).order('name'),
      supabase.from('employee_services').select('profile_id, service_id').eq('profile_id', id),
      supabase.from('employee_schedules').select('id, profile_id, day_of_week, starts_at, ends_at').eq('profile_id', id),
      supabase
        .from('employee_time_blocks')
        .select('id, profile_id, day_of_week, block_date, end_date, starts_at, ends_at, label')
        .eq('profile_id', id),
      supabase
        .from('appointments')
        .select('id, status, scheduled_at')
        .eq('employee_id', id)
        .gte('scheduled_at', monthStart)
        .lte('scheduled_at', monthEnd),
    ])
    setEmployee(emp ?? null)
    setServices(svcs ?? [])
    setEmployeeServices(empSvcs ?? [])
    setSchedules(scheds ?? [])
    setTimeBlocks(blocks ?? [])
    setAppointments(appts ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (loading || profileReady || !employee) return
    setNameDraft(employee.full_name ?? '')
    setPhoneDraft(employee.whatsapp_phone ?? '')
    setGenderDraft(employee.gender ?? '')
    setProfileReady(true)
  }, [loading, profileReady, employee])

  const today = useMemo(() => todayLocalDateString(), [])

  async function saveProfileInfo() {
    if (!id || !nameDraft.trim()) return
    setSavingProfile(true)
    setProfileError('')
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: nameDraft.trim(), whatsapp_phone: phoneDraft.trim() || null, gender: genderDraft || null })
      .eq('id', id)
    if (err) {
      const isDupPhone = err.code === '23505' && err.message.includes('whatsapp_phone')
      setProfileError(isDupPhone ? 'Bu telefon numarası başka bir ekip üyesine kayıtlı.' : 'Kaydedilemedi: ' + err.message)
      setSavingProfile(false)
      return
    }
    setProfileReady(false)
    await loadData(true)
    setSavingProfile(false)
  }

  async function saveAccountInfo() {
    if (!id) return
    if (!accountEmail.trim() && !accountPassword.trim()) return
    setSavingAccount(true)
    setAccountError('')
    setAccountSuccess('')
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-team-member`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          id,
          email: accountEmail.trim() || undefined,
          password: accountPassword.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setAccountError(body.error ?? 'Hesap güncellenemedi.')
        return
      }
      setAccountSuccess('Hesap bilgileri güncellendi.')
      setAccountEmail('')
      setAccountPassword('')
    } catch {
      setAccountError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setSavingAccount(false)
    }
  }

  async function toggleService(serviceId: string, checked: boolean) {
    if (!id) return
    if (checked) {
      await supabase.from('employee_services').insert({ profile_id: id, service_id: serviceId })
    } else {
      await supabase.from('employee_services').delete().eq('profile_id', id).eq('service_id', serviceId)
    }
    await loadData(true)
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
  if (!employee) return <p style={{ color: 'var(--text-dim)' }}>Ekip üyesi bulunamadı.</p>

  const status: 'aktif' | 'izinli' | 'pasif' = !employee.is_active
    ? 'pasif'
    : timeBlocks.some((b) => b.block_date !== null && b.block_date <= today && today <= (b.end_date ?? b.block_date))
      ? 'izinli'
      : 'aktif'

  const empServiceIds = new Set(employeeServices.map((es) => es.service_id))
  const assignedServices = services.filter((s) => empServiceIds.has(s.id))
  const specialty = assignedServices.length > 0 ? assignedServices.map((s) => s.name).join(' • ') : roleLabel(employee.role)

  const selectedDayInfo = computeDayInfo(selectedDay, schedules, timeBlocks)
  const weeklyHours = weeklyPlannedHours(schedules, timeBlocks)

  // Tek bir "performans puanı"na indirgemek yerine ayrı ayrı sayılar
  // gösteriliyor — çalışanlar birbiriyle sıralanmıyor/puanlanmıyor.
  const completedThisMonth = appointments.filter((a) => a.status === 'tamamlandi').length
  const cancelledThisMonth = appointments.filter((a) => a.status === 'iptal').length
  const noShowThisMonth = appointments.filter((a) => a.status === 'gelmedi').length

  const leaves: LeaveSummary[] = timeBlocks
    .filter((b) => b.day_of_week === null && b.block_date)
    .map((b) => ({
      mode: (b.end_date && b.end_date !== b.block_date ? 'range' : 'day') as 'day' | 'range',
      date: b.block_date as string,
      endDate: b.end_date ?? (b.block_date as string),
      label: b.label ?? '',
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const visibleLeaves = leaves.filter((l) => l.mode === leaveFilter)

  return (
    <div className={styles.wrap}>
      <div className={styles.topRow}>
        <button type="button" className={styles.backBtn} onClick={() => navigate('/ekip')} aria-label="Ekibe dön">
          <ChevronRightIcon width={16} height={16} className={styles.backIcon} />
        </button>
        <Avatar name={employee.full_name ?? '?'} size={40} />
        <div className={styles.topInfo}>
          <span className={styles.topName}>{employee.full_name ?? '—'}</span>
          <span className={styles.topSpecialty}>{specialty}</span>
        </div>
      </div>

      <div className={styles.tabBar}>
        <span className={styles.tabActive}>Genel Bakış</span>
        <button type="button" className={styles.tab} onClick={() => navigate(`/ekip/${id}/saatler`)}>
          Çalışma Saatleri
        </button>
        <button type="button" className={styles.tab} onClick={() => navigate(`/ekip/${id}/izinler`)}>
          İzinler
        </button>
        <button type="button" className={styles.tab} onClick={() => navigate('/performans-raporu')}>
          İstatistikler
        </button>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statCardHead}>
            <CalendarIcon width={14} height={14} />
            <span>Durum</span>
          </div>
          <span className={`${styles.statusPill} ${styles[`statusPill_${status}`]}`}>{STATUS_LABEL[status]}</span>
          <span className={styles.statCardSub}>
            Son güncelleme
            <br />
            {new Date(employee.updated_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statCardHead}>
            <ClockIcon width={14} height={14} />
            <span>Bu Hafta</span>
          </div>
          <span className={styles.statCardValue}>{formatHoursMinutes(weeklyHours)}</span>
          <span className={styles.statCardSub}>Planlanan Süre</span>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statCardHead}>
            <CheckCircleIcon width={14} height={14} />
            <span>Bu Ay</span>
          </div>
          <div className={styles.statCardMiniRow}>
            <div className={styles.statCardMiniItem}>
              <span className={styles.statCardMiniValue}>{completedThisMonth}</span>
              <span className={styles.statCardMiniLabel}>Tamamlandı</span>
            </div>
            <div className={styles.statCardMiniItem}>
              <span className={styles.statCardMiniValue}>{cancelledThisMonth}</span>
              <span className={styles.statCardMiniLabel}>İptal</span>
            </div>
            <div className={styles.statCardMiniItem}>
              <span className={styles.statCardMiniValue}>{noShowThisMonth}</span>
              <span className={styles.statCardMiniLabel}>Gelmedi</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className={styles.sectionHead}>
          <h2>Çalışma Saatleri</h2>
          <button type="button" className={styles.editLink} onClick={() => navigate(`/ekip/${id}/saatler`)}>
            Düzenle
            <PencilIcon width={13} height={13} />
          </button>
        </div>

        <div className={styles.dayPillRow}>
          {WEEK_ORDER.map((day) => (
            <button
              type="button"
              key={day}
              className={day === selectedDay ? styles.dayPillActive : styles.dayPill}
              onClick={() => setSelectedDay(day)}
            >
              {DAY_SHORT[day]}
            </button>
          ))}
        </div>

        {selectedDayInfo.enabled ? (
          <div className={styles.rangeList}>
            <button type="button" className={styles.rangeRow} onClick={() => navigate(`/ekip/${id}/saatler`)}>
              <span className={`${styles.rangeDot} ${styles.rangeDotWork}`} />
              <span className={styles.rangeText}>
                {selectedDayInfo.start} – {selectedDayInfo.end}
              </span>
              <span className={`${styles.rangeBadge} ${styles.rangeBadgeWork}`}>Çalışma</span>
              <ChevronRightIcon width={15} height={15} className={styles.rangeChevron} />
            </button>
            {selectedDayInfo.breaks.map((b, i) => (
              <button type="button" className={styles.rangeRow} key={i} onClick={() => navigate(`/ekip/${id}/saatler`)}>
                <span className={`${styles.rangeDot} ${styles.rangeDotBreak}`} />
                <span className={styles.rangeTextCol}>
                  <span className={styles.rangeText}>
                    {b.start} – {b.end}
                  </span>
                  <span className={styles.rangeSub}>{timeToMinutes(b.end) - timeToMinutes(b.start)} dk mola</span>
                </span>
                <span className={`${styles.rangeBadge} ${styles.rangeBadgeBreak}`}>Mola</span>
                <ChevronRightIcon width={15} height={15} className={styles.rangeChevron} />
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.emptyDay}>Bu gün için çalışma saati tanımlı değil.</p>
        )}

        <button type="button" className={styles.outlineAddBtn} onClick={() => navigate(`/ekip/${id}/saatler`)}>
          <PlusIcon width={15} height={15} /> Saat Ekle
        </button>

        <div className={styles.infoBanner}>
          <InfoIcon width={16} height={16} />
          Haftalık çalışma saatleri tüm randevuların planlanmasında kullanılır.
        </div>
      </div>

      <div className="card">
        <div className={styles.sectionHead}>
          <h2>İzinler</h2>
          <button type="button" className={styles.editLink} onClick={() => navigate(`/ekip/${id}/izinler`)}>
            Düzenle
            <PencilIcon width={13} height={13} />
          </button>
        </div>

        <div className={styles.leaveFilterToggle}>
          <button
            type="button"
            className={leaveFilter === 'day' ? styles.leaveFilterTabActive : styles.leaveFilterTab}
            onClick={() => setLeaveFilter('day')}
          >
            Günlük İzin
          </button>
          <button
            type="button"
            className={leaveFilter === 'range' ? styles.leaveFilterTabActive : styles.leaveFilterTab}
            onClick={() => setLeaveFilter('range')}
          >
            Yıllık İzin / Tarih Aralığı
          </button>
        </div>

        {visibleLeaves.length === 0 ? (
          <p className={styles.emptyDay}>Bu türde tanımlı izin yok.</p>
        ) : (
          <div className={styles.leaveSummaryList}>
            {visibleLeaves.map((l, i) => {
              const dateObj = new Date(l.date + 'T00:00:00')
              const endObj = new Date(l.endDate + 'T00:00:00')
              const dayCount = Math.round((endObj.getTime() - dateObj.getTime()) / 86400000) + 1
              return (
                <button type="button" className={styles.leaveSummaryRow} key={i} onClick={() => navigate(`/ekip/${id}/izinler`)}>
                  <span className={styles.leaveSummaryIcon}>
                    <CalendarIcon width={16} height={16} />
                  </span>
                  <span className={styles.leaveSummaryText}>
                    <span className={styles.leaveSummaryDate}>
                      {l.mode === 'range'
                        ? `${dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })} - ${endObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                    <span className={styles.leaveSummarySub}>
                      {l.mode === 'range' ? `${dayCount} Gün` : dateObj.toLocaleDateString('tr-TR', { weekday: 'long' })}
                    </span>
                  </span>
                  <span className={styles.leaveSummaryBadge}>{l.mode === 'day' ? 'Günlük İzin' : 'Yıllık İzin'}</span>
                  <MoreHorizontalIcon width={16} height={16} className={styles.leaveSummaryMore} />
                </button>
              )
            })}
          </div>
        )}

        <button type="button" className={styles.outlineAddBtn} onClick={() => navigate(`/ekip/${id}/izinler`)}>
          <PlusIcon width={15} height={15} /> İzin Ekle
        </button>

        <div className={styles.infoBanner}>
          <InfoIcon width={16} height={16} />
          İzinli olduğu günlerde randevu atanamaz.
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Verdiği Hizmetler</h2>
        <div className={styles.categoryCheckboxes}>
          {services.map((s) => {
            const active = empServiceIds.has(s.id)
            return (
              <button
                type="button"
                key={s.id}
                className={active ? styles.categoryChipActive : styles.categoryChip}
                onClick={() => toggleService(s.id, !active)}
              >
                {active ? '✓ ' : ''}
                {s.name}
              </button>
            )
          })}
          {services.length === 0 && <span className={styles.empty}>Önce bir hizmet ekleyin.</span>}
        </div>

        {assignedServices.length > 0 && (
          <div className={styles.employeeTags}>
            {assignedServices.map((s) => (
              <span key={s.id} className={styles.hashtag} style={{ color: colorForName(s.name) }}>
                #{s.name.replace(/\s+/g, '')}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Kişisel Bilgiler</h2>
        <div className={styles.profileField}>
          <label htmlFor="empName">Ad Soyad</label>
          <input id="empName" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Ad Soyad" />
        </div>
        <div className={styles.profileField}>
          <label htmlFor="empPhone">Telefon</label>
          <input
            id="empPhone"
            type="tel"
            inputMode="numeric"
            value={phoneDraft}
            onChange={(e) => setPhoneDraft(e.target.value.replace(/\D/g, ''))}
            placeholder="05xx xxx xx xx"
          />
        </div>
        <div className={styles.profileField}>
          <label htmlFor="empGender">Cinsiyet</label>
          <Select id="empGender" value={genderDraft} onChange={(v) => setGenderDraft(v as '' | 'kadin' | 'erkek')} options={GENDER_OPTIONS} />
        </div>
        {profileError && <p className={styles.profileError}>{profileError}</p>}
        <button
          type="button"
          className={`btn-primary ${styles.profileSaveBtn}`}
          onClick={saveProfileInfo}
          disabled={savingProfile || !nameDraft.trim()}
        >
          {savingProfile ? 'Kaydediliyor…' : 'Kaydet'}
        </button>

        <div className={styles.accountSection}>
          <h3 className={styles.accountTitle}>Hesap Bilgileri</h3>
          <p className={styles.accountHint}>Değiştirmek istemediğin alanı boş bırak.</p>
          <div className={styles.profileField}>
            <label htmlFor="empEmail">Yeni E-posta</label>
            <input
              id="empEmail"
              type="email"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
              placeholder="ayse@ornek.com"
            />
          </div>
          <div className={styles.profileField}>
            <label htmlFor="empPassword">Yeni Şifre</label>
            <input
              id="empPassword"
              type="text"
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.target.value)}
              placeholder="en az 8 karakter"
            />
          </div>
          {accountError && <p className={styles.profileError}>{accountError}</p>}
          {accountSuccess && <p className={styles.accountSuccess}>{accountSuccess}</p>}
          <button
            type="button"
            className={`btn-primary ${styles.profileSaveBtn}`}
            onClick={saveAccountInfo}
            disabled={savingAccount || (!accountEmail.trim() && !accountPassword.trim())}
          >
            {savingAccount ? 'Güncelleniyor…' : 'Hesap Bilgilerini Güncelle'}
          </button>
        </div>
      </div>
    </div>
  )
}
