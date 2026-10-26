// Adapptiv'in her salonun WhatsApp hesabinda kurdugu hizmet (UTILITY)
// sablonlari. Musteri son 24 saatte yazmadiysa WhatsApp yalnizca Meta'nin
// onayladigi sablonla mesaja izin verir; yazdiysa ayni metin ucretsiz duz
// mesaj olarak gider (renderTemplate). Sablon adlari "adapptiv_" ile baslar ki
// salonun kendi olusturdugu sablonlarla karismasin.
export const TEMPLATE_LANG = 'tr'

export type TemplateKey = 'confirmation' | 'reminder'

export interface TemplateDef {
  name: string
  // {{1}} ad, {{2}} salon, {{3}} hizmet, {{4}} tarih, {{5}} saat
  body: string
  example: string[]
  // hizli cevap dugmeleri (en fazla 20 karakter); sirasi gonderimdeki
  // dugme verisiyle (appointmentButtons) ayni
  buttons?: string[]
}

const EXAMPLE = ['Ayşe', 'Güzel Salon', 'Pedikür', '30 Ekim Cuma', '14:00']

export const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  confirmation: {
    name: 'adapptiv_randevu_onay',
    body: 'Merhaba {{1}}, {{2}} randevunuz oluşturuldu: {{3}}, {{4}} saat {{5}}. Bir değişiklik olursa bu mesaja yazmanız yeterli. Görüşmek üzere!',
    example: EXAMPLE,
  },
  // Dugmeli surum: musteri tek dokunusla onaylar, iptal eder ya da saati
  // degistirmek ister (eski dugmesiz 'adapptiv_randevu_hatirlatma' kullanilmiyor).
  reminder: {
    name: 'adapptiv_hatirlatma_onay',
    body: 'Merhaba {{1}}, {{2}} randevunuzu hatırlatmak isteriz: {{3}}, {{4}} saat {{5}}. Gelebilecek misiniz?',
    example: EXAMPLE,
    buttons: ['Geleceğim', 'Saati değiştir', 'İptal et'],
  },
}

// Hatirlatma dugmelerinin musteriden geri gelen verisi: "appt:<islem>:<randevu id>"
export type AppointmentAction = 'confirm' | 'reschedule' | 'cancel'
const BUTTON_ACTIONS: AppointmentAction[] = ['confirm', 'reschedule', 'cancel']

export function appointmentButtons(appointmentId: string): { id: string; title: string }[] {
  return (TEMPLATES.reminder.buttons ?? []).map((title, i) => ({ id: `appt:${BUTTON_ACTIONS[i]}:${appointmentId}`, title }))
}

export function parseAppointmentButton(payload: string | null | undefined): { action: AppointmentAction; appointmentId: string } | null {
  const m = (payload ?? '').match(/^appt:(confirm|reschedule|cancel):([0-9a-f-]{36})$/i)
  return m ? { action: m[1] as AppointmentAction, appointmentId: m[2].toLowerCase() } : null
}

export function renderTemplate(key: TemplateKey, params: string[]): string {
  return TEMPLATES[key].body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '')
}

// Randevu sablonlarinin degiskenleri, sablondaki sirayla.
export function appointmentParams(input: {
  customerName: string | null | undefined
  businessName: string | null | undefined
  serviceName: string | null | undefined
  scheduledAt: string
}): string[] {
  const d = new Date(input.scheduledAt)
  const firstName = (input.customerName ?? '').trim().split(/\s+/)[0]
  return [
    // "Müşteri": bot numarayi kaydedip adini henuz ogrenemedigi kisi
    firstName && firstName !== 'Müşteri' ? firstName : 'değerli müşterimiz',
    input.businessName?.trim() || 'işletmemiz',
    input.serviceName?.trim() || 'randevu',
    d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'Europe/Istanbul' }),
    d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
  ]
}
