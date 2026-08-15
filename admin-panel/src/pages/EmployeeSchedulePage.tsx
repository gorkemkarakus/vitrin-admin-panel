import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Avatar from '../components/Avatar'
import { ChevronRightIcon, InfoIcon, TrashIcon } from '../components/icons'
import styles from './EmployeeSchedulePage.module.css'

interface Employee {
  id: string
  full_name: string | null
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

// Ogle molasi (BreakDraft) icin "id" sadece istemci tarafinda React key +
// duzenleme takibi amacli — "blockId" doluysa DB'deki mevcut bir
// employee_time_blocks satirina karsilik gelir (kaydet'te update), bos ise
// henuz kaydedilmemis yeni bir moladir (kaydet'te insert).
interface BreakDraft {
  id: string
  blockId?: string
  start: string
  end: string
}

interface DayDraft {
  enabled: boolean
  start: string
  end: string
  breaks: BreakDraft[]
}

const BREAK_LABEL = 'Öğle molası'
const DAY_LABELS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function dayHours(draft: DayDraft): number {
  if (!draft.enabled) return 0
  let minutes = timeToMinutes(draft.end) - timeToMinutes(draft.start)
  for (const b of draft.breaks) minutes -= Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start))
  return Math.max(0, minutes) / 60
}

// 6 saatin altindaki calisma gunleri "Kisa Calisma" olarak etiketlenir —
// ör. Cumartesi 10:00-15:00 gibi yarim gun mesailer icin.
const SHORT_DAY_THRESHOLD_HOURS = 6

function dayStatus(draft: DayDraft): { dot: 'calisma' | 'kisa' | 'yok'; label: string } {
  if (!draft.enabled) return { dot: 'yok', label: 'Çalışma Yok' }
  if (dayHours(draft) < SHORT_DAY_THRESHOLD_HOURS) return { dot: 'kisa', label: 'Kısa Çalışma' }
  return { dot: 'calisma', label: 'Çalışma Günü' }
}

function buildDayDrafts(schedules: Schedule[], timeBlocks: TimeBlock[]): Record<number, DayDraft> {
  const map: Record<number, DayDraft> = {}
  for (const day of WEEK_ORDER) {
    const s = schedules.find((x) => x.day_of_week === day)
    const breaks = timeBlocks
      .filter((b) => b.day_of_week === day && b.label === BREAK_LABEL)
      .map((b) => ({ id: b.id, blockId: b.id, start: b.starts_at.slice(0, 5), end: b.ends_at.slice(0, 5) }))
    map[day] = {
      enabled: !!s,
      start: s ? s.starts_at.slice(0, 5) : '09:00',
      end: s ? s.ends_at.slice(0, 5) : '18:00',
      breaks,
    }
  }
  return map
}

