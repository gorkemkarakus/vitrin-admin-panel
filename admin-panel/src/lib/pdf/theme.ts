// theme.css'teki CSS degiskenlerinin PDF icin duz hex karsiliklari —
// jsPDF CSS custom property okuyamadigi icin sabitler burada tekrarlaniyor.
export const pdfColors = {
  signal: [0, 74, 173] as [number, number, number], // --signal
  signal2: [139, 92, 246] as [number, number, number], // --signal-2
  text: [31, 41, 55] as [number, number, number], // --text
  textDim: [100, 116, 139] as [number, number, number], // --text-dim
  line: [226, 232, 240] as [number, number, number], // --line
  panel2: [248, 250, 252] as [number, number, number], // --panel-2
  ok: [14, 150, 104] as [number, number, number], // --ok-text
  danger: [220, 38, 38] as [number, number, number], // --danger-text
  warn: [217, 119, 6] as [number, number, number], // --warn-text
  white: [255, 255, 255] as [number, number, number],
}

export const pdfLayout = {
  pageWidth: 210,
  pageHeight: 297,
  marginX: 14,
  marginTop: 16,
  marginBottom: 16,
}
