import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import { useAuth } from '../contexts/AuthContext'
import styles from './LoginPage.module.css'
import { FIELD_LIMITS } from '../lib/fieldLimits'

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: err } = await signIn(email, password)
    setLoading(false)
    if (err) {
      setError('E-posta veya şifre hatalı.')
      return
    }
    navigate('/randevular')
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <Logo />
        </div>
        <h1 className={styles.title}>Hoş Geldiniz</h1>
        <p className={styles.sub}>Lütfen hesabınıza giriş yapın</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">E-posta Adresi</label>
            <input maxLength={FIELD_LIMITS.email}
              id="email"
              type="email"
              placeholder="isletmeniz@ornek.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Şifre</label>
            <input maxLength={FIELD_LIMITS.password}
              id="password"
              type="password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Giriş yapılıyor…' : 'Giriş yap →'}
          </button>
          <p className={styles.legal}>
            Giriş yaparak <a href="/legal/kullanim-kosullari.html">Kullanım Koşulları</a>&apos;nı kabul etmiş olursunuz.
            Verileriniz <a href="/legal/gizlilik.html">Gizlilik Politikası</a> ve{' '}
            <a href="/legal/kvkk.html">KVKK Aydınlatma Metni</a>&apos;ne göre işlenir.
          </p>
        </form>
      </div>
    </div>
  )
}
