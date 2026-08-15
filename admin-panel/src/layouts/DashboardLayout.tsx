import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  DashboardIcon,
  AppointmentsIcon,
  UsersIcon,
  MoreHorizontalIcon,
  BellIcon,
  PlusIcon,
  SettingsIcon,
  LogOutIcon,
} from '../components/icons'
import styles from './DashboardLayout.module.css'

// Mobildeki alt navigasyon barinin (Ana Sayfa/Takvim/Musteriler/Daha Fazla)
// birebir karsiligi — geri kalan her sey (Muhasebe/Ekip/Hizmetler/Performans
// Raporu/Ayarlar) mobildeki gibi "Daha Fazla" sayfasinin arkasinda.
const NAV_ITEMS = [
  { path: '/dashboard', label: 'Anasayfa', adminOnly: true, icon: DashboardIcon },
  { path: '/randevular', label: 'Randevular', adminOnly: false, icon: AppointmentsIcon },
  { path: '/musteriler', label: 'Müşteriler', adminOnly: false, icon: UsersIcon },
  { path: '/daha-fazla', label: 'Daha Fazla', adminOnly: false, icon: MoreHorizontalIcon },
]

// Sidebar'da olmayan (Daha Fazla sayfasindan veya bir listeden acilan)
// sayfalarin ustbar basligini karsilar. Dinamik /ekip/:id gibi path'ler
// icin asagida prefix eslesmesi kullanilir.
const EXTRA_PAGE_TITLES: Record<string, string> = {
  '/ayarlar': 'Ayarlar',
  '/muhasebe': 'Muhasebe',
  '/giderler': 'Giderler',
  '/ekip': 'Ekip',
  '/ekip/yeni': 'Yeni Çalışan',
  '/ekip/tatiller': 'Resmî Tatiller',
  '/hizmetler': 'Hizmetler',
  '/performans-raporu': 'Performans Raporu',
  '/mesajlar': 'Mesajlar',
  '/ai-analiz': 'AI İş Analizi',
}

function pageTitleFor(pathname: string) {
  const navMatch = NAV_ITEMS.find((item) => item.path === pathname)
  if (navMatch) return navMatch.label
  if (EXTRA_PAGE_TITLES[pathname]) return EXTRA_PAGE_TITLES[pathname]
  if (pathname.startsWith('/ekip/') && pathname.endsWith('/saatler')) return 'Çalışma Saatleri'
  if (pathname.startsWith('/ekip/') && pathname.endsWith('/izinler')) return 'İzinli Günler'
  if (pathname.startsWith('/ekip/')) return 'Çalışan Detayı'
  if (pathname.startsWith('/musteriler/')) return 'Müşteri Detayı'
  if (pathname.startsWith('/hizmetler/')) return 'Hizmet Açıklaması'
  return 'Panel'
}

function timeGreeting() {
  const h = new Date().getHours()
  if (h < 11) return 'Günaydın'
  if (h < 18) return 'İyi günler'
  return 'İyi akşamlar'
}

interface PendingAppointment {
  id: string
  scheduled_at: string
  customer_name: string
}

function apptDateKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface LayoutOutletContext {
  searchQuery: string
  setSearchPlaceholder: (placeholder: string) => void
}

