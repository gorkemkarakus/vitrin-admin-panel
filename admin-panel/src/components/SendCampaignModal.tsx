import { useState } from 'react'
import { OPT_OUT_FOOTER } from '../lib/marketing'
import { useAuth } from '../contexts/AuthContext'
import { SparkleIcon } from './icons'
import Select from './Select'
import type { Template } from '../pages/TopluMesajPage'
import styles from './SendCampaignModal.module.css'import { FIELD_LIMITS } from '../lib/fieldLimits'


export default function SendCampaignModal({
  targetName,
  memberIds,
  initialMessage,
  templates,
  onClose,
}: {
  targetName: string
  memberIds: string[]
  initialMessage?: string
  templates: Template[]
  onClose: () => void
}) {
  const { session } = useAuth()
  const [message, setMessage] = useState(initialMessage ?? '')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)

  function handlePickTemplate(templateId: string) {
    setSelectedTemplateId(templateId)
    const t = templates.find((tpl) => tpl.id === templateId)
    if (t) setMessage(t.message)
  }

  async function handleGenerateAi() {
    if (!session || !aiPrompt.trim() || aiGenerating) return
    setAiGenerating(true)
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-campaign-message`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: aiPrompt.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Mesaj oluşturulamadı.')
        return
      }
      setMessage(body.data.message)
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setAiGenerating(false)
    }
  }

  async function handleSend() {
    if (!session || !message.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-bulk-campaign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ customerIds: memberIds, message: message.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Gönderilemedi.')
        return
      }
      setResult(body.data)
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={`card ${styles.card}`} onClick={(e) => e.stopPropagation()}>
        {result ? (
          <>
            <h2 className={styles.title}>Kaydedildi</h2>
            <p className={styles.resultText}>
              <strong>{result.sent}</strong> müşteri için mesaj kaydedildi{result.failed > 0 ? ` (${result.failed} başarısız — telefon numarası eksik olabilir)` : ''}.
            </p>
            <p className={styles.hint}>
              WhatsApp bağlantısı henüz aktif değil — gerçek gönderim, bağlantı kurulduğunda bu mesajlar için otomatik başlayacak.
            </p>
            <button type="button" className="btn-primary" onClick={onClose}>
              Tamam
            </button>
          </>
        ) : (
          <>
            <h2 className={styles.title}>Mesaj Gönder</h2>
            <p className={styles.target}>
              <strong>{targetName}</strong> — {memberIds.length} kişi
            </p>
            {templates.length > 0 && (
              <div className="field">
                <label htmlFor="templatePick">Kampanya Mesajlarından Seç (opsiyonel)</label>
                <Select
                  id="templatePick"
                  value={selectedTemplateId}
                  onChange={handlePickTemplate}
                  placeholder="Bir şablon seçin…"
                  options={templates.map((t) => ({
                    value: t.id,
                    label: t.title,
                    sub: t.message.length > 60 ? `${t.message.slice(0, 60)}…` : t.message,
                  }))}
                />
              </div>
            )}
            <div className={styles.aiBlock}>
              <span className={styles.aiLabel}>
                <SparkleIcon width={13} height={13} />
                AI ile Oluştur
              </span>
              <div className={styles.aiRow}>
                <input maxLength={FIELD_LIMITS.aiPrompt}
                  className={styles.aiInput}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Ör. %15 indirim mesajı"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleGenerateAi()
                    }
                  }}
                />
                <button type="button" className={styles.aiBtn} onClick={handleGenerateAi} disabled={aiGenerating || !aiPrompt.trim()}>
                  {aiGenerating ? 'Yazılıyor…' : 'Oluştur'}
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="campaignMessage">Mesaj</label>
              <textarea maxLength={FIELD_LIMITS.campaignMessageTemplatesMessage}
                id="campaignMessage"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Müşterilerinize göndermek istediğiniz mesajı yazın veya yukarıdan AI ile oluşturun…"
              />
            </div>
            <p className={styles.hint}>
              Mesajın sonuna otomatik eklenir: “{OPT_OUT_FOOTER}” Yalnızca kampanya izni olan müşterilere gider.
            </p>
            <p className={styles.hint}>
              Not: WhatsApp bağlantısı henüz aktif değil, bu mesaj gerçekten gönderilmeyecek — kayıt altına alınacak.
            </p>
            {error && <p className={styles.errorText}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" className="btn-secondary" onClick={onClose}>
                Vazgeç
              </button>
              <button type="button" className="btn-primary" onClick={handleSend} disabled={sending || !message.trim()}>
                {sending ? 'Gönderiliyor…' : 'Gönder'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
