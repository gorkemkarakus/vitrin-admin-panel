import { jsPDF } from 'jspdf'
import autoTable, { type RowInput } from 'jspdf-autotable'
import { registerPdfFonts } from './registerFonts'
import { pdfColors, pdfLayout } from './theme'

export interface PdfKpiItem {
  label: string
  value: string
}

export interface PdfTableOptions {
  head: string[]
  body: RowInput[]
  rightAlignFrom?: number
}

const { marginX, marginTop, marginBottom, pageWidth, pageHeight } = pdfLayout

export class PdfReport {
  doc: jsPDF
  cursorY: number
  private reportTitle: string
  private businessName: string

  constructor(reportTitle: string, businessName: string) {
    this.reportTitle = reportTitle
    this.businessName = businessName
    this.doc = new jsPDF({ unit: 'mm', format: 'a4' })
    registerPdfFonts(this.doc)
    this.doc.setProperties({ title: reportTitle })
    this.cursorY = marginTop
  }

  private get contentWidth() {
    return pageWidth - marginX * 2
  }

  ensureSpace(height: number) {
    if (this.cursorY + height > pageHeight - marginBottom) {
      this.doc.addPage()
      this.cursorY = marginTop
    }
  }

  addCoverHeader(periodLabel: string, generatedLabel: string) {
    const doc = this.doc
    doc.setFillColor(...pdfColors.signal)
    doc.rect(0, 0, pageWidth, 3.5, 'F')

    doc.setFont('Inter', 'bold')
    doc.setFontSize(19)
    doc.setTextColor(...pdfColors.text)
    doc.text(this.reportTitle, marginX, 21)

    doc.setFont('Inter', 'semibold')
    doc.setFontSize(11)
    doc.setTextColor(...pdfColors.signal)
    doc.text(this.businessName, marginX, 28.5)

    doc.setFont('Inter', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...pdfColors.textDim)
    doc.text(periodLabel, marginX, 34.5)
    doc.text(generatedLabel, pageWidth - marginX, 34.5, { align: 'right' })

    doc.setDrawColor(...pdfColors.line)
    doc.setLineWidth(0.3)
    doc.line(marginX, 39, pageWidth - marginX, 39)

    this.cursorY = 47
  }

  addSectionTitle(text: string) {
    this.ensureSpace(13)
    const doc = this.doc
    doc.setFont('Inter', 'semibold')
    doc.setFontSize(12.5)
    doc.setTextColor(...pdfColors.text)
    doc.text(text, marginX, this.cursorY)
    this.cursorY += 2.6
    doc.setDrawColor(...pdfColors.signal2)
    doc.setLineWidth(0.7)
    doc.line(marginX, this.cursorY, marginX + 9, this.cursorY)
    this.cursorY += 6.5
  }

  addSubText(text: string) {
    this.ensureSpace(6)
    const doc = this.doc
    doc.setFont('Inter', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...pdfColors.textDim)
    doc.text(text, marginX, this.cursorY)
    this.cursorY += 6
  }

  addKpiGrid(items: PdfKpiItem[]) {
    const doc = this.doc
    const cols = Math.min(4, items.length)
    const gap = 4
    const cardW = (this.contentWidth - gap * (cols - 1)) / cols
    const cardH = 20
    const rows = Math.ceil(items.length / cols)
    this.ensureSpace(rows * (cardH + gap))
    items.forEach((item, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = marginX + col * (cardW + gap)
      const y = this.cursorY + row * (cardH + gap)
      doc.setFillColor(...pdfColors.panel2)
      doc.roundedRect(x, y, cardW, cardH, 2, 2, 'F')
      doc.setFont('Inter', 'normal')
      doc.setFontSize(7.8)
      doc.setTextColor(...pdfColors.textDim)
      doc.text(item.label, x + 3.5, y + 7.2)
      doc.setFont('Inter', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(...pdfColors.text)
      doc.text(item.value, x + 3.5, y + 15.5)
    })
    this.cursorY += rows * (cardH + gap) + 3
  }

  addTable({ head, body, rightAlignFrom }: PdfTableOptions) {
    const columnStyles: Record<number, { halign: 'right' }> = {}
    if (rightAlignFrom !== undefined) {
      for (let i = rightAlignFrom; i < head.length; i++) columnStyles[i] = { halign: 'right' }
    }
    autoTable(this.doc, {
      startY: this.cursorY,
      margin: { left: marginX, right: marginX, bottom: marginBottom },
      head: [head],
      body,
      styles: {
        font: 'Inter',
        fontSize: 8.7,
        textColor: pdfColors.text,
        lineColor: pdfColors.line,
        lineWidth: 0.15,
        cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
      },
      headStyles: {
        font: 'Inter',
        fontStyle: 'bold',
        fillColor: pdfColors.signal,
        textColor: pdfColors.white,
        fontSize: 8.3,
      },
      alternateRowStyles: { fillColor: pdfColors.panel2 },
      columnStyles,
      theme: 'grid',
    })
    const lastTable = (this.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
    this.cursorY = (lastTable?.finalY ?? this.cursorY) + 8
  }

  addWaterfall(rows: { label: string; value: string; strong?: boolean; negative?: boolean }[]) {
    this.ensureSpace(rows.length * 6.4 + 4)
    const doc = this.doc
    for (const r of rows) {
      doc.setFont('Inter', r.strong ? 'bold' : 'normal')
      doc.setFontSize(r.strong ? 10 : 9)
      doc.setTextColor(...(r.negative ? pdfColors.danger : pdfColors.text))
      doc.text(r.label, marginX, this.cursorY)
      doc.text(r.value, pageWidth - marginX, this.cursorY, { align: 'right' })
      this.cursorY += r.strong ? 7.2 : 6.2
      if (r.strong) {
        doc.setDrawColor(...pdfColors.line)
        doc.setLineWidth(0.25)
        doc.line(marginX, this.cursorY - 5.6, pageWidth - marginX, this.cursorY - 5.6)
      }
    }
    this.cursorY += 3
  }

  finalizeFooters() {
    const doc = this.doc
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      if (i > 1) {
        doc.setFont('Inter', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(...pdfColors.textDim)
        doc.text(`${this.reportTitle} — ${this.businessName}`, marginX, 10)
      }
      doc.setFont('Inter', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...pdfColors.textDim)
      doc.text(`Sayfa ${i} / ${pageCount}`, pageWidth - marginX, pageHeight - 9, { align: 'right' })
      doc.setDrawColor(...pdfColors.line)
      doc.setLineWidth(0.2)
      doc.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12)
    }
  }
}
