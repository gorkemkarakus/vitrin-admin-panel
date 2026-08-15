import { supabase } from '../supabase'
import { SOURCE_LABEL } from '../sourceLabels'
import { currencyWhole as currency } from '../currency'
import { PdfReport } from './pdfDoc'
import { saveAndSharePdf } from './savePdf'
import { yieldToUI } from './yieldToUI'

const STATUS_LABEL: Record<string, string> = {
  bekliyor: 'Bekliyor',
  onaylandi: 'Onaylandı',
  tamamlandi: 'Tamamlandı',
  iptal: 'İptal',
  gelmedi: 'Gelmedi',
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

interface AppointmentRow {
  id: string
  employee_id: string | null
  customer_id: string | null
  service_id: string | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  scheduled_at: string
  price_override: number | null
  source: string
}

interface EmployeeStatRow {
  profile: { id: string; full_name: string | null }
  totalRandevu: number
  completedCount: number
  revenue: number
  primOrani: number
  primHakedis: number
  uniqueCustomers: number
  leaveDayCount: number
  utilization: number
  completionRate: number
  topServiceName: string | null
  sourceCounts: Map<string, number>
}

export async function generatePerformanceReportPdf(params: {
  businessId: string
  rangeStart: string
  rangeEnd: string
  kpis: { totalRandevu: number; kazandirilanTutar: number; izinGunleri: number; toplamCalisan: number }
  employeeStats: EmployeeStatRow[]
  currentAppts: AppointmentRow[]
  serviceById: Map<string, { id: string; name: string; price: number | null }>
  onProgress: (pct: number, step: string) => void
}) {
  const { businessId, rangeStart, rangeEnd, kpis, employeeStats, currentAppts, serviceById, onProgress } = params

  onProgress(4, 'İşletme bilgileri alınıyor…')
  const [{ data: business }, { data: customers }] = await Promise.all([
    supabase.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    supabase.from('customers').select('id, full_name'),
  ])
  const businessName = business?.name ?? 'İşletme'
  const customerById = new Map((customers ?? []).map((c) => [c.id, c.full_name]))
  await yieldToUI()

  const report = new PdfReport('Performans Raporu', businessName)
  report.addCoverHeader(formatPeriodLabel(rangeStart, rangeEnd), formatGeneratedLabel())

  onProgress(10, 'Genel özet hazırlanıyor…')
  report.addSectionTitle('Genel Özet')
  report.addKpiGrid([
    { label: 'Toplam Randevu', value: kpis.totalRandevu.toLocaleString('tr-TR') },
    { label: 'Kazandırılan Tutar', value: currency.format(kpis.kazandirilanTutar) },
    { label: 'İzin Günleri', value: kpis.izinGunleri.toLocaleString('tr-TR') },
    { label: 'Toplam Çalışan', value: kpis.toplamCalisan.toLocaleString('tr-TR') },
  ])
  await yieldToUI()

  onProgress(16, 'Çalışan özet tablosu hazırlanıyor…')
  report.addSectionTitle('Çalışan Özeti')
  report.addTable({
    head: ['Çalışan', 'Randevu', 'Tamamlanan', 'Tahsilat', 'Prim Oranı', 'Prim Hakediş', 'Tamamlanma', 'Doluluk', 'İzin Günü', 'Müşteri'],
    body: employeeStats.map((e) => [
      e.profile.full_name ?? '—',
      String(e.totalRandevu),
      String(e.completedCount),
      currency.format(e.revenue),
      `%${e.primOrani}`,
      currency.format(e.primHakedis),
      `%${e.completionRate.toFixed(0)}`,
      `%${e.utilization.toFixed(0)}`,
      String(e.leaveDayCount),
      String(e.uniqueCustomers),
    ]),
    rightAlignFrom: 1,
  })
  await yieldToUI()

  const total = employeeStats.length
  for (let i = 0; i < total; i++) {
    const e = employeeStats[i]
    const pct = 20 + Math.round((i / Math.max(1, total)) * 68)
    onProgress(pct, `${e.profile.full_name ?? 'Çalışan'} işleniyor… (${i + 1}/${total})`)

    report.addSectionTitle(e.profile.full_name ?? 'Bilinmeyen Çalışan')
    const sourceText =
      e.sourceCounts.size > 0
        ? Array.from(e.sourceCounts.entries())
            .map(([src, count]) => `${SOURCE_LABEL[src] ?? src}: ${count}`)
            .join('  ·  ')
        : '—'
    report.addSubText(
      `En çok yapılan hizmet: ${e.topServiceName ?? '—'}     |     Kaynak dağılımı: ${sourceText}`,
    )

    const empAppts = currentAppts
      .filter((a) => a.employee_id === e.profile.id)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))

    if (empAppts.length === 0) {
      report.addSubText('Bu dönemde randevu kaydı yok.')
    } else {
      report.addTable({
        head: ['Tarih', 'Saat', 'Müşteri', 'Hizmet', 'Durum', 'Ücret'],
        body: empAppts.map((a) => {
          const d = new Date(a.scheduled_at)
          const price = a.status === 'tamamlandi' ? (a.price_override ?? serviceById.get(a.service_id ?? '')?.price ?? 0) : null
          return [
            d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
            d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            (a.customer_id ? customerById.get(a.customer_id) : null) ?? '—',
            (a.service_id ? serviceById.get(a.service_id)?.name : null) ?? '—',
            STATUS_LABEL[a.status] ?? a.status,
            price !== null ? currency.format(price) : '—',
          ]
        }),
        rightAlignFrom: 5,
      })
    }
    await yieldToUI()
  }

  onProgress(92, 'Sayfa numaraları ekleniyor…')
  report.finalizeFooters()
  await yieldToUI()

  onProgress(97, 'Kaydediliyor…')
  const filename = `performans-raporu_${rangeStart}_${rangeEnd}.pdf`
  await saveAndSharePdf(report.doc, filename)
  onProgress(100, 'Tamamlandı')
}
