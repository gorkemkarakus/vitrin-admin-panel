import { useEffect, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TIME_OPTIONS } from '../lib/timeOptions'
import type { LayoutOutletContext } from '../layouts/DashboardLayout'
import Avatar, { colorForName } from '../components/Avatar'
import { TrashIcon } from '../components/icons'
import styles from './TeamPage.module.css'

interface Category {
  id: string
  name: string
}

interface Service {
  id: string
  name: string
  category_id: string | null
  duration_minutes: number
  price: number | null
}

interface Employee {
  id: string
  full_name: string | null
}

interface EmployeeCategory {
  profile_id: string
  category_id: string
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
  starts_at: string
  ends_at: string
  label: string | null
}

const DAY_LABELS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
// Haftanin gorsel sirasi: Pazartesi'den basla, Pazar'la bitir (DAY_LABELS'daki
// index'ler Postgres EXTRACT(DOW) kuralina gore: 0=Pazar).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKEND = [6, 0]

const currency = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })

export default function TeamPage() {
  const navigate = useNavigate()
  const { searchQuery, setSearchPlaceholder } = useOutletContext<LayoutOutletContext>()
  const [categories, setCategories] = useState<Category[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeCategories, setEmployeeCategories] = useState<EmployeeCategory[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])
  const [loading, setLoading] = useState(true)

  const [scheduleDraft, setScheduleDraft] = useState<
    Record<string, { days: Set<number>; start: string; end: string }>
  >({})

  const [blockDraft, setBlockDraft] = useState<
    Record<string, { mode: 'day' | 'date'; day: number; date: string; start: string; end: string; label: string }>
  >({})

  function getBlockDraft(profileId: string) {
    return (
      blockDraft[profileId] ?? { mode: 'day' as const, day: 1, date: '', start: '', end: '', label: '' }
    )
  }

  function setBlockDraftFor(
    profileId: string,
    next: { mode: 'day' | 'date'; day: number; date: string; start: string; end: string; label: string },
  ) {
    setBlockDraft((prev) => ({ ...prev, [profileId]: next }))
  }

  function getDraft(profileId: string) {
    return scheduleDraft[profileId] ?? { days: new Set<number>(), start: '', end: '' }
  }

  function setDraft(profileId: string, next: { days: Set<number>; start: string; end: string }) {
    setScheduleDraft((prev) => ({ ...prev, [profileId]: next }))
  }

  function toggleDraftDay(profileId: string, day: number) {
    const draft = getDraft(profileId)
    const days = new Set(draft.days)
    if (days.has(day)) days.delete(day)
    else days.add(day)
    setDraft(profileId, { ...draft, days })
  }

  function applyDraftPreset(profileId: string, preset: number[]) {
    const draft = getDraft(profileId)
    setDraft(profileId, { ...draft, days: new Set(preset) })
  }

  async function loadData() {
    setLoading(true)
    const [{ data: cats }, { data: svcs }, { data: profs }, { data: empCats }, { data: scheds }, { data: blocks }] =
      await Promise.all([
        supabase.from('service_categories').select('id, name').order('name'),
        supabase.from('services').select('id, name, category_id, duration_minutes, price').order('name'),
        supabase.from('profiles').select('id, full_name').order('full_name'),
        supabase.from('employee_categories').select('profile_id, category_id'),
        supabase.from('employee_schedules').select('id, profile_id, day_of_week, starts_at, ends_at'),
        supabase
          .from('employee_time_blocks')
          .select('id, profile_id, day_of_week, block_date, starts_at, ends_at, label'),
      ])
    setCategories(cats ?? [])
    setServices(svcs ?? [])
    setEmployees(profs ?? [])
    setEmployeeCategories(empCats ?? [])
    setSchedules(scheds ?? [])
    setTimeBlocks(blocks ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    setSearchPlaceholder('Personel veya hizmet ara…')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleServiceCategoryChange(serviceId: string, categoryId: string) {
    await supabase
      .from('services')
      .update({ category_id: categoryId || null })
      .eq('id', serviceId)
    await loadData()
  }

  async function toggleEmployeeCategory(profileId: string, categoryId: string, checked: boolean) {
    if (checked) {
      await supabase.from('employee_categories').insert({ profile_id: profileId, category_id: categoryId })
    } else {
      await supabase
        .from('employee_categories')
        .delete()
        .eq('profile_id', profileId)
        .eq('category_id', categoryId)
    }
    await loadData()
  }

  async function addSchedules(profileId: string) {
    const draft = getDraft(profileId)
    if (draft.days.size === 0 || !draft.start || !draft.end) return

    const existingForEmployee = schedules.filter((s) => s.profile_id === profileId)

    await Promise.all(
      Array.from(draft.days).map((day) => {
        const existing = existingForEmployee.find((s) => s.day_of_week === day)
        if (existing) {
          return supabase
            .from('employee_schedules')
            .update({ starts_at: draft.start, ends_at: draft.end })
            .eq('id', existing.id)
        }
        return supabase.from('employee_schedules').insert({
          profile_id: profileId,
          day_of_week: day,
          starts_at: draft.start,
          ends_at: draft.end,
        })
      }),
    )
    setDraft(profileId, { days: new Set(), start: '', end: '' })
    await loadData()
  }

  async function removeSchedule(id: string) {
    await supabase.from('employee_schedules').delete().eq('id', id)
    await loadData()
  }

  async function addBlock(profileId: string) {
    const draft = getBlockDraft(profileId)
    if (!draft.start || !draft.end) return
    if (draft.mode === 'date' && !draft.date) return

    await supabase.from('employee_time_blocks').insert({
      profile_id: profileId,
      day_of_week: draft.mode === 'day' ? draft.day : null,
      block_date: draft.mode === 'date' ? draft.date : null,
      starts_at: draft.start,
      ends_at: draft.end,
      label: draft.label.trim() || null,
    })
    setBlockDraftFor(profileId, { mode: 'day', day: 1, date: '', start: '', end: '', label: '' })
    await loadData()
  }

  async function removeBlock(id: string) {
    await supabase.from('employee_time_blocks').delete().eq('id', id)
    await loadData()
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  return (
    <div className={styles.wrap}>
      <div className={styles.pageHead}>
        <h1>Ekip Yönetimi</h1>
        <p>Çalışan kategorilerinizi, hizmetlerinizi ve programlarınızı tek yerden yönetin.</p>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Hizmet Kategorileri</h2>

        <div className={styles.chipRow}>
          {categories.length === 0 && <span className={styles.empty}>Henüz alan yok</span>}
          {categories.map((c) => (
            <span className={styles.chip} key={c.id}>
              {c.name}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Hizmet Eşleşmeleri</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Hizmet Adı</th>
              <th>Kategori</th>
              <th>Süre</th>
              <th>Fiyat</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  <select
                    value={s.category_id ?? ''}
                    onChange={(e) => handleServiceCategoryChange(s.id, e.target.value)}
                  >
                    <option value="">Alan seçilmedi</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={styles.dimCell}>{s.duration_minutes} dk</td>
                <td className={styles.dimCell}>{s.price != null ? currency.format(s.price) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className={styles.cardHeadRow}>
          <h2>Ekip Üyeleri</h2>
          <button type="button" className="btn-secondary" style={{ width: 'auto' }} onClick={() => navigate('/kullanicilar')}>
            + Yeni Personel
          </button>
        </div>
        <div className={styles.employeeGrid}>
        {(searchQuery.trim()
          ? employees.filter((emp) => (emp.full_name ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase()))
          : employees
        ).map((emp) => {
          const empCategoryIds = new Set(
            employeeCategories.filter((ec) => ec.profile_id === emp.id).map((ec) => ec.category_id),
          )
          const empSchedules = schedules.filter((s) => s.profile_id === emp.id)
          const empBlocks = timeBlocks.filter((b) => b.profile_id === emp.id)
          const draft = getDraft(emp.id)
          const bDraft = getBlockDraft(emp.id)

          return (
            <div className={styles.employeeCard} key={emp.id}>
              <div className={styles.employeeHead}>
                <Avatar name={emp.full_name ?? '?'} size={44} />
                <div>
                  <div className={styles.employeeName}>{emp.full_name ?? '—'}</div>
                  <div className={styles.employeeTags}>
                    {categories
                      .filter((c) => empCategoryIds.has(c.id))
                      .map((c) => (
                        <span key={c.id} className={styles.hashtag} style={{ color: colorForName(c.name) }}>
                          #{c.name.replace(/\s+/g, '')}
                        </span>
                      ))}
                    {empCategoryIds.size === 0 && <span className={styles.hashtagEmpty}>Henüz alan atanmadı</span>}
                  </div>
                </div>
              </div>

              <div className={styles.categoryCheckboxes}>
                {categories.map((c) => {
                  const active = empCategoryIds.has(c.id)
                  return (
                    <button
                      type="button"
                      key={c.id}
                      className={active ? styles.categoryChipActive : styles.categoryChip}
                      onClick={() => toggleEmployeeCategory(emp.id, c.id, !active)}
                    >
                      {active ? '✓ ' : ''}
                      {c.name}
                    </button>
                  )
                })}
                {categories.length === 0 && <span className={styles.empty}>Önce bir alan ekleyin.</span>}
              </div>

              <div className={styles.addScheduleForm}>
                <div className={styles.scheduleHeadRow}>
                  <span className={styles.blockSectionTitle}>Haftalık Çalışma Saatleri</span>
                  <div className={styles.presetRow}>
                    <button type="button" className="btn-secondary" onClick={() => applyDraftPreset(emp.id, WEEKDAYS)}>
                      Hafta İçi
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => applyDraftPreset(emp.id, WEEKEND)}>
                      Hafta Sonu
                    </button>
                  </div>
                </div>

                {empSchedules.length > 0 && (
                  <div className={styles.existingSchedules}>
                    {WEEK_ORDER.map((day) => {
                      const s = empSchedules.find((s) => s.day_of_week === day)
                      if (!s) return null
                      return (
                        <div className={styles.scheduleRow} key={s.id}>
                          <span>
                            <strong>{DAY_SHORT[s.day_of_week]}</strong> {s.starts_at.slice(0, 5)} – {s.ends_at.slice(0, 5)}
                          </span>
                          <button onClick={() => removeSchedule(s.id)}>Kaldır</button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className={styles.presetRow}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => applyDraftPreset(emp.id, WEEK_ORDER)}
                  >
                    Her Gün
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => applyDraftPreset(emp.id, [])}>
                    Temizle
                  </button>
                </div>

                <div className={styles.dayChipRow}>
                  {WEEK_ORDER.map((day) => (
                    <button
                      type="button"
                      key={day}
                      className={draft.days.has(day) ? styles.dayChipActive : styles.dayChip}
                      onClick={() => toggleDraftDay(emp.id, day)}
                    >
                      {DAY_SHORT[day]}
                    </button>
                  ))}
                </div>

                <div className={styles.timeRow}>
                  <div className={styles.timeField}>
                    <label>Başlangıç</label>
                    <select
                      value={draft.start}
                      onChange={(e) => setDraft(emp.id, { ...draft, start: e.target.value })}
                    >
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
                    <select
                      value={draft.end}
                      onChange={(e) => setDraft(emp.id, { ...draft, end: e.target.value })}
                    >
                      <option value="">--:--</option>
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="btn-primary" onClick={() => addSchedules(emp.id)}>
                    {draft.days.size > 1 ? `${draft.days.size} güne ekle` : 'Ekle'}
                  </button>
                </div>
              </div>

              <div className={styles.blockSection}>
                <div className={styles.blockSectionTitle}>Bloke Saatler (Mola/Eğitim)</div>

                {empBlocks.length > 0 && (
                  <div className={styles.existingSchedules}>
                    {empBlocks.map((b) => (
                      <div className={styles.blockRow} key={b.id}>
                        <span>
                          <strong>
                            {b.day_of_week !== null
                              ? DAY_SHORT[b.day_of_week]
                              : new Date(b.block_date + 'T00:00:00').toLocaleDateString('tr-TR', {
                                  day: 'numeric',
                                  month: 'short',
                                })}
                          </strong>{' '}
                          {b.starts_at.slice(0, 5)} – {b.ends_at.slice(0, 5)}
                          {b.label ? ` (${b.label})` : ''}
                        </span>
                        <button className={styles.blockRemove} onClick={() => removeBlock(b.id)} aria-label="Bloke saati kaldır">
                          <TrashIcon width={13} height={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.blockForm}>
                  <div className={styles.blockModeRow}>
                    <button
                      type="button"
                      className={bDraft.mode === 'day' ? styles.dayChipActive : styles.dayChip}
                      onClick={() => setBlockDraftFor(emp.id, { ...bDraft, mode: 'day' })}
                    >
                      Her hafta
                    </button>
                    <button
                      type="button"
                      className={bDraft.mode === 'date' ? styles.dayChipActive : styles.dayChip}
                      onClick={() => setBlockDraftFor(emp.id, { ...bDraft, mode: 'date' })}
                    >
                      Tek tarih
                    </button>
                  </div>

                  {bDraft.mode === 'day' ? (
                    <div className={styles.timeField}>
                      <label>Gün</label>
                      <select
                        value={bDraft.day}
                        onChange={(e) => setBlockDraftFor(emp.id, { ...bDraft, day: Number(e.target.value) })}
                      >
                        {WEEK_ORDER.map((day) => (
                          <option key={day} value={day}>
                            {DAY_LABELS[day]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className={styles.timeField}>
                      <label>Tarih</label>
                      <input
                        type="date"
                        value={bDraft.date}
                        onChange={(e) => setBlockDraftFor(emp.id, { ...bDraft, date: e.target.value })}
                      />
                    </div>
                  )}

                  <div className={styles.timeRow}>
                    <div className={styles.timeField}>
                      <label>Başlangıç</label>
                      <select
                        value={bDraft.start}
                        onChange={(e) => setBlockDraftFor(emp.id, { ...bDraft, start: e.target.value })}
                      >
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
                      <select
                        value={bDraft.end}
                        onChange={(e) => setBlockDraftFor(emp.id, { ...bDraft, end: e.target.value })}
                      >
                        <option value="">--:--</option>
                        {TIME_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <input
                    className={styles.blockLabelInput}
                    placeholder="Etiket (ör. Öğle Molası, Eğitim)"
                    value={bDraft.label}
                    onChange={(e) => setBlockDraftFor(emp.id, { ...bDraft, label: e.target.value })}
                  />

                  <button type="button" className={styles.dashedAddBtn} onClick={() => addBlock(emp.id)}>
                    + Bloke Saat Ekle
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}
