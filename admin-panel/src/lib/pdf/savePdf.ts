import type { jsPDF } from 'jspdf'

export async function saveAndSharePdf(doc: jsPDF, filename: string) {
  doc.save(filename)
}
