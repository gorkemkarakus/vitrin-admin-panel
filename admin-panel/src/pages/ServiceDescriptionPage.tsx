import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import styles from './ServiceDescriptionPage.module.css'

interface Service {
  id: string
  name: string
  description: string | null
}

const GUIDING_QUESTIONS = [
  'Bu hizmet tam olarak neyi içeriyor, nasıl uygulanıyor?',
  'Ağrılı/rahatsız edici mi? Hassas cilt, hamilelik gibi durumlarda uygun mu?',
  'Kimler bu hizmeti alamaz (alerji, cilt/saç durumu, yaş sınırı vb.)?',
  'Sonuç kaç seansta / ne kadar sürede görülür, etkisi ne kadar kalıcı?',
  'Öncesinde ve sonrasında dikkat edilmesi gereken bir şey var mı (bakım, kaçınılması gerekenler)?',
  'Hangi ürün, malzeme veya teknik kullanılıyor?',
  'Müşterilerin bu hizmetle ilgili sık sorduğu başka bir şey var mı (ör. benzer hizmetlerle farkı)?',
]

export default function ServiceDescriptionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [service, setService] = useState<Service | null>(null)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('services')
        .select('id, name, description')
        .eq('id', id)
        .maybeSingle()
      setService(data)
      setDescription(data?.description ?? '')
      setLoading(false)
    }
    load()
  }, [id])

  async function save() {
    if (!id) return
    setSaving(true)
    await supabase.from('services').update({ description: description.trim() || null }).eq('id', id)
    setSaving(false)
    setSavedHint(true)
    setTimeout(() => setSavedHint(false), 2000)
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
  if (!service) return <p style={{ color: 'var(--text-dim)' }}>Hizmet bulunamadı.</p>

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.backLink} onClick={() => navigate('/hizmetler')}>
        ← Hizmetlere dön
      </button>

      <div>
        <div className={styles.serviceTitle}>{service.name} — Chatbot açıklaması</div>
      </div>

      <div className="card">
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 4 }}>
          Chatbot, müşteriler bu hizmet hakkında bilgi istediğinde SADECE aşağıya yazdığınız
          metni kullanır — kendi başına bilgi uydurmaz. Aşağıdaki soruları düşünerek yazarsanız,
          müşterilerin sık sorduğu neredeyse her şeyi baştan cevaplamış olursunuz:
        </p>
        <div className={styles.hintList}>
          {GUIDING_QUESTIONS.map((q) => (
            <div className={styles.hintItem} key={q}>
              <span>—</span>
              <span>{q}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <textarea
          className={styles.textarea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="ör. Fransız manikür, tırnaklara doğal bir görünüm veren, uç kısmı beyaz, geri kalanı şeffaf/pembemsi tonda boyanan klasik bir manikür tekniğidir. Ağrısızdır, hassas tırnaklarda da uygulanabilir. Ortalama 3-4 hafta kalıcıdır..."
        />
        <div className={styles.footerRow} style={{ marginTop: 12 }}>
          <button type="button" className={`btn-primary ${styles.saveBtn}`} onClick={save} disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          {savedHint && <span className={styles.savedHint}>Kaydedildi ✓</span>}
          <span className={styles.charCount}>{description.length} karakter</span>
        </div>
      </div>
    </div>
  )
}
