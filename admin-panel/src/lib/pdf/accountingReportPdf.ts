import { toLocalDateString } from '../date'
import { supabase } from '../supabase'
import { fetchAll } from '../fetchAll'
import { currency } from '../currency'
import { PdfReport } from './pdfDoc'
import { saveAndSharePdf } from './savePdf'
import { yieldToUI } from './yieldToUI'

const METHOD_LABEL: Record<string, string> = {
  nakit: 'Nakit',
  kart: 'Kredi Kartı',
  diger: 'Diğer',
}

function formatDateLabel(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatPeriodLabel(start: string, end: string) {
  return start === end ? formatDateLabel(start) : `${formatDateLabel(start)} – ${formatDateLabel(end)}`
}

function formatGeneratedLabel() {
  const now = new Date()
  return `Oluşturulma: ${now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} ${now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
}

interface RankedStat {
  id: string
  name: string
  count: number
  revenue: number
}

interface ExpenseRow {
  id: string
  description: string
  amount: number
  expense_date: string
  due_date: string | null
  is_recurring: boolean
  is_paid: boolean
}

interface AppointmentLite {
  employee_id: string | null
  service_id: string | null
}

export async function generateAccountingReportPdf(params: {
  businessId: string
  rangeStart: string
  rangeEnd: string
  kpis: { totalRevenue: number; completedCount: number; totalExpenses: number; netProfit: number }
  waterfall: {
    totalRevenue: number
    taxPct: number
    taxAmount: number
    afterTax: number
    commissionPct: number
    commissionAmount: number
    afterCommission: number
    totalExpenses: number
    netProfit: number
  }
  employeeStats: RankedStat[]
  serviceStats: RankedStat[]
  expenses: ExpenseRow[]
  appointmentById: Map<string, AppointmentLite>
  packageServiceById: Map<string, string | null>
  profileNameById: Map<string, string>
  serviceNameById: Map<string, string>
  onProgress: (pct: number, step: string) => void
}) {
  const {
    businessId,
    rangeStart,
    rangeEnd,
    kpis,
    waterfall,
    employeeStats,
    serviceStats,
    expenses,
    appointmentById,
    packageServiceById,
    profileNameById,
    serviceNameById,
    onProgress,
  } = params

  onProgress(4, 'İşletme bilgileri alınıyor…')
  const [{ data: business }, { data: pays }] = await Promise.all([
    supabase.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    fetchAll(() => supabase
      .from('payments')
      .select('id, amount, method, paid_at, appointment_id, package_id')
      .is('voided_at', null)
      .gte('paid_at', rangeStart)
      .lte('paid_at', rangeEnd)
      .order('paid_at', { ascending: true }).order('id')),
  ])
  const businessName = business?.name ?? 'İşletme'
  const payments = pays ?? []
  await yieldToUI()

  const report = new PdfReport('Muhasebe Raporu', businessName)
  report.addCoverHeader(formatPeriodLabel(rangeStart, rangeEnd), formatGeneratedLabel())

  onProgress(10, 'Genel özet hazırlanıyor…')
  report.addSectionTitle('Dönem Özeti')
  report.addKpiGrid([
    { label: 'Toplam Ciro', value: currency.format(kpis.totalRevenue) },
    { label: 'Tamamlanan Randevu', value: kpis.completedCount.toLocaleString('tr-TR') },
    { label: 'Toplam Gider', value: currency.format(kpis.totalExpenses) },
    { label: 'Net Kâr', value: currency.format(kpis.netProfit) },
  ])
  await yieldToUI()

  onProgress(20, 'Hesaplama detayı hazırlanıyor…')
  report.addSectionTitle('Bu Dönem Nasıl Hesaplandı')
  report.addWaterfall([
    { label: 'Toplam ciro', value: currency.format(waterfall.totalRevenue) },
    { label: `- Vergi (%${waterfall.taxPct})`, value: `-${currency.format(waterfall.taxAmount)}`, negative: true },
    { label: 'Vergi sonrası kalan', value: currency.format(waterfall.afterTax), strong: true },
    { label: `- Çalışan primi (%${waterfall.commissionPct})`, value: `-${currency.format(waterfall.commissionAmount)}`, negative: true },
    { label: 'Prim sonrası kalan', value: currency.format(waterfall.afterCommission), strong: true },
  ])
  await yieldToUI()

  const unpaidTotal = expenses.filter((e) => !e.is_paid).reduce((sum, e) => sum + e.amount, 0)
  report.addSubText(`Salon giderleri (ödenmiş) — toplam: -${currency.format(waterfall.totalExpenses)}`)
  if (unpaidTotal > 0) {
    report.addSubText(`Ödenmemiş gider: -${currency.format(unpaidTotal)}. Net Kâr'a da hesaplanmadı.`)
  }
  if (expenses.length === 0) {
    report.addSubText('Bu aralıkta gider kaydı yok.')
  } else {
    const todayStr = toLocalDateString(new Date())
    report.addTable({
      head: ['Tarih', 'Son Ödeme', 'Açıklama', 'Tekrar', 'Durum', 'Tutar'],
      body: expenses
        .slice()
        .sort((a, b) => a.expense_date.localeCompare(b.expense_date))
        .map((e) => {
          const overdue = !e.is_paid && !!e.due_date && e.due_date < todayStr
          return [
            formatDateLabel(e.expense_date),
            e.due_date ? formatDateLabel(e.due_date) : '—',
            e.description,
            e.is_recurring ? 'Aylık' : 'Tek Seferlik',
            e.is_paid ? 'Ödendi' : overdue ? 'Vadesi Geçti' : 'Ödenmedi',
            `-${currency.format(e.amount)}`,
          ]
        }),
      rightAlignFrom: 5,
    })
  }
  await yieldToUI()

  report.addWaterfall([{ label: 'Net kâr', value: currency.format(waterfall.netProfit), strong: true }])
  await yieldToUI()

  onProgress(32, 'Çalışan bazlı ciro hazırlanıyor…')
  report.addSectionTitle('Çalışan Bazlı Ciro')
  if (employeeStats.length === 0) {
    report.addSubText('Bu aralıkta randevu veya ödeme kaydı yok.')
  } else {
    report.addTable({
      head: ['Çalışan', 'Randevu', 'Ciro'],
      body: employeeStats.map((e) => [e.name, String(e.count), currency.format(e.revenue)]),
      rightAlignFrom: 1,
    })
  }
  await yieldToUI()

  onProgress(44, 'İşlem bazlı ciro hazırlanıyor…')
  report.addSectionTitle('İşlem Bazlı Ciro')
  if (serviceStats.length === 0) {
    report.addSubText('Bu aralıkta randevu veya ödeme kaydı yok.')
  } else {
    report.addTable({
      head: ['Hizmet', 'Randevu', 'Ciro'],
      body: serviceStats.map((s) => [s.name, String(s.count), currency.format(s.revenue)]),
      rightAlignFrom: 1,
    })
  }
  await yieldToUI()

  onProgress(74, 'Tahsilatlar hazırlanıyor…')
  report.addSectionTitle('Tahsilatlar')
  if (payments.length === 0) {
    report.addSubText('Bu aralıkta tahsilat kaydı yok.')
  } else {
    report.addTable({
      head: ['Tarih', 'İlişkili', 'Yöntem', 'Tutar'],
      body: payments.map((p) => {
        const appt = p.appointment_id ? appointmentById.get(p.appointment_id) : null
        let related = 'Genel Ödeme'
        if (appt) {
          const employee = appt.employee_id ? (profileNameById.get(appt.employee_id) ?? 'Bilinmeyen') : null
          const service = appt.service_id ? (serviceNameById.get(appt.service_id) ?? 'Silinmiş hizmet') : null
          related = [service, employee].filter(Boolean).join(' · ') || 'Randevu Ödemesi'
        } else if (p.package_id) {
          const serviceId = packageServiceById.get(p.package_id)
          related = `Paket Ödemesi${serviceId ? ` · ${serviceNameById.get(serviceId) ?? ''}` : ''}`
        }
        return [formatDateLabel(p.paid_at), related, METHOD_LABEL[p.method] ?? p.method, currency.format(p.amount)]
      }),
      rightAlignFrom: 3,
    })
  }
  await yieldToUI()

  onProgress(92, 'Sayfa numaraları ekleniyor…')
  report.finalizeFooters()
  await yieldToUI()

  onProgress(97, 'Kaydediliyor…')
  const filename = `muhasebe-raporu_${rangeStart}_${rangeEnd}.pdf`
  await saveAndSharePdf(report.doc, filename)
  onProgress(100, 'Tamamlandı')
}
