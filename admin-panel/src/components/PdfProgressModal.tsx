import { DownloadIcon, AlertTriangleIcon } from './icons'
import styles from './PdfProgressModal.module.css'

export default function PdfProgressModal({
  progress,
  step,
  error,
  onClose,
}: {
  progress: number
  step: string
  error: string | null
  onClose: () => void
}) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <span className={`${styles.icon} ${error ? styles.iconError : ''}`}>
          {error ? <AlertTriangleIcon width={22} height={22} /> : <DownloadIcon width={22} height={22} />}
        </span>
        <span className={styles.title}>{error ? 'Rapor oluşturulamadı' : 'Detaylı Özet Hazırlanıyor'}</span>
        {error ? (
          <>
            <span className={styles.errorText}>{error}</span>
            <button type="button" className={`btn-primary ${styles.closeBtn}`} onClick={onClose}>
              Kapat
            </button>
          </>
        ) : (
          <>
            <span className={styles.step}>{step}</span>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${Math.round(progress)}%` }} />
            </div>
            <span className={styles.pct}>%{Math.round(progress)}</span>
          </>
        )}
      </div>
    </div>
  )
}
