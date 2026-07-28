import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { LayoutOutletContext } from '../layouts/DashboardLayout'
import Avatar from '../components/Avatar'
import styles from './AccountingPage.module.css'

interface Appointment {
  id: string
  service_id: string | null
  employee_id: string | null
  scheduled_at: string
}

interface Service {
  id: string
  price: number | null
}

interface Profile {
  id: string
  full_name: string | null
}

interface Expense {
  id: string
  description: string
  amount: number
  expense_date: string
}

const currency = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })

function toLocalDateString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

type Preset = 'bu_ay' | 'gecen_ay' | 'son_7' | 'son_30' | 'ozel'

function presetRange(preset: Preset): { start: string; end: string } {
  const today = new Date()
  switch (preset) {
    case 'bu_ay':
      return { start: toLocalDateString(firstOfMonth(today)), end: toLocalDateString(today) }
    case 'gecen_ay': {
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
      const lastMonthStart = firstOfMonth(lastMonthEnd)
      return { start: toLocalDateString(lastMonthStart), end: toLocalDateString(lastMonthEnd) }
    }
    case 'son_7': {
      const start = new Date(today)
      start.setDate(start.getDate() - 6)
      return { start: toLocalDateString(start), end: toLocalDateString(today) }
    }
    case 'son_30': {
      const start = new Date(today)
      start.setDate(start.getDate() - 29)
      return { start: toLocalDateString(start), end: toLocalDateString(today) }
    }
    default:
      return { start: toLocalDateString(firstOfMonth(today)), end: toLocalDateString(today) }
  }
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'bu_ay', label: 'Bu ay' },
  { value: 'gecen_ay', label: 'Geçen ay' },
  { value: 'son_7', label: 'Son 7 gün' },
  { value: 'son_30', label: 'Son 30 gün' },
]

