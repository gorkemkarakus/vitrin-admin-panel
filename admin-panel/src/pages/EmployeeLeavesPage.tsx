import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { TIME_OPTIONS } from '../lib/timeOptions'
import { toLocalDateString } from '../lib/date'
import Avatar from '../components/Avatar'
import { AlertTriangleIcon, CalendarIcon, ChevronRightIcon, PlusIcon, TrashIcon } from '../components/icons'
import styles from './EmployeeLeavesPage.module.css'
import { FIELD_LIMITS } from '../lib/fieldLimits'

interface Employee {
  id: string
  full_name: string | null
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

// Cakisma cozumu icin: izne cikan calisan disindaki aktif calisanlar +
// onlarin musaitligini hesaplamaya yarayan veriler ("aktar"/"esit dagit"
// secenekleri icin ortak aday havuzu — bkz. isCandidateAvailable).
interface OtherProfile {
  id: string
  full_name: string | null
}

interface EmployeeServiceRow {
  profile_id: string
  service_id: string
}

interface ScheduleRow {
  profile_id: string
  day_of_week: number
  starts_at: string
  ends_at: string
}

interface OtherTimeBlockRow {
  profile_id: string
  day_of_week: number | null
  block_date: string | null
  end_date: string | null
  starts_at: string
  ends_at: string
}

interface OtherAppointmentRow {
  id: string
  employee_id: string | null
  scheduled_at: string
  duration_minutes: number | null
}

interface ConflictAppointment {
  id: string
  customer_id: string | null
  service_id: string | null
  scheduled_at: string
  duration_minutes: number | null
  customerName: string
  serviceName: string
}

// LeaveDraft'ta "id" sadece istemci tarafinda React key + duzenleme takibi
// amacli — "blockId" doluysa DB'deki mevcut bir employee_time_blocks
// satirina karsilik gelir (kaydet'te update), bos ise henuz kaydedilmemis
// yeni bir izindir. Izinler day_of_week DEGIL block_date/end_date ile
// tutulur (tek gunluk ya da tarih araligi).
interface LeaveDraft {
  id: string
  blockId?: string
  mode: 'day' | 'range'
  date: string
  endDate: string
  allDay: boolean
  start: string
  end: string
  label: string
}

const LEAVE_REASON_OPTIONS: { value: 'yillik' | 'mazeret'; label: string }[] = [
  { value: 'yillik', label: 'Yıllık İzin' },
  { value: 'mazeret', label: 'Mazeret İzni' },
]

function todayLocalDateString() {
  return toLocalDateString(new Date())
}

function timeStringToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export default function EmployeeLeavesPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [loading, setLoading] = useState(true)

  // "duzenle -> Kaydet" mantigiyla calisiyor — leaveDrafts sunucudan sadece
  // BIR KERE (leaveReady false iken) dolduruluyor.
  const [leaveDrafts, setLeaveDrafts] = useState<LeaveDraft[]>([])
  const [leaveReady, setLeaveReady] = useState(false)
  const [savingLeaves, setSavingLeaves] = useState(false)
  const [leaveJsonCopied, setLeaveJsonCopied] = useState(false)

  const [leaveMode, setLeaveMode] = useState<'day' | 'range'>('day')
  const [leaveDate, setLeaveDate] = useState(todayLocalDateString())
  const [leaveEndDate, setLeaveEndDate] = useState('')
  const [leaveAllDay, setLeaveAllDay] = useState(true)
  const [leaveStart, setLeaveStart] = useState('')
  const [leaveEnd, setLeaveEnd] = useState('')
  const [leaveReason, setLeaveReason] = useState<'yillik' | 'mazeret'>('yillik')
  const [leaveLabel, setLeaveLabel] = useState('Yıllık İzin')

  // Cakisma kontrolu + cozum modali
  const [checkingConflicts, setCheckingConflicts] = useState(false)
  const [conflictModalOpen, setConflictModalOpen] = useState(false)
  const [conflicts, setConflicts] = useState<ConflictAppointment[]>([])
  const [conflictAction, setConflictAction] = useState<'transfer' | 'distribute' | null>(null)
  const [transferTargetId, setTransferTargetId] = useState('')
  const [resolving, setResolving] = useState(false)
  const [otherProfiles, setOtherProfiles] = useState<OtherProfile[]>([])
  const [employeeServices, setEmployeeServices] = useState<EmployeeServiceRow[]>([])
  const [otherSchedules, setOtherSchedules] = useState<ScheduleRow[]>([])
  const [otherTimeBlocks, setOtherTimeBlocks] = useState<OtherTimeBlockRow[]>([])
  const [otherAppointments, setOtherAppointments] = useState<OtherAppointmentRow[]>([])

