import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { LayoutOutletContext } from '../layouts/DashboardLayout'
import Avatar from '../components/Avatar'
import styles from './UserManagementPage.module.css'

interface TeamProfile {
  id: string
  full_name: string | null
  role: 'admin' | 'user'
  is_active: boolean
  gender: 'kadin' | 'erkek' | null
}

export default function UserManagementPage() {
  const { profile, session } = useAuth()
  const { searchQuery, setSearchPlaceholder } = useOutletContext<LayoutOutletContext>()
  const [members, setMembers] = useState<TeamProfile[]>([])
  const [maxUsers, setMaxUsers] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [gender, setGender] = useState<'' | 'kadin' | 'erkek'>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    const [{ data: profiles }, { data: business }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, role, is_active, gender')
        .order('role', { ascending: false })
        .order('full_name', { ascending: true }),
      supabase.from('businesses').select('max_users').maybeSingle(),
    ])
    setMembers(profiles ?? [])
    setMaxUsers(business?.max_users ?? null)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    setSearchPlaceholder('Personel ara…')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeUserCount = members.filter((m) => m.role === 'user' && m.is_active).length

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-team-member`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email, password, full_name: fullName, gender: gender || null }),
        },
      )
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Kullanıcı oluşturulamadı.')
        return
      }
      setSuccess(`${fullName} eklendi.`)
      setFullName('')
      setEmail('')
      setPassword('')
      setGender('')
      await loadData()
    } catch {
      setError('Sunucuya ulaşılamadı, tekrar deneyin.')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(member: TeamProfile) {
    await supabase.from('profiles').update({ is_active: !member.is_active }).eq('id', member.id)
    await loadData()
  }

  async function updateGender(member: TeamProfile, newGender: '' | 'kadin' | 'erkek') {
    await supabase.from('profiles').update({ gender: newGender || null }).eq('id', member.id)
    await loadData()
  }

  const seatsFull = maxUsers !== null && activeUserCount >= maxUsers

  return (
    <div className={styles.wrap}>
      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Yeni çalışan ekle</h2>
        <p className={styles.seatBadge}>
          Kullanılan koltuk: <strong>{activeUserCount}</strong> / {maxUsers ?? '—'}
        </p>
        {maxUsers !== null && (
          <div className={styles.seatBar} style={{ marginBottom: 16 }}>
            <div
              className={styles.seatBarFill}
              style={{ width: `${Math.min(100, (activeUserCount / maxUsers) * 100)}%` }}
            />
          </div>
        )}

        {seatsFull && (
          <p className={`${styles.message} ${styles.messageError}`} style={{ marginBottom: 16 }}>
            Kullanıcı limitiniz doldu. Yeni hesap açmak için önce bir çalışanı pasife alın.
          </p>
        )}
        {error && (
          <p className={`${styles.message} ${styles.messageError}`} style={{ marginBottom: 16 }}>
            {error}
          </p>
        )}
        {success && (
          <p className={`${styles.message} ${styles.messageSuccess}`} style={{ marginBottom: 16 }}>
            {success}
          </p>
        )}

        <form className={styles.form} onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="fullName">Ad Soyad</label>
            <input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ayşe Yılmaz"
              required
              disabled={seatsFull}
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
              disabled={seatsFull}
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
              disabled={seatsFull}
            />
          </div>
          <div className="field">
            <label htmlFor="newGender">Cinsiyet (opsiyonel)</label>
            <select
              id="newGender"
              value={gender}
              onChange={(e) => setGender(e.target.value as '' | 'kadin' | 'erkek')}
              disabled={seatsFull}
            >
              <option value="">Belirtilmesin</option>
              <option value="kadin">Kadın</option>
              <option value="erkek">Erkek</option>
            </select>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
              Müşteri sohbet botunda "kadın/erkek çalışan olsun" dediğinde doğru cevap verebilmek için kullanılır.
            </p>
          </div>
          <button type="submit" className="btn-primary" disabled={submitting || seatsFull}>
            {submitting ? 'Ekleniyor…' : 'Ekle'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Ekip</h2>
        {loading ? (
          <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ad Soyad</th>
                <th>Rol</th>
                <th>Cinsiyet</th>
                <th>Durum</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(searchQuery.trim()
                ? members.filter((m) => (m.full_name ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase()))
                : members
              ).map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className={styles.nameCell}>
                      <Avatar name={m.full_name ?? '?'} size={28} />
                      {m.full_name ?? '—'}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.roleBadge} ${m.role === 'admin' ? styles.roleBadgeAdmin : ''}`}
                    >
                      {m.role === 'admin' ? 'Yönetici' : 'Çalışan'}
                    </span>
                  </td>
                  <td>
                    <select
                      value={m.gender ?? ''}
                      onChange={(e) => updateGender(m, e.target.value as '' | 'kadin' | 'erkek')}
                      aria-label={`${m.full_name ?? 'Çalışan'} cinsiyeti`}
                    >
                      <option value="">Belirtilmemiş</option>
                      <option value="kadin">Kadın</option>
                      <option value="erkek">Erkek</option>
                    </select>
                  </td>
                  <td>
                    <span className={styles.statusDot}>
                      <span className={m.is_active ? styles.dotActive : styles.dotInactive} />
                      {m.is_active ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td>
                    {m.id !== profile?.id && m.role !== 'admin' && (
                      <button className="btn-secondary" onClick={() => toggleActive(m)}>
                        {m.is_active ? 'Pasife al' : 'Aktifleştir'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
