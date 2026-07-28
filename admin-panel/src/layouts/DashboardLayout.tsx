import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  DashboardIcon,
  AppointmentsIcon,
  TeamIcon,
  ServicesIcon,
  AccountingIcon,
  UsersIcon,
  MessagesIcon,
  SearchIcon,
  BellIcon,
  PlusIcon,
} from '../components/icons'
import styles from './DashboardLayout.module.css'

const NAV_ITEMS = [
  { path: '/mesajlar', label: 'Mesajlar', adminOnly: false, icon: MessagesIcon },
  { path: '/randevular', label: 'Randevular', adminOnly: false, icon: AppointmentsIcon },
  { path: '/dashboard', label: 'Dashboard', adminOnly: true, icon: DashboardIcon },
  { path: '/muhasebe', label: 'Muhasebe', adminOnly: true, icon: AccountingIcon },
  { path: '/ekip', label: 'Ekip', adminOnly: true, icon: TeamIcon },
  { path: '/hizmetler', label: 'Hizmetler', adminOnly: true, icon: ServicesIcon },
  { path: '/kullanicilar', label: 'Kullanıcılar', adminOnly: true, icon: UsersIcon },
]

interface PendingAppointment {
  id: string
  scheduled_at: string
  customer_name: string
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

  const [searchQuery, setSearchQuery] = useState('')
  const [searchPlaceholder, setSearchPlaceholder] = useState('Ara…')
  const [pending, setPending] = useState<PendingAppointment[]>([])
  const [bellOpen, setBellOpen] = useState(false)

  useEffect(() => {
    setSearchQuery('')
  }, [location.pathname])

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
  const currentTitle = NAV_ITEMS.find((item) => item.path === location.pathname)?.label ?? 'Panel'

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
          <h1 className={styles.pageTitle}>{currentTitle}</h1>
          <div className={styles.searchWrap}>
            <SearchIcon className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className={styles.topbarRight}>
            <div className={styles.bellWrap}>
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
                          navigate('/randevular')
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
            <div className={styles.profile}>
              <span className={styles.avatar}>{(profile?.full_name ?? 'İ').charAt(0).toUpperCase()}</span>
              <div className={styles.profileText}>
                <span className={styles.profileName}>{profile?.full_name ?? 'İşletmeniz'}</span>
                <span className={styles.profileRole}>{isAdmin ? 'Salon Sahibi' : 'Çalışan'}</span>
              </div>
              <button className={styles.signOut} onClick={() => signOut()}>
                Çıkış yap
              </button>
            </div>
          </div>
        </header>
        <main className={styles.content}>
          <Outlet context={{ searchQuery, setSearchPlaceholder } satisfies LayoutOutletContext} />
        </main>
      </div>
    </div>
  )
}