export default function DashboardLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isHome = location.pathname === '/dashboard'
  const firstName = (profile?.full_name ?? 'İşletmeniz').trim().split(/\s+/)[0]

  const [pending, setPending] = useState<PendingAppointment[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setBellOpen(false)
    setProfileMenuOpen(false)
  }, [location.pathname])

  // Bildirim/profil kutusundan disari tiklaninca, sayfa kaydirilinca veya
  // geri gidilince kapat.
  useEffect(() => {
    if (!bellOpen && !profileMenuOpen) return
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (bellOpen && bellRef.current && !bellRef.current.contains(target)) setBellOpen(false)
      if (profileMenuOpen && profileRef.current && !profileRef.current.contains(target)) setProfileMenuOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setBellOpen(false)
        setProfileMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [bellOpen, profileMenuOpen])

  useEffect(() => {
    async function loadPending() {
      const { data: appts } = await supabase
        .from('appointments')
        .select('id, scheduled_at, customer_id')
        .eq('status', 'bekliyor')
        .order('scheduled_at', { ascending: true })
        .limit(8)
      const customerIds = [...new Set((appts ?? []).map((a) => a.customer_id).filter(Boolean))]
      const { data: customers } = customerIds.length
        ? await supabase.from('customers').select('id, full_name').in('id', customerIds)
        : { data: [] }
      const nameById = new Map((customers ?? []).map((c) => [c.id, c.full_name ?? 'Müşteri']))
      setPending(
        (appts ?? []).map((a) => ({
          id: a.id,
          scheduled_at: a.scheduled_at,
          customer_name: a.customer_id ? (nameById.get(a.customer_id) ?? 'Müşteri') : 'Müşteri',
        })),
      )
    }
    loadPending()
  }, [location.pathname])

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)
  const currentTitle = pageTitleFor(location.pathname)

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logoWrap}>
          <Logo />
        </div>
        <nav className={styles.nav}>
          {visibleItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem
                }
              >
                <Icon className={styles.navIcon} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>
        <button className={styles.newAppointmentBtn} onClick={() => navigate('/randevular?yeni=1')}>
          <PlusIcon width={16} height={16} />
          Yeni Randevu
        </button>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          {isHome ? (
            <div className={styles.greeting}>
              <h1>
                {timeGreeting()}, {firstName} 👋
              </h1>
              <p>Bugün işletmende neler oluyor?</p>
            </div>
          ) : (
            <h1 className={styles.pageTitle}>{currentTitle}</h1>
          )}
          <div className={styles.topbarRight}>
            <div className={styles.bellWrap} ref={bellRef}>
              <button
                type="button"
                className={styles.bellBtn}
                onClick={() => setBellOpen((v) => !v)}
                aria-label="Bildirimler"
              >
                <BellIcon />
                {pending.length > 0 && <span className={styles.bellBadge}>{pending.length}</span>}
              </button>
              {bellOpen && (
                <div className={styles.bellDropdown}>
                  <div className={styles.bellDropdownTitle}>Bekleyen randevular</div>
                  {pending.length === 0 ? (
                    <p className={styles.bellEmpty}>Bekleyen randevu yok.</p>
                  ) : (
                    pending.map((a) => (
                      <button
                        type="button"
                        key={a.id}
                        className={styles.bellItem}
                        onClick={() => {
                          setBellOpen(false)
                          navigate(`/randevular?tarih=${apptDateKey(a.scheduled_at)}`)
                        }}
                      >
                        <span>{a.customer_name}</span>
                        <span className={styles.bellItemTime}>
                          {new Date(a.scheduled_at).toLocaleString('tr-TR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className={styles.profileWrap} ref={profileRef}>
              <button
                type="button"
                className={styles.profile}
                onClick={() => setProfileMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
              >
                <span className={styles.avatar}>{(profile?.full_name ?? 'İ').charAt(0).toUpperCase()}</span>
              </button>
              {profileMenuOpen && (
                <div className={styles.profileDropdown} role="menu">
                  <div className={styles.profileDropdownHead}>
                    <span className={styles.profileDropdownName}>{profile?.full_name ?? 'İşletmeniz'}</span>
                    <span className={styles.profileDropdownRole}>{isAdmin ? 'Yönetici' : 'Çalışan'}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.profileDropdownItem}
                    onClick={() => {
                      setProfileMenuOpen(false)
                      navigate('/ayarlar')
                    }}
                  >
                    <SettingsIcon width={15} height={15} />
                    Ayarlar
                  </button>
                  <button
                    type="button"
                    className={`${styles.profileDropdownItem} ${styles.profileDropdownItemDanger}`}
                    onClick={() => {
                      setProfileMenuOpen(false)
                      signOut()
                    }}
                  >
                    <LogOutIcon width={15} height={15} />
                    Çıkış yap
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className={styles.content}>
          <Outlet
            context={
              { searchQuery: '', setSearchPlaceholder: () => {} } satisfies LayoutOutletContext
            }
          />
        </main>
      </div>
    </div>
  )
}
