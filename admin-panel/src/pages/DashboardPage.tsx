import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import DonutChart from '../components/DonutChart'
import Avatar, { colorForName } from '../components/Avatar'
import { CalendarIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '../components/icons'
import type { LayoutOutletContext } from '../layouts/DashboardLayout'
import styles from './DashboardPage.module.css'

interface Appointment {
  id: string
  service_id: string | null
  employee_id: string | null
  created_by_user_id: string | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal'
  source: string
}

interface Service {
  id: string
  price: number | null
}

interface Profile {
  id: string
  full_name: string | null
}

const SOURCE_ORDER: { value: string; label: string; color: string }[] = [
  { value: 'kullanici_uzerinden', label: 'Çalışan Üzerinden', color: '#3d4632' },
  { value: 'dogrudan_musteri', label: 'Doğrudan Müşteri', color: '#8b6f47' },
  { value: 'chatbot', label: 'Chatbot', color: '#2f5aa8' },
  { value: 'online_randevu', label: 'Online Randevu', color: '#2f8f6b' },
  { value: 'diger', label: 'Diğer', color: '#a1731f' },
]

const currency = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })

export default function DashboardPage() {
  const { searchQuery, setSearchPlaceholder } = useOutletContext<LayoutOutletContext>()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setSearchPlaceholder('Personel ara…')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    async function load() {
      const [{ data: appts }, { data: svcs }, { data: profs }] = await Promise.all([
        supabase.from('appointments').select('id, service_id, employee_id, created_by_user_id, status, source'),
        supabase.from('services').select('id, price'),
        supabase.from('profiles').select('id, full_name'),
      ])
      setAppointments(appts ?? [])
      setServices(svcs ?? [])
      setProfiles(profs ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  const servicePriceById = new Map(services.map((s) => [s.id, s.price ?? 0]))
  const profileNameById = new Map(profiles.map((p) => [p.id, p.full_name ?? '—']))

  const total = appointments.length
  const statusCounts = {
    bekliyor: appointments.filter((a) => a.status === 'bekliyor').length,
    onaylandi: appointments.filter((a) => a.status === 'onaylandi').length,
    tamamlandi: appointments.filter((a) => a.status === 'tamamlandi').length,
    iptal: appointments.filter((a) => a.status === 'iptal').length,
  }

  // İptal edilenler performans/ciro hesaplarına dahil edilmiyor.
  const counted = appointments.filter((a) => a.status !== 'iptal')

  const bySource = SOURCE_ORDER.map((s) => ({
    ...s,
    count: counted.filter((a) => a.source === s.value).length,
  }))
  const maxSourceCount = Math.max(1, ...bySource.map((s) => s.count))
  const totalSourceCount = bySource.reduce((sum, s) => sum + s.count, 0)

  // Performans/ciro atifi, kaydi kimin sisteme girdigine (created_by_user_id) degil,
  // hizmeti kimin verecegine (employee_id) gore yapilir — boylece chatbot uzerinden
  // gelen (girenlerin insan olmadigi) randevular da ilgili calisanin hanesine yazilir.
  const userStatsMap = new Map<string, { id: string; name: string; count: number; revenue: number }>()
  for (const a of counted) {
    if (!a.employee_id) continue
    const key = a.employee_id
    const entry = userStatsMap.get(key) ?? {
      id: key,
      name: profileNameById.get(key) ?? 'Bilinmeyen',
      count: 0,
      revenue: 0,
    }
    entry.count += 1
    entry.revenue += a.service_id ? (servicePriceById.get(a.service_id) ?? 0) : 0
    userStatsMap.set(key, entry)
  }
  const allUserStats = Array.from(userStatsMap.values()).sort((a, b) => b.revenue - a.revenue)
  const userStats = searchQuery.trim()
    ? allUserStats.filter((u) => u.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : allUserStats
  const maxUserCount = Math.max(1, ...userStats.map((u) => u.count))

  // Randevuyu kim baglandi (musteriyi kim cekti): insan personelse kendi adi,
  // chatbot uzerinden geldiyse (created_by_user_id bos) "Bot".
  const creatorStatsMap = new Map<string, number>()
  for (const a of counted) {
    const key = a.created_by_user_id ?? 'bot'
    creatorStatsMap.set(key, (creatorStatsMap.get(key) ?? 0) + 1)
  }
  const botCount = creatorStatsMap.get('bot') ?? 0
  const staffCount = counted.length - botCount
  const botPct = counted.length > 0 ? Math.round((botCount / counted.length) * 100) : 0

  return (
    <div className={styles.wrap}>
      <div className={styles.statRow}>
        <div className={`card ${styles.statTile}`}>
          <span className={`${styles.statIcon} ${styles.statIconNeutral}`}>
            <CalendarIcon width={18} height={18} />
          </span>
          <span className={styles.statValue}>{total}</span>
          <span className={styles.statLabel}>Toplam randevu</span>
        </div>
        <div className={`card ${styles.statTile}`}>
          <span className={`${styles.statIcon} ${styles.statIconWarn}`}>
            <ClockIcon width={18} height={18} />
          </span>
          <span className={styles.statValue}>{statusCounts.bekliyor}</span>
          <span className={styles.statLabel}>Bekliyor</span>
        </div>
        <div className={`card ${styles.statTile}`}>
          <span className={`${styles.statIcon} ${styles.statIconOk}`}>
            <CheckCircleIcon width={18} height={18} />
          </span>
          <span className={styles.statValue}>{statusCounts.tamamlandi}</span>
          <span className={styles.statLabel}>Tamamlandı</span>
        </div>
        <div className={`card ${styles.statTile}`}>
          <span className={`${styles.statIcon} ${styles.statIconDanger}`}>
            <XCircleIcon width={18} height={18} />
          </span>
          <span className={styles.statValue}>{statusCounts.iptal}</span>
          <span className={styles.statLabel}>İptal</span>
        </div>
      </div>

      <div className={styles.chartsRow}>
        <div className="card">
          <h2 style={{ marginBottom: 16 }}>Çalışan bazlı randevu sayısı</h2>
          {userStats.length === 0 ? (
            <p className={styles.empty}>Henüz veri yok.</p>
          ) : (
            <div className={styles.barChart}>
              {userStats.map((u) => {
                const totalUserCount = userStats.reduce((sum, x) => sum + x.count, 0)
                const pct = totalUserCount > 0 ? Math.round((u.count / totalUserCount) * 100) : 0
                return (
                  <div className={styles.barRow2} key={u.id}>
                    <span className={styles.barRowLabel}>
                      <Avatar name={u.name} size={18} />
                      <span className={styles.barRowLabelText}>{u.name}</span>
                    </span>
                    <div>
                      <div className={styles.barTrack2}>
                        <div
                          className={styles.barFill2}
                          style={{
                            width: `${(u.count / maxUserCount) * 100}%`,
                            background: colorForName(u.name),
                          }}
                        >
                          <span>{u.count}</span>
                        </div>
                      </div>
                      <span className={styles.barPct}>%{pct} pay</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 16 }}>Kaynak dağılımı</h2>
          <div className={styles.barChart}>
            {bySource.map((s) => {
              const pct = totalSourceCount > 0 ? Math.round((s.count / totalSourceCount) * 100) : 0
              return (
                <div className={styles.barRow2} key={s.value}>
                  <span className={styles.barRowLabel}>
                    <span className={styles.sourceDot} style={{ background: s.color }} />
                    <span className={styles.barRowLabelText}>{s.label}</span>
                  </span>
                  <div>
                    <div className={styles.barTrack2}>
                      <div
                        className={styles.barFill2}
                        style={{ width: `${(s.count / maxSourceCount) * 100}%`, background: s.color }}
                      >
                        <span>{s.count}</span>
                      </div>
                    </div>
                    <span className={styles.barPct}>%{pct} pay</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Randevuyu kim oluşturdu</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 16 }}>
          Müşteriyi/randevuyu kim sisteme kaydetti — çalışan iş yükünden farklı, bot üzerinden
          gelenler burada "Bot" olarak görünür.
        </p>
        {counted.length === 0 ? (
          <p className={styles.empty}>Henüz veri yok.</p>
        ) : (
          <div className={styles.donutRow}>
            <DonutChart
              segments={[
                { value: botCount, color: 'var(--signal)' },
                { value: staffCount, color: 'var(--line)' },
              ]}
              centerLabel={`%${botPct}`}
              centerSubLabel="Bot"
            />
            <div className={styles.donutLegend}>
              <div className={styles.legendRow}>
                <span className={`${styles.legendDot} ${styles.legendDotSignal}`} />
                <span>Bot / Online</span>
                <strong>{botCount}</strong>
              </div>
              <div className={styles.legendRow}>
                <span className={`${styles.legendDot} ${styles.legendDotLine}`} />
                <span>Personel (manuel giriş)</span>
                <strong>{staffCount}</strong>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Çalışan performans sıralaması</h2>
        {userStats.length === 0 ? (
          <p className={styles.empty}>Henüz veri yok.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Ad Soyad</th>
                <th>Randevu sayısı</th>
                <th>Oluşturulan ciro</th>
              </tr>
            </thead>
            <tbody>
              {userStats.map((u, i) => (
                <tr key={u.id}>
                  <td className={styles.rank}>{i + 1}</td>
                  <td>
                    <span className={styles.nameCell}>
                      <Avatar name={u.name} size={28} />
                      {u.name}
                    </span>
                  </td>
                  <td>{u.count}</td>
                  <td>{currency.format(u.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
