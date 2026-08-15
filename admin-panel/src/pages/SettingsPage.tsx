import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import styles from './SettingsPage.module.css'

const REMINDER_OPTIONS = [
  { value: '', label: 'Kapalı' },
  { value: '1', label: '1 saat önce' },
  { value: '2', label: '2 saat önce' },
  { value: '4', label: '4 saat önce' },
  { value: '12', label: '12 saat önce' },
  { value: '24', label: '1 gün önce' },
  { value: '48', label: '2 gün önce' },
]

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return digits.startsWith('90') ? digits : digits.startsWith('0') ? '9' + digits : '90' + digits
}

export default function SettingsPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [reminderHours, setReminderHours] = useState('')
  const [reminderLoading, setReminderLoading] = useState(isAdmin)
  const [reminderSaving, setReminderSaving] = useState(false)
  const [reminderMsg, setReminderMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [phoneLoading, setPhoneLoading] = useState(true)
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneMsg, setPhoneMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    supabase
      .from('businesses')
      .select('reminder_hours_before')
      .eq('id', profile!.business_id)
      .maybeSingle()
      .then(({ data }) => {
        setReminderHours(data?.reminder_hours_before ? String(data.reminder_hours_before) : '')
        setReminderLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  useEffect(() => {
    if (!profile) return
    supabase
      .from('profiles')
      .select('whatsapp_phone')
      .eq('id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        setWhatsappPhone(data?.whatsapp_phone ?? '')
        setPhoneLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function saveReminder() {
    setReminderSaving(true)
    setReminderMsg(null)
    const { error } = await supabase
      .from('businesses')
      .update({ reminder_hours_before: reminderHours ? Number(reminderHours) : null })
      .eq('id', profile!.business_id)
    setReminderSaving(false)
    setReminderMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: 'Kaydedildi.' })
  }

  async function savePhone() {
    setPhoneSaving(true)
    setPhoneMsg(null)
    const normalized = normalizePhone(whatsappPhone)
    const { error } = await supabase
      .from('profiles')
      .update({ whatsapp_phone: normalized || null })
      .eq('id', profile!.id)
    setPhoneSaving(false)
    if (error) {
      const isDuplicate = /duplicate key|unique/i.test(error.message)
      setPhoneMsg({
        type: 'err',
        text: isDuplicate ? 'Bu numara başka bir hesaba kayıtlı.' : error.message,
      })
      return
    }
    setWhatsappPhone(normalized)
    setPhoneMsg({ type: 'ok', text: 'Kaydedildi.' })
  }

  return (
    <div className={styles.wrap}>
      {isAdmin && (
        <div className="card">
          <h2 className={styles.cardTitle}>Randevu hatırlatması</h2>
          <p className={styles.cardHint}>
            Müşterilere randevudan ne kadar önce hatırlatma mesajı gitsin? Kapalı seçilirse hatırlatma gönderilmez
            (randevu oluştuğunda gönderilen onay mesajı bundan etkilenmez).
          </p>
          {reminderLoading ? (
            <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
          ) : (
            <div className={styles.row}>
              <select
                className={styles.select}
                value={reminderHours}
                onChange={(e) => setReminderHours(e.target.value)}
              >
                {REMINDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={saveReminder} disabled={reminderSaving}>
                {reminderSaving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          )}
          {reminderMsg && (
            <p className={reminderMsg.type === 'ok' ? styles.msgOk : styles.msgErr}>{reminderMsg.text}</p>
          )}
        </div>
      )}

      <div className="card">
        <h2 className={styles.cardTitle}>WhatsApp numaram</h2>
        <p className={styles.cardHint}>
          Randevu yazma botuna WhatsApp'tan mesaj yazabilmek için buraya kendi numaranızı kaydedin (ör. 05551234567).
        </p>
        {phoneLoading ? (
          <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
        ) : (
          <div className={styles.row}>
            <input
              className={styles.input}
              type="text"
              placeholder="05551234567"
              value={whatsappPhone}
              onChange={(e) => setWhatsappPhone(e.target.value)}
            />
            <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={savePhone} disabled={phoneSaving}>
              {phoneSaving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        )}
        {phoneMsg && <p className={phoneMsg.type === 'ok' ? styles.msgOk : styles.msgErr}>{phoneMsg.text}</p>}
      </div>
    </div>
  )
}
