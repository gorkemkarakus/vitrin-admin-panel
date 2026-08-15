import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import styles from './AdOAuthCallbackPage.module.css'

interface AdAccount {
  id: string
  name: string
}

type Step = 'exchanging' | 'picking' | 'finalizing' | 'error'

export default function AdOAuthCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { session } = useAuth()

  const [step, setStep] = useState<Step>('exchanging')
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const ranOnce = useRef(false)

  useEffect(() => {
    if (ranOnce.current || !session) return
    ranOnce.current = true

    const metaError = searchParams.get('error')
    const metaErrorDescription = searchParams.get('error_description')
    if (metaError) {
      setStep('error')
      setError(metaErrorDescription || 'Facebook bağlantısı reddedildi.')
      return
    }

    const code = searchParams.get('code')
    const returnedState = searchParams.get('state')
    // CSRF dogrulamasi: AdInsightsPage'in olusturup sessionStorage'a yazdigi
    // 'state' ile Meta'nin geri gonderdigi 'state' BIREBIR eslesmeli. Ya
    // eslesmezse ya da hic yoksa akis burada DURDURULUR — sahte bir 'code'
    // ile baskasinin oturumuna baglanti eklenmesi (OAuth login CSRF) boylece
    // engellenir. Deger tek kullanimlik: okunur okunmaz hemen silinir.
    const storedState = sessionStorage.getItem('meta_oauth_state')
    sessionStorage.removeItem('meta_oauth_state')

    if (!code || !returnedState || !storedState || returnedState !== storedState) {
      setStep('error')
      setError('Güvenlik doğrulaması başarısız oldu. Lütfen tekrar deneyin.')
      return
    }

    async function exchangeCode() {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-oauth-callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ code, redirect_uri: `${window.location.origin}/reklam-callback` }),
        })
        const body = await res.json()
        if (!res.ok) {
          setStep('error')
          setError(body.error ?? 'Bağlantı kurulamadı.')
          return
        }

        const adAccounts: AdAccount[] = body.data.ad_accounts
        if (adAccounts.length === 1) {
          await finalizeSelection(adAccounts[0])
        } else {
          setAccounts(adAccounts)
          setStep('picking')
        }
      } catch {
        setStep('error')
        setError('Sunucuya ulaşılamadı, tekrar deneyin.')
      }
    }

    exchangeCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function finalizeSelection(account: AdAccount) {
    setStep('finalizing')
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/select-ad-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ ad_account_id: account.id }),
      })
      const body = await res.json()
      if (!res.ok) {
        setStep('error')
        setError(body.error ?? 'Reklam hesabı bağlanamadı.')
        return
      }
      navigate('/reklam', { replace: true })
    } catch {
      setStep('error')
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    }
  }

  return (
    <div className={styles.wrap}>
      {(step === 'exchanging' || step === 'finalizing') && <p style={{ color: 'var(--text-dim)' }}>Bağlanıyor…</p>}

      {step === 'error' && (
        <div className="card">
          <p className={styles.errorText}>{error}</p>
          <button type="button" className="btn-primary" onClick={() => navigate('/reklam', { replace: true })}>
            Reklam Performansına Dön
          </button>
        </div>
      )}

      {step === 'picking' && (
        <div className="card">
          <h2 className={styles.pickTitle}>Hangi reklam hesabını bağlamak istiyorsunuz?</h2>
          <div className={styles.accountList}>
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={styles.accountRow}
                onClick={() => finalizeSelection(account)}
              >
                {account.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