  async function loadData(silent = false) {
    if (!id) return
    if (!silent) setLoading(true)
    const [{ data: emp }, { data: blocks }] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('id', id).maybeSingle(),
      supabase
        .from('employee_time_blocks')
        .select('id, profile_id, day_of_week, block_date, end_date, starts_at, ends_at, label')
        .eq('profile_id', id),
    ])
    setEmployee(emp ?? null)
    setTimeBlocks(blocks ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (loading || leaveReady) return
    setLeaveDrafts(
      timeBlocks
        .filter((b) => b.day_of_week === null)
        .map((b) => ({
          id: b.id,
          blockId: b.id,
          mode: b.end_date && b.end_date !== b.block_date ? 'range' : 'day',
          date: b.block_date ?? '',
          endDate: b.end_date ?? b.block_date ?? '',
          allDay: b.starts_at.slice(0, 5) <= '00:05' && b.ends_at.slice(0, 5) >= '23:55',
          start: b.starts_at.slice(0, 5),
          end: b.ends_at.slice(0, 5),
          label: b.label ?? '',
        })),
    )
    setLeaveReady(true)
  }, [loading, leaveReady, timeBlocks])

  function addLeaveDraft() {
    if (!leaveDate) return
    if (!leaveAllDay && (!leaveStart || !leaveEnd)) return
    const newDraft: LeaveDraft = {
      id: crypto.randomUUID(),
      mode: leaveMode,
      date: leaveDate,
      endDate: leaveMode === 'range' ? leaveEndDate || leaveDate : leaveDate,
      allDay: leaveAllDay,
      start: leaveAllDay ? '00:00' : leaveStart,
      end: leaveAllDay ? '23:59' : leaveEnd,
      label: leaveLabel.trim(),
    }
    setLeaveDrafts((prev) => [...prev, newDraft])
    setLeaveMode('day')
    setLeaveDate(todayLocalDateString())
    setLeaveEndDate('')
    setLeaveAllDay(true)
    setLeaveStart('')
    setLeaveEnd('')
    setLeaveReason('yillik')
    setLeaveLabel('Yıllık İzin')
  }

  function removeLeaveDraft(draftId: string) {
    setLeaveDrafts((prev) => prev.filter((d) => d.id !== draftId))
  }

  function leavesJson() {
    return JSON.stringify(
      leaveDrafts.map((d) => ({
        baslangic: d.date,
        bitis: d.mode === 'range' ? d.endDate : d.date,
        tumGunKapali: d.allDay,
        baslangicSaati: d.allDay ? null : d.start,
        bitisSaati: d.allDay ? null : d.end,
        etiket: d.label || null,
      })),
      null,
      2,
    )
  }

  function copyLeavesJson() {
    navigator.clipboard.writeText(leavesJson())
    setLeaveJsonCopied(true)
    setTimeout(() => setLeaveJsonCopied(false), 2000)
  }

  async function saveLeaves() {
    if (!id) return
    setSavingLeaves(true)
    const keepIds = new Set(leaveDrafts.filter((d) => d.blockId).map((d) => d.blockId))
    const existingLeaveBlocks = timeBlocks.filter((b) => b.day_of_week === null)
    const ops: PromiseLike<unknown>[] = []
    for (const b of existingLeaveBlocks) {
      if (!keepIds.has(b.id)) ops.push(supabase.from('employee_time_blocks').delete().eq('id', b.id))
    }
    for (const d of leaveDrafts) {
      if (d.blockId) continue
      ops.push(
        supabase.from('employee_time_blocks').insert({
          profile_id: id,
          day_of_week: null,
          block_date: d.date,
          end_date: d.endDate || d.date,
          starts_at: d.start,
          ends_at: d.end,
          label: d.label || null,
        }),
      )
    }
    await Promise.all(ops)
    setLeaveReady(false)
    await loadData(true)
    setSavingLeaves(false)
  }

  // Sadece henuz kaydedilmemis (blockId'siz) yeni taslaklarin tarih/saat
  // araligini kapsayan tek bir pencere dondurur — mevcut/dokunulmayan
  // izinler icin cakisma tekrar kontrol edilmez.
  function draftDateRange() {
    const newDrafts = leaveDrafts.filter((d) => !d.blockId)
    if (newDrafts.length === 0) return null
    const dates = newDrafts.flatMap((d) => [d.date, d.endDate || d.date])
    return { min: dates.reduce((a, b) => (b < a ? b : a)), max: dates.reduce((a, b) => (b > a ? b : a)) }
  }

  async function findConflicts(range: { min: string; max: string }): Promise<ConflictAppointment[]> {
    if (!id) return []
    const newDrafts = leaveDrafts.filter((d) => !d.blockId)

    const { data: appts } = await supabase
      .from('appointments')
      .select('id, customer_id, service_id, scheduled_at, duration_minutes, status')
      .eq('employee_id', id)
      .neq('status', 'iptal')
      .gte('scheduled_at', `${range.min}T00:00:00`)
      .lte('scheduled_at', `${range.max}T23:59:59`)

    const inRange = (appts ?? []).filter((a) => {
      const start = new Date(a.scheduled_at)
      const dateStr = toLocalDateString(start)
      const startMinutes = start.getHours() * 60 + start.getMinutes()
      const endMinutes = startMinutes + (a.duration_minutes ?? 30)
      return newDrafts.some((d) => {
        const dEnd = d.endDate || d.date
        if (dateStr < d.date || dateStr > dEnd) return false
        return timeStringToMinutes(d.start) < endMinutes && timeStringToMinutes(d.end) > startMinutes
      })
    })
    if (inRange.length === 0) return []

    const customerIds = Array.from(new Set(inRange.map((a) => a.customer_id).filter((v): v is string => !!v)))
    const serviceIds = Array.from(new Set(inRange.map((a) => a.service_id).filter((v): v is string => !!v)))
    const [{ data: custs }, { data: svcs }] = await Promise.all([
      customerIds.length
        ? supabase.from('customers').select('id, full_name').in('id', customerIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      serviceIds.length
        ? supabase.from('services').select('id, name').in('id', serviceIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ])

    return inRange
      .map((a) => ({
        id: a.id,
        customer_id: a.customer_id,
        service_id: a.service_id,
        scheduled_at: a.scheduled_at,
        duration_minutes: a.duration_minutes,
        customerName: custs?.find((c) => c.id === a.customer_id)?.full_name ?? 'Müşteri',
        serviceName: svcs?.find((s) => s.id === a.service_id)?.name ?? 'Hizmet',
      }))
      .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))
  }

  // Aktarma/dagitma secenekleri icin aday havuzu: izne cikan disindaki
  // aktif calisanlar + onlarin musaitligini hesaplamak icin gereken veriler.
  // Cakisma yoksa hic cagrilmiyor (gereksiz sorgu yok).
  async function loadResolutionPool(range: { min: string; max: string }) {
    const [{ data: profs }, { data: svcAssignments }, { data: scheds }, { data: blocks }, { data: appts }] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('is_active', true).neq('id', id ?? ''),
      supabase.from('employee_services').select('profile_id, service_id'),
      supabase.from('employee_schedules').select('profile_id, day_of_week, starts_at, ends_at'),
      supabase.from('employee_time_blocks').select('profile_id, day_of_week, block_date, end_date, starts_at, ends_at'),
      fetchAll(() => supabase
        .from('appointments')
        .select('id, employee_id, scheduled_at, duration_minutes, status')
        .neq('status', 'iptal')
        .gte('scheduled_at', `${range.min}T00:00:00`)
        .lte('scheduled_at', `${range.max}T23:59:59`).order('id')),
    ])
    setOtherProfiles(profs ?? [])
    setEmployeeServices(svcAssignments ?? [])
    setOtherSchedules(scheds ?? [])
    setOtherTimeBlocks(blocks ?? [])
    setOtherAppointments(appts ?? [])
  }

  // AppointmentsPage.tsx'teki isEmployeeAvailable'in ayni uc kontrolunun
  // (calisma saati / izin-mola / mevcut randevu cakismasi) bu sayfaya
  // ozel, salt-okunur bir kopyasi — burada baska bir calisanin belirli bir
  // randevu saatini devralip devralamayacagini test etmek icin kullanilir.
  function isCandidateAvailable(profileId: string, scheduledAt: string, durationMinutes: number | null) {
    const start = new Date(scheduledAt)
    const dayOfWeek = start.getDay()
    const startMinutes = start.getHours() * 60 + start.getMinutes()
    const endMinutes = startMinutes + (durationMinutes ?? 30)

    const worksThen = otherSchedules.some(
      (s) =>
        s.profile_id === profileId &&
        s.day_of_week === dayOfWeek &&
        timeStringToMinutes(s.starts_at.slice(0, 5)) <= startMinutes &&
        timeStringToMinutes(s.ends_at.slice(0, 5)) >= endMinutes,
    )
    if (!worksThen) return false

    const dateStr = toLocalDateString(start)
    const isBlocked = otherTimeBlocks.some(
      (b) =>
        b.profile_id === profileId &&
        (b.day_of_week === dayOfWeek ||
          (b.block_date !== null && b.block_date <= dateStr && dateStr <= (b.end_date ?? b.block_date))) &&
        timeStringToMinutes(b.starts_at.slice(0, 5)) < endMinutes &&
        timeStringToMinutes(b.ends_at.slice(0, 5)) > startMinutes,
    )
    if (isBlocked) return false

    const end = new Date(start.getTime() + (durationMinutes ?? 30) * 60000)
    const hasConflict = otherAppointments.some((a) => {
      if (a.employee_id !== profileId) return false
      const aStart = new Date(a.scheduled_at)
      const aEnd = new Date(aStart.getTime() + (a.duration_minutes ?? 30) * 60000)
      return aStart < end && aEnd > start
    })
    return !hasConflict
  }

  // Randevunun hizmetine (employee_services) atanmis calisanlara daraltir —
  // AppointmentsPage.tsx'teki eligibleEmployees ile ayni desen: bu hizmete
  // hic kimse atanmamissa aday havuzu bos kalir (fallback yok, kasitli).
  function candidatesFor(conflict: ConflictAppointment) {
    if (!conflict.service_id) return otherProfiles
    const matchIds = new Set(
      employeeServices.filter((es) => es.service_id === conflict.service_id).map((es) => es.profile_id),
    )
    return otherProfiles.filter((p) => matchIds.has(p.id))
  }

  function availableCandidatesFor(conflict: ConflictAppointment) {
    return candidatesFor(conflict).filter((p) => isCandidateAvailable(p.id, conflict.scheduled_at, conflict.duration_minutes))
  }

  // Her cakisan randevu icin GERCEKTEN musait aday havuzu uzerinden
  // round-robin dagitim onerisi — havuz aynı olan randevular kendi
  // aralarinda sirayla donerken, farkli kategori/havuzdaki randevular
  // birbirini etkilemez. Musait aday olmayan randevu "atanmadi" kalir.
  const distributionPlan = useMemo(() => {
    if (conflictAction !== 'distribute') return []
    const cursors = new Map<string, number>()
    return conflicts.map((c) => {
      const avail = availableCandidatesFor(c)
      if (avail.length === 0) return { conflict: c, assignedId: null as string | null, assignedName: null as string | null }
      const key = avail
        .map((p) => p.id)
        .sort()
        .join(',')
      const idx = cursors.get(key) ?? 0
      const chosen = avail[idx % avail.length]
      cursors.set(key, idx + 1)
      return { conflict: c, assignedId: chosen.id, assignedName: chosen.full_name }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictAction, conflicts, otherProfiles, employeeServices, otherSchedules, otherTimeBlocks, otherAppointments])

  async function handleSaveClick() {
    const range = draftDateRange()
    if (!range) {
      await saveLeaves()
      return
    }
    setCheckingConflicts(true)
    const found = await findConflicts(range)
    if (found.length === 0) {
      setCheckingConflicts(false)
      await saveLeaves()
      return
    }
    await loadResolutionPool(range)
    setConflicts(found)
    setConflictAction(null)
    setTransferTargetId('')
    setCheckingConflicts(false)
    setConflictModalOpen(true)
  }

  async function confirmResolution() {
    setResolving(true)
    if (conflictAction === 'transfer' && transferTargetId) {
      await supabase
        .from('appointments')
        .update({ employee_id: transferTargetId })
        .in(
          'id',
          conflicts.map((c) => c.id),
        )
    } else if (conflictAction === 'distribute') {
      for (const item of distributionPlan) {
        if (item.assignedId) {
          await supabase.from('appointments').update({ employee_id: item.assignedId }).eq('id', item.conflict.id)
        }
      }
    }
    setConflictModalOpen(false)
    await saveLeaves()
    setResolving(false)
  }

  async function skipResolution() {
    setConflictModalOpen(false)
    await saveLeaves()
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
  if (!employee) return <p style={{ color: 'var(--text-dim)' }}>Ekip üyesi bulunamadı.</p>

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.backBtn} onClick={() => navigate(`/ekip/${id}`)}>
        <ChevronRightIcon width={14} height={14} className={styles.backIcon} />
        {employee.full_name ?? 'Çalışana'} Dön
      </button>

      <div className={styles.pageHeader}>
        <Avatar name={employee.full_name ?? '?'} size={36} />
        <div>
          <h1 className={styles.pageTitle}>İzinli Günler</h1>
          <span className={styles.pageSubtitle}>{employee.full_name ?? '—'}</span>
        </div>
      </div>

      <div className="card">
        <p className={styles.subtitle}>Yıllık izin veya tek günlük kapanışları buradan tanımla. Bu günlerde randevu alınamaz.</p>

        <div className={styles.leaveModeToggle}>
          <button
            type="button"
            className={leaveMode === 'day' ? styles.leaveModeTabActive : styles.leaveModeTab}
            onClick={() => setLeaveMode('day')}
          >
            Tek gün
          </button>
          <button
            type="button"
            className={leaveMode === 'range' ? styles.leaveModeTabActive : styles.leaveModeTab}
            onClick={() => setLeaveMode('range')}
          >
            Tarih aralığı
          </button>
        </div>

        <div className={styles.leaveField}>
          <label>{leaveMode === 'range' ? 'Başlangıç Tarihi' : 'Tarih'}</label>
          <input type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} />
        </div>

        {leaveMode === 'range' && (
          <div className={styles.leaveField}>
            <label>Bitiş Tarihi</label>
            <input
              type="date"
              min={leaveDate || undefined}
              value={leaveEndDate}
              onChange={(e) => setLeaveEndDate(e.target.value)}
            />
          </div>
        )}

        <div className={styles.leaveAllDayRow}>
          <label className={styles.switch}>
            <input type="checkbox" checked={leaveAllDay} onChange={() => setLeaveAllDay((v) => !v)} />
            <span className={styles.switchTrack} />
          </label>
          <span>Tüm gün kapalı</span>
        </div>

        {!leaveAllDay && (
          <div className={styles.timeRow} style={{ marginBottom: 16 }}>
            <div className={styles.timeField}>
              <label>Başlangıç</label>
              <select value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)}>
                <option value="">--:--</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <span className={styles.timeSep}>–</span>
            <div className={styles.timeField}>
              <label>Bitiş</label>
              <select value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)}>
                <option value="">--:--</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className={styles.leaveReasonRow}>
          {LEAVE_REASON_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              className={leaveReason === opt.value ? styles.leaveReasonChipActive : styles.leaveReasonChip}
              onClick={() => {
                setLeaveReason(opt.value)
                setLeaveLabel(opt.label)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className={styles.leaveLabelField}>
          <label>Etiket (opsiyonel)</label>
          <input maxLength={FIELD_LIMITS.employeeTimeBlocksLabel} value={leaveLabel} onChange={(e) => setLeaveLabel(e.target.value)} placeholder="ör. Yıllık İzin" />
        </div>

        <button type="button" className={`btn-primary ${styles.addLeaveBtn}`} onClick={addLeaveDraft}>
          <PlusIcon width={15} height={15} /> İzin Ekle
        </button>

        <div className={styles.leaveListLabel}>Tanımlı İzinler</div>

        {leaveDrafts.length === 0 ? (
          <div className={styles.leaveEmpty}>
            <CalendarIcon width={22} height={22} />
            Henüz izin günü eklenmedi.
          </div>
        ) : (
          <div className={styles.leaveList}>
            {leaveDrafts.map((d) => (
              <div className={styles.leaveRow} key={d.id}>
                <div>
                  <div className={styles.leaveRowDate}>
                    {d.mode === 'range' && d.endDate !== d.date
                      ? `${new Date(d.date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} – ${new Date(d.endDate + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}`
                      : new Date(d.date + 'T00:00:00').toLocaleDateString('tr-TR', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                  </div>
                  <div className={styles.leaveRowMeta}>
                    {d.allDay ? 'Tüm gün kapalı' : `${d.start} – ${d.end}`}
                    {d.label ? ` • ${d.label}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.leaveRemoveBtn}
                  onClick={() => removeLeaveDraft(d.id)}
                  aria-label="İzni kaldır"
                >
                  <TrashIcon width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.leaveFooter}>
          <span className={styles.leaveFooterSummary}>
            {leaveDrafts.length === 0 ? 'İzin tanımlı değil' : `${leaveDrafts.length} izin tanımlı`}
          </span>
          <div className={styles.leaveFooterActions}>
            <button type="button" className={styles.jsonLink} onClick={copyLeavesJson}>
              {leaveJsonCopied ? 'Kopyalandı ✓' : 'JSON çıktısı'}
            </button>
            <button
              type="button"
              className={`btn-primary ${styles.saveBtn}`}
              onClick={handleSaveClick}
              disabled={savingLeaves || checkingConflicts}
            >
              {checkingConflicts ? 'Kontrol ediliyor…' : savingLeaves ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>

      {conflictModalOpen && (
        <div className={styles.conflictBackdrop}>
          <div className={`card ${styles.conflictCard}`}>
            <div className={styles.conflictHeader}>
              <span className={styles.conflictHeaderIcon}>
                <AlertTriangleIcon width={18} height={18} />
              </span>
              <div>
                <div className={styles.conflictTitle}>{conflicts.length} randevu bu izinle çakışıyor</div>
                <div className={styles.conflictSubtitle}>Bu randevularla ne yapmak istersiniz?</div>
              </div>
            </div>

            <div className={styles.conflictList}>
              {conflicts.map((c) => {
                const plan = distributionPlan.find((d) => d.conflict.id === c.id)
                return (
                  <div className={styles.conflictRow} key={c.id}>
                    <div className={styles.conflictRowMain}>
                      <span className={styles.conflictRowCustomer}>{c.customerName}</span>
                      <span className={styles.conflictRowService}>{c.serviceName}</span>
                    </div>
                    <div className={styles.conflictRowRight}>
                      <span className={styles.conflictRowDate}>
                        {new Date(c.scheduled_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                        {' · '}
                        {new Date(c.scheduled_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {conflictAction === 'distribute' && (
                        <span className={plan?.assignedName ? styles.conflictRowAssign : styles.conflictRowAssignWarn}>
                          {plan?.assignedName ? `→ ${plan.assignedName}` : '⚠ Uygun çalışan yok'}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className={styles.conflictActions}>
              <button
                type="button"
                className={conflictAction === 'transfer' ? styles.conflictActionBtnActive : styles.conflictActionBtn}
                onClick={() => setConflictAction('transfer')}
              >
                Belirli bir çalışana aktar
              </button>
              <button
                type="button"
                className={conflictAction === 'distribute' ? styles.conflictActionBtnActive : styles.conflictActionBtn}
                onClick={() => setConflictAction('distribute')}
              >
                Çalışanlar arasında eşit dağıt
              </button>
            </div>

            {conflictAction === 'transfer' && (
              <div className={styles.leaveField}>
                <label>Aktarılacak çalışan</label>
                <select
                  className={styles.conflictSelect}
                  value={transferTargetId}
                  onChange={(e) => setTransferTargetId(e.target.value)}
                >
                  <option value="">Seçin…</option>
                  {otherProfiles.map((p) => {
                    const riskCount = conflicts.filter((c) => !isCandidateAvailable(p.id, c.scheduled_at, c.duration_minutes)).length
                    return (
                      <option key={p.id} value={p.id}>
                        {p.full_name ?? '—'}
                        {riskCount > 0 ? ` (${riskCount} çakışma riski)` : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
            )}

            <div className={styles.conflictFooter}>
              <button type="button" className={styles.conflictSkipBtn} onClick={skipResolution} disabled={resolving}>
                Şimdilik atla
              </button>
              <button
                type="button"
                className={`btn-primary ${styles.conflictConfirmBtn}`}
                onClick={confirmResolution}
                disabled={resolving || !conflictAction || (conflictAction === 'transfer' && !transferTargetId)}
              >
                {resolving
                  ? 'Kaydediliyor…'
                  : conflictAction === 'transfer'
                    ? 'Aktar ve İzni Kaydet'
                    : conflictAction === 'distribute'
                      ? 'Dağıt ve İzni Kaydet'
                      : 'Onayla'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