export default function EmployeeSchedulePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [loading, setLoading] = useState(true)

  // "duzenle -> Kaydet" mantigiyla calisiyor (eskiden her tiklamada aninda
  // kaydediliyordu). dayDrafts sunucudan sadece BIR KERE (scheduleReady
  // false iken) dolduruluyor.
  const [dayDrafts, setDayDrafts] = useState<Record<number, DayDraft>>({})
  const [scheduleReady, setScheduleReady] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [jsonCopied, setJsonCopied] = useState(false)

  async function loadData(silent = false) {
    if (!id) return
    if (!silent) setLoading(true)
    const [{ data: emp }, { data: scheds }, { data: blocks }] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('id', id).maybeSingle(),
      supabase.from('employee_schedules').select('id, profile_id, day_of_week, starts_at, ends_at').eq('profile_id', id),
      supabase
        .from('employee_time_blocks')
        .select('id, profile_id, day_of_week, block_date, end_date, starts_at, ends_at, label')
        .eq('profile_id', id),
    ])
    setEmployee(emp ?? null)
    setSchedules(scheds ?? [])
    setTimeBlocks(blocks ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (loading || scheduleReady) return
    setDayDrafts(buildDayDrafts(schedules, timeBlocks))
    setScheduleReady(true)
  }, [loading, scheduleReady, schedules, timeBlocks])

  function updateDay(day: number, patch: Partial<Pick<DayDraft, 'start' | 'end'>>) {
    setDayDrafts((prev) => {
      const current = prev[day]
      if (!current) return prev
      return { ...prev, [day]: { ...current, ...patch } }
    })
  }

  function toggleDayEnabled(day: number) {
    setDayDrafts((prev) => {
      const current = prev[day]
      if (!current) return prev
      return { ...prev, [day]: { ...current, enabled: !current.enabled } }
    })
  }

  function addBreak(day: number) {
    setDayDrafts((prev) => {
      const current = prev[day]
      if (!current) return prev
      const newBreak: BreakDraft = { id: crypto.randomUUID(), start: '12:00', end: '13:00' }
      return { ...prev, [day]: { ...current, breaks: [...current.breaks, newBreak] } }
    })
  }

  function removeBreak(day: number, breakId: string) {
    setDayDrafts((prev) => {
      const current = prev[day]
      if (!current) return prev
      return { ...prev, [day]: { ...current, breaks: current.breaks.filter((b) => b.id !== breakId) } }
    })
  }

  function updateBreak(day: number, breakId: string, patch: Partial<Pick<BreakDraft, 'start' | 'end'>>) {
    setDayDrafts((prev) => {
      const current = prev[day]
      if (!current) return prev
      return { ...prev, [day]: { ...current, breaks: current.breaks.map((b) => (b.id === breakId ? { ...b, ...patch } : b)) } }
    })
  }

  async function saveWeeklySchedule() {
    if (!id) return
    setSavingSchedule(true)
    const ops: PromiseLike<unknown>[] = []

    for (const day of WEEK_ORDER) {
      const draft = dayDrafts[day]
      if (!draft) continue
      const existingSchedule = schedules.find((s) => s.day_of_week === day)
      const existingBreaks = timeBlocks.filter((b) => b.day_of_week === day && b.label === BREAK_LABEL)

      if (!draft.enabled) {
        if (existingSchedule) ops.push(supabase.from('employee_schedules').delete().eq('id', existingSchedule.id))
        for (const b of existingBreaks) ops.push(supabase.from('employee_time_blocks').delete().eq('id', b.id))
        continue
      }

      if (existingSchedule) {
        ops.push(
          supabase.from('employee_schedules').update({ starts_at: draft.start, ends_at: draft.end }).eq('id', existingSchedule.id),
        )
      } else {
        ops.push(
          supabase.from('employee_schedules').insert({ profile_id: id, day_of_week: day, starts_at: draft.start, ends_at: draft.end }),
        )
      }

      const keepIds = new Set(draft.breaks.filter((b) => b.blockId).map((b) => b.blockId))
      for (const b of existingBreaks) {
        if (!keepIds.has(b.id)) ops.push(supabase.from('employee_time_blocks').delete().eq('id', b.id))
      }
      for (const b of draft.breaks) {
        if (b.blockId) {
          const existing = existingBreaks.find((x) => x.id === b.blockId)
          if (existing && (existing.starts_at.slice(0, 5) !== b.start || existing.ends_at.slice(0, 5) !== b.end)) {
            ops.push(supabase.from('employee_time_blocks').update({ starts_at: b.start, ends_at: b.end }).eq('id', b.blockId))
          }
        } else {
          ops.push(
            supabase.from('employee_time_blocks').insert({
              profile_id: id,
              day_of_week: day,
              block_date: null,
              end_date: null,
              starts_at: b.start,
              ends_at: b.end,
              label: BREAK_LABEL,
            }),
          )
        }
      }
    }

    await Promise.all(ops)
    setScheduleReady(false)
    await loadData(true)
    setSavingSchedule(false)
  }

  function scheduleJson() {
    return JSON.stringify(
      WEEK_ORDER.map((day) => {
        const draft = dayDrafts[day]
        return {
          gun: DAY_LABELS[day],
          acik: draft?.enabled ?? false,
          baslangic: draft?.enabled ? draft.start : null,
          bitis: draft?.enabled ? draft.end : null,
          molalar: draft?.enabled ? draft.breaks.map((b) => ({ baslangic: b.start, bitis: b.end })) : [],
        }
      }),
      null,
      2,
    )
  }

  function copyJson() {
    navigator.clipboard.writeText(scheduleJson())
    setJsonCopied(true)
    setTimeout(() => setJsonCopied(false), 2000)
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
  if (!employee) return <p style={{ color: 'var(--text-dim)' }}>Ekip üyesi bulunamadı.</p>

  const openDaysCount = WEEK_ORDER.filter((day) => dayDrafts[day]?.enabled).length

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.backBtn} onClick={() => navigate(`/ekip/${id}`)}>
        <ChevronRightIcon width={14} height={14} className={styles.backIcon} />
        {employee.full_name ?? 'Çalışana'} Dön
      </button>

      <div className={styles.pageHeader}>
        <Avatar name={employee.full_name ?? '?'} size={36} />
        <div>
          <h1 className={styles.pageTitle}>Çalışma Saatleri</h1>
          <span className={styles.pageSubtitle}>{employee.full_name ?? '—'}</span>
        </div>
      </div>

      <div className={styles.infoBanner}>
        <InfoIcon width={16} height={16} />
        Belirlediğiniz saatler online randevu alımına açık olacaktır.
      </div>

      <div className="card">
        <div className={styles.scheduleColumnHeader}>
          <span className={styles.scheduleColumnHeaderDay}>Günler</span>
          <span>Çalışma Saatleri</span>
        </div>

        {!scheduleReady ? (
          <p style={{ color: 'var(--text-dim)', marginTop: 16 }}>Yükleniyor…</p>
        ) : (
          <>
            <div className={styles.dayList}>
              {WEEK_ORDER.map((day) => {
                const draft = dayDrafts[day]
                if (!draft) return null
                const status = dayStatus(draft)

                if (!draft.enabled) {
                  return (
                    <div className={styles.dayOffRow} key={day}>
                      <div className={styles.dayInfo}>
                        <span className={styles.dayName}>{DAY_LABELS[day]}</span>
                        <span className={styles.dayStatus}>
                          <span className={`${styles.dayStatusDot} ${styles[`dayStatusDot_${status.dot}`]}`} />
                          {status.label}
                        </span>
                      </div>
                      <label className={styles.switch}>
                        <input type="checkbox" checked={false} onChange={() => toggleDayEnabled(day)} />
                        <span className={styles.switchTrack} />
                      </label>
                    </div>
                  )
                }

                return (
                  <div className={styles.dayRow} key={day}>
                    <div className={styles.dayRowTop}>
                      <div className={styles.dayInfo}>
                        <span className={styles.dayName}>{DAY_LABELS[day]}</span>
                        <span className={styles.dayStatus}>
                          <span className={`${styles.dayStatusDot} ${styles[`dayStatusDot_${status.dot}`]}`} />
                          {status.label}
                        </span>
                      </div>

                      <div className={styles.dayRangesCol}>
                        <div className={styles.rangeGroup}>
                          <span className={styles.rangeLabel}>Çalışma</span>
                          <div className={styles.dayTimesRow}>
                            <input
                              type="time"
                              className={styles.timeInput}
                              value={draft.start}
                              onChange={(e) => updateDay(day, { start: e.target.value })}
                            />
                            <span className={styles.timeSep}>–</span>
                            <input
                              type="time"
                              className={styles.timeInput}
                              value={draft.end}
                              onChange={(e) => updateDay(day, { end: e.target.value })}
                            />
                          </div>
                        </div>

                        {draft.breaks.map((b) => (
                          <div className={styles.rangeGroup} key={b.id}>
                            <span className={`${styles.rangeLabel} ${styles.rangeLabelBreak}`}>Mola</span>
                            <div className={styles.dayTimesRow}>
                              <input
                                type="time"
                                className={styles.timeInput}
                                value={b.start}
                                onChange={(e) => updateBreak(day, b.id, { start: e.target.value })}
                              />
                              <span className={styles.timeSep}>–</span>
                              <input
                                type="time"
                                className={styles.timeInput}
                                value={b.end}
                                onChange={(e) => updateBreak(day, b.id, { end: e.target.value })}
                              />
                              <button
                                type="button"
                                className={styles.extraRangeRemove}
                                onClick={() => removeBreak(day, b.id)}
                                aria-label="Molayı kaldır"
                              >
                                <TrashIcon width={13} height={13} />
                              </button>
                            </div>
                          </div>
                        ))}

                        <button type="button" className={styles.addBreakBtn} onClick={() => addBreak(day)}>
                          + Ara Ekle
                        </button>
                      </div>

                      <label className={styles.switch}>
                        <input type="checkbox" checked={draft.enabled} onChange={() => toggleDayEnabled(day)} />
                        <span className={styles.switchTrack} />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className={styles.scheduleFooter}>
              <span className={styles.scheduleFooterSummary}>{openDaysCount} gün açık</span>
              <div className={styles.scheduleFooterActions}>
                <button type="button" className={styles.jsonLink} onClick={copyJson}>
                  {jsonCopied ? 'Kopyalandı ✓' : 'JSON çıktısı'}
                </button>
                <button
                  type="button"
                  className={`btn-primary ${styles.saveBtn}`}
                  onClick={saveWeeklySchedule}
                  disabled={savingSchedule}
                >
                  {savingSchedule ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
