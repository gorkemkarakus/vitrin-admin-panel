import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  AccountingIcon,
  TeamIcon,
  ServicesIcon,
  SettingsIcon,
  LogOutIcon,
  ChevronRightIcon,
  TrophyIcon,
  MegaphoneIcon,
  MessagesIcon,
  SparkleIcon,
  SendIcon,
} from '../components/icons'
import styles from './MorePage.module.css'

const MENU_ITEMS = [
  { path: '/mesajlar', label: 'Mesajlar', sub: 'Chatbot konuşmaları ve devral', adminOnly: false, icon: MessagesIcon },
  { path: '/toplu-mesaj', label: 'Toplu Mesaj', sub: 'Müşteri gruplarına kampanya mesajı gönderin', adminOnly: true, icon: SendIcon },
  { path: '/muhasebe', label: 'Muhasebe', sub: 'Gelir, gider ve kasa durumu', adminOnly: true, icon: AccountingIcon },
  { path: '/ekip', label: 'Ekip', sub: 'Personel, programlar ve izinler', adminOnly: true, icon: TeamIcon },
  { path: '/performans-raporu', label: 'Performans Raporu', sub: 'Çalışan bazlı randevu, kazanç ve izin özeti', adminOnly: true, icon: TrophyIcon },
  { path: '/hizmetler', label: 'Hizmetler', sub: 'Hizmet listesi ve fiyatlar', adminOnly: true, icon: ServicesIcon },
  { path: '/reklam', label: 'Reklam Performansı', sub: 'Facebook reklam hesabı harcama ve dönüşüm verileri', adminOnly: true, icon: MegaphoneIcon },
  { path: '/ai-analiz', label: 'AI İş Analizi', sub: 'Yapay zeka destekli işletme özeti ve öneriler', adminOnly: true, icon: SparkleIcon },
  { path: '/ayarlar', label: 'Ayarlar', sub: 'Hesap ve işletme ayarları', adminOnly: false, icon: SettingsIcon },
]

export default function MorePage() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const visibleItems = MENU_ITEMS.filter((item) => !item.adminOnly || isAdmin)

  return (
    <div className={styles.wrap}>
      <div className="card">
        {visibleItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.path}
              className={styles.row}
              onClick={() => navigate(item.path)}
            >
              <span className={styles.rowIcon}>
                <Icon width={18} height={18} />
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowLabel}>{item.label}</span>
                <span className={styles.rowSub}>{item.sub}</span>
              </span>
              <ChevronRightIcon width={16} height={16} className={styles.rowChevron} />
            </button>
          )
        })}
      </div>

      <button type="button" className={styles.signOutRow} onClick={() => signOut()}>
        <LogOutIcon width={18} height={18} />
        Çıkış yap
      </button>
    </div>
  )
}
