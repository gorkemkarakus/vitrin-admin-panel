import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { SparkleIcon } from './icons'
import type { Template } from '../pages/TopluMesajPage'
import styles from './TemplateModal.module.css'
import { FIELD_LIMITS } from '../lib/fieldLimits'
import { friendlyDbError } from '../lib/dbErrors'

export default function TemplateModal({
  template,
  onClose,
  onSaved,
  onDeleted,
}: {
  template: Template | null
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const { profile, session } = useAuth()
  const [title, setTitle] = useState(template?.title ?? '')
  const [message, setMessage] = useState(template?.message ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)

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

  async function handleSave() {
    if (!title.trim() || !message.trim()) {
      setError('Başlık ve mesaj gerekli')
      return
    }
    setSaving(true)
    setError(null)
    if (template) {
      const { error: err } = await supabase
        .from('campaign_message_templates')
        .update({ title: title.trim(), message: message.trim() })
        .eq('id', template.id)
      if (err) {
        setError(friendlyDbError(err, 'Şablon kaydedilemedi, tekrar deneyin.'))
        setSaving(false)
        return
      }
    } else {
      if (!profile?.business_id) return
      const { error: err } = await supabase
        .from('campaign_message_templates')
        .insert({ business_id: profile.business_id, title: title.trim(), message: message.trim() })
      if (err) {
        setError(friendlyDbError(err, 'Şablon kaydedilemedi, tekrar deneyin.'))
        setSaving(false)
        return
      }
    }
    setSaving(false)
    onSaved()
  }

  async function handleDelete() {
    if (!template) return
    const ok = window.confirm(`"${template.title}" şablonunu silmek istediğinize emin misiniz?`)
    if (!ok) return
    const { error: err } = await supabase.from('campaign_message_templates').delete().eq('id', template.id)
    if (err) {
      setError(friendlyDbError(err, 'Şablon kaydedilemedi, tekrar deneyin.'))
      return
    }
    onDeleted()
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={`card ${styles.card}`} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>{template ? 'Şablonu Düzenle' : 'Yeni Şablon'}</h2>

        <div className="field">
          <label htmlFor="templateTitle">Başlık</label>
          <input maxLength={FIELD_LIMITS.campaignMessageTemplatesTitle} id="templateTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Örn. İptal Edenler için hatırlatma" />
        </div>
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
          <label htmlFor="templateMessage">Mesaj</label>
          <textarea maxLength={FIELD_LIMITS.campaignMessageTemplatesMessage}
            id="templateMessage"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Kampanya mesajınızı yazın veya yukarıdan AI ile oluşturun…"
          />
        </div>

        {error && <p className={styles.errorText}>{error}</p>}

        <div className={styles.actions}>
          {template && (
            <button type="button" className={`btn-secondary ${styles.deleteBtn}`} onClick={handleDelete}>
              Sil
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  )
}
