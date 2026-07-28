import styles from './Logo.module.css'

export default function Logo() {
  return (
    <div className={styles.logo}>
      <span className={styles.mark} />
      Vitrin
    </div>
  )
}
