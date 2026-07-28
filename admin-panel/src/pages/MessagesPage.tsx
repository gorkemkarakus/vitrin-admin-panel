import { MessagesIcon } from '../components/icons'
import styles from './MessagesPage.module.css'


export default function MessagesPage() {
  return (
    <div className={`card ${styles.empty}`}>
      <div className={styles.iconWrap}>
        <MessagesIcon width={28} height={28} />
      </div>
      <h2 className={styles.title}>Henüz konuşma yok</h2>
      <p className={styles.sub}>
        Instagram ve WhatsApp bağlantıları kurulduğunda, gelen ve giden müşteri mesajları burada
        listelenecek.
      </p>
    </div>
  )
}
