import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import ConfirmModal from '../components/ConfirmModal'
import {
  SearchIcon,
  ReceiptIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  TrashIcon,
  ChevronRightIcon,
} from '../components/icons'
import { currency } from '../lib/currency'
import { toLocalDateString, presetDateRange, type DateRangePreset } from '../lib/date'
import styles from './GiderlerPage.module.css'
import { FIELD_LIMITS } from '../lib/fieldLimits'

interface Expense {
  id: string
  description: string
  amount: number
  expense_date: string
  due_date: string | null
  is_recurring: boolean
  is_paid: boolean
}

type Preset = DateRangePreset
const presetRange = presetDateRange

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'bugun', label: 'Bugün' },
  { value: 'bu_hafta', label: 'Bu Hafta' },
  { value: 'bu_ay', label: 'Bu Ay' },
  { value: 'gecen_ay', label: 'Geçen Ay' },
]

export default function GiderlerPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const expenseDescRef = useRef<HTMLInputElement>(null)

  // Muhasebe'deki "Detaylara Bak" linki secili donemi ?start&end ile
  // tasiyor — varsa onu baslangic araligi olarak kullaniyoruz.
  const initialStart = searchParams.get('start')
  const initialEnd = searchParams.get('end')

  const [preset, setPreset] = useState<Preset>(initialStart && initialEnd ? 'ozel' : 'bu_ay')
  const [rangeStart, setRangeStart] = useState(() => initialStart || presetRange('bu_ay').start)
  const [rangeEnd, setRangeEnd] = useState(() => initialEnd || presetRange('bu_ay').end)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [expenseSearch, setExpenseSearch] = useState('')
  const [paidConfirm, setPaidConfirm] = useState<{ id: string; description: string; next: boolean } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; description: string } | null>(null)

  const [expenseDesc, setExpenseDesc] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(() => toLocalDateString(new Date()))
  const [expenseDueDate, setExpenseDueDate] = useState('')
  const [expenseRecurring, setExpenseRecurring] = useState(false)
  const [expensePaid, setExpensePaid] = useState(true)
  const [addingExpense, setAddingExpense] = useState(false)

  function applyPreset(p: Preset) {
    setPreset(p)
    const { start, end } = presetRange(p)
    setRangeStart(start)
    setRangeEnd(end)
  }

  async function loadAll() {
    setLoading(true)
    const { data: exps } = await supabase
      .from('business_expenses')
      .select('id, description, amount, expense_date, due_date, is_recurring, is_paid')
      .gte('expense_date', rangeStart)
      .lte('expense_date', rangeEnd)
      .order('expense_date', { ascending: false })
    setExpenses(exps ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd])

  // Muhasebe'deki "+ Ödeme Ekle" kisayolu buraya ?yeni=1 ile dusuyor —
  // ekleme formuna dogrudan kaydirip odak veriyoruz.
  useEffect(() => {
    if (searchParams.get('yeni') === '1') {
      expenseDescRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      expenseDescRef.current?.focus()
      searchParams.delete('yeni')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

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
      due_date: expenseDueDate || null,
      is_recurring: expenseRecurring,
      is_paid: expensePaid,
    })
    setExpenseDesc('')
    setExpenseAmount('')
    setExpenseDueDate('')
    setExpenseRecurring(false)
    setExpensePaid(true)
    await loadAll()
    setAddingExpense(false)
  }

  function requestDeleteExpense(id: string, description: string) {
    setDeleteConfirm({ id, description })
  }

  async function confirmDeleteExpense() {
    if (!deleteConfirm) return
    await supabase.from('business_expenses').delete().eq('id', deleteConfirm.id)
    setDeleteConfirm(null)
    await loadAll()
  }

  function requestToggleExpensePaid(id: string, description: string, next: boolean) {
    setPaidConfirm({ id, description, next })
  }

  async function confirmToggleExpensePaid() {
    if (!paidConfirm) return
    await supabase.from('business_expenses').update({ is_paid: paidConfirm.next }).eq('id', paidConfirm.id)
    setPaidConfirm(null)
    await loadAll()
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  const todayStr = toLocalDateString(new Date())
  const paidExpenses = expenses.filter((e) => e.is_paid)
  const unpaidExpenses = expenses.filter((e) => !e.is_paid)
  const overdueExpenses = unpaidExpenses.filter((e) => e.due_date && e.due_date < todayStr)
  const totalPaid = paidExpenses.reduce((sum, e) => sum + e.amount, 0)
  const totalUnpaid = unpaidExpenses.reduce((sum, e) => sum + e.amount, 0)
  const totalOverdue = overdueExpenses.reduce((sum, e) => sum + e.amount, 0)
  const totalAll = expenses.reduce((sum, e) => sum + e.amount, 0)

  const eq = expenseSearch.trim().toLowerCase()
  const visibleExpenses = eq ? expenses.filter((e) => e.description.toLowerCase().includes(eq)) : expenses

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.backBtn} onClick={() => navigate('/muhasebe')}>
        <ChevronRightIcon width={14} height={14} className={styles.backIcon} />
        Muhasebeye Dön
      </button>

      <div className={styles.stickyFilter}>
        <h2 className={styles.sectionLabel}>Tarih Aralığı</h2>
        <div className={styles.filterRow}>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={preset === p.value ? styles.filterBtnActive : styles.filterBtn}
              onClick={() => applyPreset(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className={`card ${styles.customRangeRow}`}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="giderRangeStart">Başlangıç</label>
            <input
              id="giderRangeStart"
              type="date"
              value={rangeStart}
              max={rangeEnd}
              onChange={(e) => {
                setPreset('ozel')
                setRangeStart(e.target.value)
              }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="giderRangeEnd">Bitiş</label>
            <input
              id="giderRangeEnd"
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

      <div className={styles.statsGrid}>
        <div className={`${styles.statCard} ${styles.statCardSignal}`}>
          <span className={`${styles.statIcon} ${styles.statIconSignal}`}>
            <ReceiptIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{currency.format(totalAll)}</span>
          <span className={styles.statLabel}>Toplam Gider</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCardOk}`}>
          <span className={`${styles.statIcon} ${styles.statIconOk}`}>
            <CheckCircleIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{currency.format(totalPaid)}</span>
          <span className={styles.statLabel}>{paidExpenses.length} Ödenmiş</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCardDanger}`}>
          <span className={`${styles.statIcon} ${styles.statIconDanger}`}>
            <AlertTriangleIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{currency.format(totalUnpaid)}</span>
          <span className={styles.statLabel}>{unpaidExpenses.length} Ödenmemiş</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCardDanger}`}>
          <span className={`${styles.statIcon} ${styles.statIconDanger}`}>
            <AlertTriangleIcon width={14} height={14} />
          </span>
          <span className={styles.statValue}>{currency.format(totalOverdue)}</span>
          <span className={styles.statLabel}>{overdueExpenses.length} Vadesi Geçen</span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 14 }}>Yeni Gider Ekle</h2>
        <form className={styles.expenseForm} onSubmit={addExpense}>
          <div className={styles.expenseField}>
            <label htmlFor="expenseDesc">Açıklama</label>
            <input maxLength={FIELD_LIMITS.businessExpensesDescription}
              id="expenseDesc"
              ref={expenseDescRef}
              type="text"
              value={expenseDesc}
              onChange={(e) => setExpenseDesc(e.target.value)}
              placeholder="Kira, fatura, sarf malzeme…"
              required
            />
          </div>
          <div className={styles.expenseField} style={{ width: 120 }}>
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
          <div className={styles.expenseField} style={{ width: 150 }}>
            <label htmlFor="expenseDate">Tarih</label>
            <input
              id="expenseDate"
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
            />
          </div>
          <div className={styles.expenseField} style={{ width: 150 }}>
            <label htmlFor="expenseDueDate">Son Ödeme Tarihi (opsiyonel)</label>
            <input
              id="expenseDueDate"
              type="date"
              value={expenseDueDate}
              min={expenseDate}
              onChange={(e) => setExpenseDueDate(e.target.value)}
            />
          </div>
          <div className={styles.expenseField}>
            <label>Tekrar</label>
            <div className={styles.recurringToggle}>
              <button
                type="button"
                className={!expenseRecurring ? styles.recurringBtnActive : styles.recurringBtn}
                onClick={() => setExpenseRecurring(false)}
              >
                Tek Seferlik
              </button>
              <button
                type="button"
                className={expenseRecurring ? styles.recurringBtnActive : styles.recurringBtn}
                onClick={() => setExpenseRecurring(true)}
              >
                Aylık
              </button>
            </div>
          </div>
          <div className={styles.expenseField}>
            <label>Ödeme Durumu</label>
            <div className={styles.recurringToggle}>
              <button
                type="button"
                className={expensePaid ? styles.recurringBtnActive : styles.recurringBtn}
                onClick={() => setExpensePaid(true)}
              >
                Ödendi
              </button>
              <button
                type="button"
                className={!expensePaid ? styles.recurringBtnActive : styles.recurringBtn}
                onClick={() => setExpensePaid(false)}
              >
                Ödenmedi
              </button>
            </div>
          </div>
          <button type="submit" className={`btn-primary ${styles.saveBtn}`} disabled={addingExpense}>
            {addingExpense ? 'Ekleniyor…' : 'Ekle'}
          </button>
        </form>
      </div>

      <div className={styles.searchBox}>
        <SearchIcon width={16} height={16} className={styles.searchIcon} />
        <input maxLength={FIELD_LIMITS.search}
          className={styles.searchInput}
          placeholder="Gider ara…"
          value={expenseSearch}
          onChange={(e) => setExpenseSearch(e.target.value)}
        />
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 14 }}>Tüm Giderler</h2>
        {visibleExpenses.length === 0 ? (
          <p className={styles.empty}>{eq ? 'Eşleşen gider yok.' : 'Bu aralıkta gider kaydı yok.'}</p>
        ) : (
          <div className={styles.list}>
            {visibleExpenses.map((e) => {
              const isOverdue = !e.is_paid && !!e.due_date && e.due_date < todayStr
              return (
                <div className={styles.expenseRow} key={e.id}>
                  <div className={styles.expenseRowMain}>
                    <span className={styles.expenseDescRow}>
                      <span className={styles.expenseDesc}>{e.description}</span>
                      {e.is_recurring && <span className={styles.recurringBadge}>Aylık</span>}
                      {!e.is_paid && (
                        <span className={isOverdue ? styles.overdueBadge : styles.unpaidBadge}>
                          {isOverdue ? 'Vadesi Geçti' : 'Ödenmedi'}
                        </span>
                      )}
                    </span>
                    <span className={styles.expenseDate}>
                      {new Date(e.expense_date + 'T00:00:00').toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {e.due_date && (
                        <>
                          {' · Son ödeme: '}
                          {new Date(e.due_date + 'T00:00:00').toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </>
                      )}
                    </span>
                  </div>
                  <span className={styles.expenseAmount}>{currency.format(e.amount)}</span>
                  <button
                    type="button"
                    className={e.is_paid ? styles.paidToggleBtnActive : styles.paidToggleBtn}
                    onClick={() => requestToggleExpensePaid(e.id, e.description, !e.is_paid)}
                    aria-label={e.is_paid ? `${e.description} giderini ödenmedi işaretle` : `${e.description} giderini ödendi işaretle`}
                    title={e.is_paid ? 'Ödendi — ödenmedi işaretlemek için tıkla' : 'Ödendi olarak işaretle'}
                  >
                    <CheckCircleIcon width={16} height={16} />
                  </button>
                  <button
                    type="button"
                    className={styles.rowDeleteBtn}
                    onClick={() => requestDeleteExpense(e.id, e.description)}
                    aria-label={`${e.description} giderini sil`}
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {paidConfirm && (
        <ConfirmModal
          title={paidConfirm.next ? 'Ödendi Olarak İşaretle' : 'Ödenmedi Olarak İşaretle'}
          message={
            <>
              "{paidConfirm.description}" giderini{' '}
              <strong style={{ color: paidConfirm.next ? 'var(--ok-text)' : 'var(--danger-text)' }}>
                {paidConfirm.next ? 'ödendi' : 'ödenmedi'}
              </strong>{' '}
              olarak işaretlemek istediğinize emin misiniz?
            </>
          }
          confirmLabel="Evet, İşaretle"
          onConfirm={confirmToggleExpensePaid}
          onCancel={() => setPaidConfirm(null)}
        />
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Gideri Sil"
          message={
            <>
              "{deleteConfirm.description}" giderini silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
            </>
          }
          confirmLabel="Evet, Sil"
          danger
          onConfirm={confirmDeleteExpense}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}
