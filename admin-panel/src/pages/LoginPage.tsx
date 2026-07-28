import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import { useAuth } from '../contexts/AuthContext'
import styles from './LoginPage.module.css'

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
            <input
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
            <input
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
        </form>
      </div>
    </div>
  )
}
