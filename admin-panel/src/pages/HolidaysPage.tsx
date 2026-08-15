import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { AlertTriangleIcon, CalendarIcon, ChevronRightIcon, TrashIcon, UmbrellaIcon } from '../components/icons'
import styles from './HolidaysPage.module.css'

// Resmi tatiller ayri bir tablo yerine mevcut employee_time_blocks
// altyapisi uzerinden, HER AKTIF CALISAN icin ayni tarih/etiketle tek tek
// satir eklenerek uygulaniyor — boylece randevu musaitligini kontrol eden
// tum edge function'lar (booking, public-booking-info...) hicbir degisiklik
// gerekmeden bu tatilleri otomatik olarak dikkate aliyor (zaten calisan
// bazli employee_time_blocks okuyorlar). "Resmi Tatil" etiketi bu satirlari
// kisisel izinlerden (Yillik Izin/Mazeret Izni) ayirt etmek icin kullanilir.
const HOLIDAY_LABEL = 'Resmi Tatil'

interface Holiday {
  date: string
  endDate: string
}

interface HolidayConflict {
  id: string
  employeeName: string
  customerName: string
  serviceName: string
  scheduled_at: string
}

function todayLocalDateString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function HolidaysPage() {
  const navigate = useNavigate()
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [mode, setMode] = useState<'day' | 'range'>('day')
  const [date, setDate] = useState(todayLocalDateString())
  const [endDate, setEndDate] = useState('')
  const [label, setLabel] = useState(HOLIDAY_LABEL)

  const [checkingConflicts, setCheckingConflicts] = useState(false)
  const [conflictWarningOpen, setConflictWarningOpen] = useState(false)
  const [pendingConflicts, setPendingConflicts] = useState<HolidayConflict[]>([])

  async function loadData() {
    setLoading(true)
    const [{ data: profs }, { data: blocks }] = await Promise.all([
      supabase.from('profiles').select('id').eq('is_active', true),
      supabase.from('employee_time_blocks').select('block_date, end_date').eq('label', HOLIDAY_LABEL).is('day_of_week', null),
    ])
    setEmployeeIds((profs ?? []).map((p) => p.id))

    const seen = new Map<string, Holiday>()
    for (const b of blocks ?? []) {
      if (!b.block_date) continue
      const end = b.end_date ?? b.block_date
      seen.set(`${b.block_date}|${end}`, { date: b.block_date, endDate: end })
    }
    setHolidays(Array.from(seen.values()).sort((a, b) => a.date.localeCompare(b.date)))
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  // Resmi tatil TUM aktif calisana ayni anda uygulandigi icin (satir 64-72)
  // devredilecek baska bir calisan yok — bu yuzden burada EmployeeLeavesPage
  // ile ayni "aktar/dagit" akisi yerine sadece bir uyari gosterilir; admin
  // Randevular ekranindan elle iptal/tasima yapar.
  async function findHolidayConflicts(): Promise<HolidayConflict[]> {
    if (!date || employeeIds.length === 0) return []
    const end = mode === 'range' ? endDate || date : date

    const { data: appts } = await supabase
      .from('appointments')
      .select('id, employee_id, customer_id, service_id, scheduled_at, duration_minutes, status')
      .in('employee_id', employeeIds)
      .neq('status', 'iptal')
      .gte('scheduled_at', `${date}T00:00:00`)
      .lte('scheduled_at', `${end}T23:59:59`)

    const rows = appts ?? []
    if (rows.length === 0) return []

    const empIds = Array.from(new Set(rows.map((a) => a.employee_id).filter((v): v is string => !!v)))
    const custIds = Array.from(new Set(rows.map((a) => a.customer_id).filter((v): v is string => !!v)))
    const svcIds = Array.from(new Set(rows.map((a) => a.service_id).filter((v): v is string => !!v)))
    const [{ data: profs }, { data: custs }, { data: svcs }] = await Promise.all([
      empIds.length
        ? supabase.from('profiles').select('id, full_name').in('id', empIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      custIds.length
        ? supabase.from('customers').select('id, full_name').in('id', custIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      svcIds.length
        ? supabase.from('services').select('id, name').in('id', svcIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ])

    return rows
      .map((a) => ({
        id: a.id,
        employeeName: profs?.find((p) => p.id === a.employee_id)?.full_name ?? 'Çalışan',
        customerName: custs?.find((c) => c.id === a.customer_id)?.full_name ?? 'Müşteri',
        serviceName: svcs?.find((s) => s.id === a.service_id)?.name ?? 'Hizmet',
        scheduled_at: a.scheduled_at,
      }))
      .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))
  }

  async function handleAddClick() {
    if (!date || employeeIds.length === 0) return
    setCheckingConflicts(true)
    const found = await findHolidayConflicts()
    setCheckingConflicts(false)
    if (found.length > 0) {
      setPendingConflicts(found)
      setConflictWarningOpen(true)
      return
    }
    await addHoliday()
  }

  async function proceedAnyway() {
    setConflictWarningOpen(false)
    await addHoliday()
  }

  async function addHoliday() {
    if (!date || employeeIds.length === 0) return
    setSaving(true)
    const end = mode === 'range' ? endDate || date : date
    const rows = employeeIds.map((profile_id) => ({
      profile_id,
      day_of_week: null,
      block_date: date,
      end_date: end,
      starts_at: '00:00',
      ends_at: '23:59',
      label: label.trim() || HOLIDAY_LABEL,
    }))
    await supabase.from('employee_time_blocks').insert(rows)
    setMode('day')
    setDate(todayLocalDateString())
    setEndDate('')
    setLabel(HOLIDAY_LABEL)
    await loadData()
    setSaving(false)
  }

  async function removeHoliday(h: Holiday) {
    await supabase.from('employee_time_blocks').delete().eq('label', HOLIDAY_LABEL).eq('block_date', h.date).eq('end_date', h.endDate)
    await loadData()
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.backBtn} onClick={() => navigate('/ekip')}>
        <ChevronRightIcon width={14} height={14} className={styles.backIcon} />
        Ekibe Dön
      </button>

      <div className={`card ${styles.headerCard}`}>
        <span className={styles.headerIcon}>
          <UmbrellaIcon width={20} height={20} />
        </span>
        <div className={styles.headerInfo}>
          <span className={styles.headerName}>Resmî Tatiller</span>
          <span className={styles.headerLine}>Eklediğin günlerde tüm ekip için online randevu kapanır.</span>
        </div>
      </div>

      <div className="card">
        <div className={styles.modeToggle}>
          <button type="button" className={mode === 'day' ? styles.modeTabActive : styles.modeTab} onClick={() => setMode('day')}>
            Tek gün
          </button>
          <button type="button" className={mode === 'range' ? styles.modeTabActive : styles.modeTab} onClick={() => setMode('range')}>
            Tarih aralığı
          </button>
        </div>

        <div className={styles.field}>
          <label>{mode === 'range' ? 'Başlangıç Tarihi' : 'Tarih'}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {mode === 'range' && (
          <div className={styles.field}>
            <label>Bitiş Tarihi</label>
            <input type="date" min={date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        )}

        <div className={styles.field}>
          <label>Etiket</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ör. Ramazan Bayramı" />
        </div>

        <button
          type="button"
          className={`btn-primary ${styles.addBtn}`}
          onClick={handleAddClick}
          disabled={saving || checkingConflicts || !date}
        >
          {checkingConflicts ? 'Kontrol ediliyor…' : saving ? 'Ekleniyor…' : `+ Tatil Ekle · ${employeeIds.length} çalışan`}
        </button>
      </div>

      <div className="card">
        <div className={styles.listLabel}>Tanımlı Tatiller</div>

        {holidays.length === 0 ? (
          <div className={styles.empty}>
            <CalendarIcon width={22} height={22} />
            Henüz resmî tatil eklenmedi.
          </div>
        ) : (
          <div className={styles.list}>
            {holidays.map((h) => (
              <div className={styles.row} key={`${h.date}|${h.endDate}`}>
                <div>
                  <div className={styles.rowDate}>
                    {h.endDate !== h.date
                      ? `${new Date(h.date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} – ${new Date(h.endDate + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : new Date(h.date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                  <div className={styles.rowMeta}>Tüm ekip için kapalı</div>
                </div>
                <button type="button" className={styles.removeBtn} onClick={() => removeHoliday(h)} aria-label="Tatili kaldır">
                  <TrashIcon width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {conflictWarningOpen && (
        <div className={styles.conflictBackdrop}>
          <div className={`card ${styles.conflictCard}`}>
            <div className={styles.conflictHeader}>
              <span className={styles.conflictHeaderIcon}>
                <AlertTriangleIcon width={18} height={18} />
              </span>
              <div>
                <div className={styles.conflictTitle}>{pendingConflicts.length} randevu bu tarihte var</div>
                <div className={styles.conflictSubtitle}>
                  Bu randevular otomatik değişmez, Randevular ekranından elle iptal/taşımanız gerekir.
                </div>
              </div>
            </div>

            <div className={styles.conflictList}>
              {pendingConflicts.map((c) => (
                <div className={styles.conflictRow} key={c.id}>
                  <div className={styles.conflictRowMain}>
                    <span className={styles.conflictRowCustomer}>{c.customerName}</span>
                    <span className={styles.conflictRowService}>
                      {c.serviceName} · {c.employeeName}
                    </span>
                  </div>
                  <span className={styles.conflictRowDate}>
                    {new Date(c.scheduled_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                    {' · '}
                    {new Date(c.scheduled_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.conflictFooter}>
              <button
                type="button"
                className={styles.conflictSkipBtn}
                onClick={() => setConflictWarningOpen(false)}
                disabled={saving}
              >
                Vazgeç
              </button>
              <button type="button" className={`btn-primary ${styles.conflictConfirmBtn}`} onClick={proceedAnyway} disabled={saving}>
                {saving ? 'Ekleniyor…' : 'Yine de Ekle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
