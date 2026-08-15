import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { MegaphoneIcon, WalletIcon, TrendingUpIcon, CheckCircleIcon, PieChartIcon, TrophyIcon } from '../components/icons'
import { currencyWhole as currency } from '../lib/currency'
import styles from './AdInsightsPage.module.css'

type ConnectionStatus = 'pending' | 'connected' | 'error'

interface Connection {
  status: ConnectionStatus
  ad_account_name: string | null
  last_synced_at: string | null
  last_error: string | null
}

interface Insights {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  roas: number | null
}

type RangeDays = 7 | 30

const number = new Intl.NumberFormat('tr-TR')

// Meta App Dashboard'da olusturulan Business Login Configuration'in ID'si —
// gizli degil, dialog URL'inde acikca gorunur (client_secret ASLA burada
// olmaz, o sadece backend'de meta-oauth-callback icinde kullanilir).
function buildOAuthUrl(state: string) {
  const url = new URL('https://www.facebook.com/v23.0/dialog/oauth')
  url.searchParams.set('client_id', import.meta.env.VITE_META_APP_ID)
  url.searchParams.set('redirect_uri', `${window.location.origin}/reklam-callback`)
  url.searchParams.set('config_id', import.meta.env.VITE_META_CONFIG_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return url.toString()
}

export default function AdInsightsPage() {
  const { session } = useAuth()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [loading, setLoading] = useState(true)
  const [rangeDays, setRangeDays] = useState<RangeDays>(7)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  async function loadConnection() {
    setLoading(true)
    const { data } = await supabase
      .from('business_ad_connections')
      .select('status, ad_account_name, last_synced_at, last_error')
      .maybeSingle()
    setConnection(data)
    setLoading(false)
  }

  useEffect(() => {
    loadConnection()
  }, [])

  useEffect(() => {
    if (connection?.status !== 'connected' || !session) return
    let cancelled = false
    async function loadInsights() {
      setInsightsLoading(true)
      setError(null)
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-ad-insights`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ range_days: rangeDays }),
        })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(body.error ?? 'Veriler alınamadı.')
          return
        }
        setInsights(body.data)
      } catch {
        if (!cancelled) setError('Sunucuya ulaşılamadı, tekrar deneyin.')
      } finally {
        if (!cancelled) setInsightsLoading(false)
      }
    }
    loadInsights()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.status, rangeDays, session?.access_token])

  function handleConnect() {
    // CSRF korumasi: rastgele bir 'state' uretilip tarayicida saklanir,
    // Meta'nin geri donusunde ayni degeri iade edip etmedigi
    // AdOAuthCallbackPage'de dogrulanir — saldirganin kendi Meta hesabini
    // kurbanin oturumuna baglamasini (OAuth login CSRF) engeller.
    const state = crypto.randomUUID()
    sessionStorage.setItem('meta_oauth_state', state)
    window.location.href = buildOAuthUrl(state)
  }

  async function handleDisconnect() {
    const ok = window.confirm('Facebook reklam hesabı bağlantısını kaldırmak istediğinize emin misiniz?')
    if (!ok || !session) return
    setError(null)
    setDisconnecting(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/disconnect-ad-account`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Bağlantı kaldırılamadı.')
        return
      }
      setConnection(null)
      setInsights(null)
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setDisconnecting(false)
    }
  }

  const isConnected = connection?.status === 'connected'

  return (
    <div className={styles.wrap}>
      {loading ? (
        <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
      ) : !isConnected ? (
        <div className="card">
          <div className={styles.connectState}>
            <span className={styles.connectIcon}>
              <MegaphoneIcon width={26} height={26} />
            </span>
            <h2 className={styles.connectTitle}>Reklam Performansı</h2>
            <p className={styles.connectText}>
              Facebook reklam hesabınızı bağlayın; harcama, gösterim, tıklama, dönüşüm ve ROAS verilerinizi buradan
              görün.
            </p>
            {connection?.status === 'error' && connection.last_error && (
              <p className={styles.errorText}>{connection.last_error}</p>
            )}
            <button type="button" className="btn-primary" onClick={handleConnect}>
              Facebook ile Bağlan
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={`card ${styles.connectedHead}`}>
            <div className={styles.connectedInfo}>
              <span className={styles.connectedName}>{connection.ad_account_name}</span>
              <span className={styles.connectedSync}>
                {connection.last_synced_at
                  ? `Son senkronizasyon: ${new Date(connection.last_synced_at).toLocaleString('tr-TR')}`
                  : 'Henüz senkronize edilmedi'}
              </span>
            </div>
            <button
              type="button"
              className={`btn-secondary ${styles.disconnectBtn}`}
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Kaldırılıyor…' : 'Bağlantıyı Kaldır'}
            </button>
          </div>

          <div className={styles.presetRow}>
            <button
              type="button"
              className={rangeDays === 7 ? styles.presetBtnActive : styles.presetBtn}
              onClick={() => setRangeDays(7)}
            >
              Son 7 Gün
            </button>
            <button
              type="button"
              className={rangeDays === 30 ? styles.presetBtnActive : styles.presetBtn}
              onClick={() => setRangeDays(30)}
            >
              Son 30 Gün
            </button>
          </div>

          {error && <p className={styles.errorText}>{error}</p>}

          {insightsLoading ? (
            <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
          ) : insights ? (
            <div className={styles.kpiGrid}>
              <div className={styles.kpiCard}>
                <span className={styles.kpiIcon} style={{ background: '#dbeafe', color: '#2563eb' }}>
                  <WalletIcon width={17} height={17} />
                </span>
                <span className={styles.kpiValue}>{currency.format(insights.spend)}</span>
                <span className={styles.kpiLabel}>Harcama</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiIcon} style={{ background: '#ede9fe', color: '#8b5cf6' }}>
                  <PieChartIcon width={17} height={17} />
                </span>
                <span className={styles.kpiValue}>{number.format(insights.impressions)}</span>
                <span className={styles.kpiLabel}>Gösterim</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiIcon} style={{ background: '#fce7f3', color: '#ec4899' }}>
                  <TrendingUpIcon width={17} height={17} />
                </span>
                <span className={styles.kpiValue}>{number.format(insights.clicks)}</span>
                <span className={styles.kpiLabel}>Tıklama</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiIcon} style={{ background: '#d1fae5', color: '#0e9668' }}>
                  <CheckCircleIcon width={17} height={17} />
                </span>
                <span className={styles.kpiValue}>{number.format(insights.conversions)}</span>
                <span className={styles.kpiLabel}>Dönüşüm</span>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiIcon} style={{ background: '#fef3c7', color: '#c9971c' }}>
                  <TrophyIcon width={17} height={17} />
                </span>
                <span className={styles.kpiValue}>{insights.roas !== null ? `${insights.roas.toFixed(2)}x` : '—'}</span>
                <span className={styles.kpiLabel}>
                  {insights.roas !== null ? 'ROAS' : 'ROAS (dönüşüm takibi yok)'}
                </span>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