export default function AccountingPage() {
  const { profile } = useAuth()
  const { searchQuery, setSearchPlaceholder } = useOutletContext<LayoutOutletContext>()
  const [preset, setPreset] = useState<Preset>('bu_ay')
  const [rangeStart, setRangeStart] = useState(() => presetRange('bu_ay').start)
  const [rangeEnd, setRangeEnd] = useState(() => presetRange('bu_ay').end)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [commissionPct, setCommissionPct] = useState(0)
  const [taxPct, setTaxPct] = useState(0)
  const [rateInput, setRateInput] = useState('0')
  const [taxInput, setTaxInput] = useState('0')
  const [loading, setLoading] = useState(true)
  const [savedHint, setSavedHint] = useState(false)

  const [expenseDesc, setExpenseDesc] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(() => toLocalDateString(new Date()))
  const [addingExpense, setAddingExpense] = useState(false)

  function applyPreset(p: Preset) {
    setPreset(p)
    const { start, end } = presetRange(p)
    setRangeStart(start)
    setRangeEnd(end)
  }

  async function loadAll() {
    setLoading(true)
    // scheduled_at bir timestamptz kolonu — "YYYY-MM-DDTHH:mm:ss" gibi saat
    // dilimi belirtilmeyen ham bir string gonderilirse Postgres bunu sunucu
    // saat diliminde (Supabase'de varsayilan UTC) yorumlar, tarayicinin yerel
    // saatinde (ör. Turkiye, UTC+3) DEGIL. Bu kayma yuzunden gun/ay sinirina
    // yakin randevular (ör. yerel 00:00-03:00 arasi) yanlis donemde sayilir ya
    // da hic sayilmaz. Once yerel (tarayici saat dilimi = isletme saat dilimi
    // varsayimiyla) bir Date olustur, sonra dogru UTC karsiligina cevir.
    const rangeStartISO = new Date(`${rangeStart}T00:00:00`).toISOString()
    const rangeEndISO = new Date(`${rangeEnd}T23:59:59.999`).toISOString()
    const [{ data: appts }, { data: svcs }, { data: profs }, { data: settings }, { data: exps }] =
      await Promise.all([
        supabase
          .from('appointments')
          .select('id, service_id, employee_id, scheduled_at')
          .eq('status', 'tamamlandi')
          .gte('scheduled_at', rangeStartISO)
          .lte('scheduled_at', rangeEndISO),
        supabase.from('services').select('id, price'),
        supabase.from('profiles').select('id, full_name'),
        supabase.from('business_finance_settings').select('commission_pct, tax_pct').maybeSingle(),
        supabase
          .from('business_expenses')
          .select('id, description, amount, expense_date')
          .gte('expense_date', rangeStart)
          .lte('expense_date', rangeEnd)
          .order('expense_date', { ascending: false }),
      ])
    setAppointments(appts ?? [])
    setServices(svcs ?? [])
    setProfiles(profs ?? [])
    setExpenses(exps ?? [])
    const cPct = settings?.commission_pct ?? 0
    const tPct = settings?.tax_pct ?? 0
    setCommissionPct(cPct)
    setTaxPct(tPct)
    setRateInput(String(cPct))
    setTaxInput(String(tPct))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd])

  useEffect(() => {
    setSearchPlaceholder('Çalışan veya gider ara…')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveSettings() {
    if (!profile?.business_id) return
    const cPct = Math.min(100, Math.max(0, Number(rateInput) || 0))
    const tPct = Math.min(100, Math.max(0, Number(taxInput) || 0))
    await supabase
      .from('business_finance_settings')
      .upsert({ business_id: profile.business_id, commission_pct: cPct, tax_pct: tPct })
    setCommissionPct(cPct)
    setTaxPct(tPct)
    setSavedHint(true)
    setTimeout(() => setSavedHint(false), 2000)
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault()
    if (!profile?.business_id) return
    const amount = Number(expenseAmount)
    if (!expenseDesc.trim() || !amount || amount < 0) return
    setAddingExpense(true)
    await supabase.from('business_expenses').insert({
      business_id: profile.business_id,
      description: expenseDesc.trim(),
      amount,
      expense_date: expenseDate,
    })
    setExpenseDesc('')
    setExpenseAmount('')
    await loadAll()
    setAddingExpense(false)
  }

  async function deleteExpense(id: string) {
    await supabase.from('business_expenses').delete().eq('id', id)
    await loadAll()
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  const servicePriceById = new Map(services.map((s) => [s.id, s.price ?? 0]))
  const profileNameById = new Map(profiles.map((p) => [p.id, p.full_name ?? 'Bilinmeyen']))

  const employeeStatsMap = new Map<string, { id: string; name: string; count: number; revenue: number }>()
  for (const a of appointments) {
    if (!a.employee_id) continue
    const key = a.employee_id
    const entry = employeeStatsMap.get(key) ?? {
      id: key,
      name: profileNameById.get(key) ?? 'Bilinmeyen',
      count: 0,
      revenue: 0,
    }
    entry.count += 1
    entry.revenue += a.service_id ? (servicePriceById.get(a.service_id) ?? 0) : 0
    employeeStatsMap.set(key, entry)
  }
  const allEmployeeStats = Array.from(employeeStatsMap.values()).sort((a, b) => b.revenue - a.revenue)
  const q = searchQuery.trim().toLowerCase()
  const employeeStats = q ? allEmployeeStats.filter((e) => e.name.toLowerCase().includes(q)) : allEmployeeStats
  const visibleExpenses = q ? expenses.filter((e) => e.description.toLowerCase().includes(q)) : expenses

  const totalRevenue = appointments.reduce(
    (sum, a) => sum + (a.service_id ? (servicePriceById.get(a.service_id) ?? 0) : 0),
    0,
  )
  const taxAmount = totalRevenue * (taxPct / 100)
  const afterTax = totalRevenue - taxAmount
  const commissionAmount = afterTax * (commissionPct / 100)
  const afterCommission = afterTax - commissionAmount
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
  const netProfit = afterCommission - totalExpenses

  return (
    <div className={styles.wrap}>
      <div className={`card ${styles.filterCard}`}>
        <div className={styles.presetRow}>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`btn-secondary ${styles.presetBtn} ${preset === p.value ? styles.presetBtnActive : ''}`}
              onClick={() => applyPreset(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.rangeRow}>
          <div className={styles.rangeField}>
            <label htmlFor="rangeStart">Başlangıç</label>
            <input
              id="rangeStart"
              type="date"
              value={rangeStart}
              max={rangeEnd}
              onChange={(e) => {
                setPreset('ozel')
                setRangeStart(e.target.value)
              }}
            />
          </div>
          <div className={styles.rangeField}>
            <label htmlFor="rangeEnd">Bitiş</label>
            <input
              id="rangeEnd"
              type="date"
              value={rangeEnd}
              min={rangeStart}
              onChange={(e) => {
                setPreset('ozel')
                setRangeEnd(e.target.value)
              }}
            />
          </div>
        </div>
      </div>

      <div className={styles.statRow}>
        <div className={`card ${styles.statTile}`}>
          <span className={styles.statValue}>{currency.format(totalRevenue)}</span>
          <span className={styles.statLabel}>Toplam ciro</span>
        </div>
        <div className={`card ${styles.statTile}`}>
          <span className={styles.statValue}>{appointments.length}</span>
          <span className={styles.statLabel}>Tamamlanan randevu</span>
        </div>
        <div className={`card ${styles.statTile}`}>
          <span className={styles.statValue}>{currency.format(totalExpenses)}</span>
          <span className={styles.statLabel}>Toplam gider</span>
        </div>
        <div className={`card ${styles.statTile}`}>
          <span className={styles.statValue}>{currency.format(netProfit)}</span>
          <span className={styles.statLabel}>Net kâr</span>
        </div>
      </div>

      <div className={`card ${styles.rateRow}`}>
        <div className={styles.rateField}>
          <label htmlFor="taxRate">Vergi oranı (%)</label>
          <input
            id="taxRate"
            type="number"
            min={0}
            max={100}
            step={1}
            value={taxInput}
            onChange={(e) => setTaxInput(e.target.value)}
          />
        </div>
        <div className={styles.rateField}>
          <label htmlFor="commissionRate">Genel prim oranı (%)</label>
          <input
            id="commissionRate"
            type="number"
            min={0}
            max={100}
            step={1}
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
          />
        </div>
        <button type="button" className={`btn-primary ${styles.saveBtn}`} onClick={saveSettings}>
          Kaydet
        </button>
        {savedHint && <span className={styles.savedHint}>Kaydedildi ✓</span>}
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Bu dönem özeti</h2>
        <div className={styles.waterfall}>
          <div className={styles.waterfallRow}>
            <span>Toplam ciro</span>
            <span>{currency.format(totalRevenue)}</span>
          </div>
          <div className={styles.waterfallRow}>
            <span>− Vergi (%{taxPct})</span>
            <span className={styles.waterfallMinus}>−{currency.format(taxAmount)}</span>
          </div>
          <div className={`${styles.waterfallRow} ${styles.waterfallSubtotal}`}>
            <span>Vergi sonrası kalan</span>
            <span>{currency.format(afterTax)}</span>
          </div>
          <div className={styles.waterfallRow}>
            <span>− Çalışan primi (%{commissionPct})</span>
            <span className={styles.waterfallMinus}>−{currency.format(commissionAmount)}</span>
          </div>
          <div className={`${styles.waterfallRow} ${styles.waterfallSubtotal}`}>
            <span>Prim sonrası kalan</span>
            <span>{currency.format(afterCommission)}</span>
          </div>
          <div className={styles.waterfallRow}>
            <span>− Salon giderleri</span>
            <span className={styles.waterfallMinus}>−{currency.format(totalExpenses)}</span>
          </div>
          <div className={`${styles.waterfallRow} ${styles.waterfallNet}`}>
            <span>Net kâr</span>
            <span>{currency.format(netProfit)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Giderler</h2>
        <form className={styles.expenseForm} onSubmit={addExpense}>
          <div className={styles.expenseField}>
            <label htmlFor="expenseDesc">Açıklama</label>
            <input
              id="expenseDesc"
              type="text"
              value={expenseDesc}
              onChange={(e) => setExpenseDesc(e.target.value)}
              placeholder="Kira, fatura, sarf malzeme…"
              required
            />
          </div>
          <div className={styles.expenseField} style={{ width: 130 }}>
            <label htmlFor="expenseAmount">Tutar</label>
            <input
              id="expenseAmount"
              type="number"
              min={0}
              step="0.01"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              placeholder="0"
              required
            />
          </div>
          <div className={styles.expenseField} style={{ width: 160 }}>
            <label htmlFor="expenseDate">Tarih</label>
            <input
              id="expenseDate"
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
            />
          </div>
          <button type="submit" className={`btn-primary ${styles.saveBtn}`} disabled={addingExpense}>
            {addingExpense ? 'Ekleniyor…' : 'Ekle'}
          </button>
        </form>

        {visibleExpenses.length === 0 ? (
          <p className={styles.empty}>{q ? 'Eşleşen gider yok.' : 'Bu aralıkta gider kaydı yok.'}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Açıklama</th>
                <th>Tutar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleExpenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.expense_date}</td>
                  <td>{e.description}</td>
                  <td>{currency.format(e.amount)}</td>
                  <td>
                    <button className="btn-secondary" style={{ width: 'auto' }} onClick={() => deleteExpense(e.id)}>
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Çalışan bazlı ciro</h2>
        {employeeStats.length === 0 ? (
          <p className={styles.empty}>Bu aralıkta tamamlanmış randevu yok.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Ad Soyad</th>
                <th>Randevu sayısı</th>
                <th>Oluşturduğu ciro</th>
              </tr>
            </thead>
            <tbody>
              {employeeStats.map((e, i) => (
                <tr key={e.id}>
                  <td className={styles.rank}>{i + 1}</td>
                  <td>
                    <span className={styles.nameCell}>
                      <Avatar name={e.name} size={28} />
                      {e.name}
                    </span>
                  </td>
                  <td>{e.count}</td>
                  <td>{currency.format(e.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
