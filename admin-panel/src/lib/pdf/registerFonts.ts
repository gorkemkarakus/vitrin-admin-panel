import type { jsPDF } from 'jspdf'
import { INTER_REGULAR_BASE64 } from './fonts/interRegular'
import { INTER_SEMIBOLD_BASE64 } from './fonts/interSemiBold'
import { INTER_BOLD_BASE64 } from './fonts/interBold'

// jsPDF'in standart fontlari (helvetica vb.) Turkce karakterleri
// (ş ğ ı İ Ç Ö Ü) ve Lira isaretini (₺) desteklemiyor — bu yuzden
// uygulamanin kendi govde fontu Inter'in statik agirliklari (Latin +
// Latin Extended-A + Lira alt kumesine indirgenmis) her PDF'e gomuluyor.
export function registerPdfFonts(doc: jsPDF) {
  doc.addFileToVFS('Inter-Regular.ttf', INTER_REGULAR_BASE64)
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal')
  doc.addFileToVFS('Inter-SemiBold.ttf', INTER_SEMIBOLD_BASE64)
  doc.addFont('Inter-SemiBold.ttf', 'Inter', 'semibold')
  doc.addFileToVFS('Inter-Bold.ttf', INTER_BOLD_BASE64)
  doc.addFont('Inter-Bold.ttf', 'Inter', 'bold')
  doc.setFont('Inter', 'normal')
}
