import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Select from '../components/Select'
import { ChevronRightIcon } from '../components/icons'
import styles from './EmployeeCreatePage.module.css'

const GENDER_OPTIONS = [
  { value: '', label: 'Belirtilmesin' },
  { value: 'kadin', label: 'Kadın' },
  { value: 'erkek', label: 'Erkek' },
]

export default function EmployeeCreatePage() {
  const navigate = useNavigate()
  const { session } = useAuth()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [gender, setGender] = useState<'' | 'kadin' | 'erkek'>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-team-member`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, password, full_name: fullName, phone, gender: gender || null }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Hesap oluşturulamadı.')
        return
      }
      navigate(`/ekip/${body.data.id}`, { replace: true })
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.backBtn} onClick={() => navigate('/ekip')}>
        <ChevronRightIcon width={14} height={14} className={styles.backIcon} />
        Ekibe Dön
      </button>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Yeni Çalışan Ekle</h2>
        <p className={styles.subtitle}>Çalışanın hesabını oluşturmak için bilgilerini gir.</p>

        {error && <p className={styles.error}>{error}</p>}

        <form onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="fullName">Ad Soyad</label>
            <input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ayşe Yılmaz"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="newEmail">E-posta</label>
            <input
              id="newEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ayse@ornek.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="newPhone">Telefon</label>
            <input
              id="newPhone"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="05xx xxx xx xx"
              required
              minLength={10}
            />
          </div>
          <div className="field">
            <label htmlFor="newPassword">Geçici şifre</label>
            <input
              id="newPassword"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="en az 6 karakter"
              required
              minLength={6}
            />
          </div>
          <div className="field">
            <label htmlFor="newGender">Cinsiyet (opsiyonel)</label>
            <Select
              id="newGender"
              value={gender}
              onChange={(v) => setGender(v as '' | 'kadin' | 'erkek')}
              options={GENDER_OPTIONS}
            />
            <p className={styles.hint}>
              Müşteri sohbet botunda "kadın/erkek çalışan olsun" dediğinde doğru cevap verebilmek için kullanılır.
            </p>
          </div>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Oluşturuluyor…' : 'Hesap Oluştur'}
          </button>
        </form>
      </div>
    </div>
  )
}
