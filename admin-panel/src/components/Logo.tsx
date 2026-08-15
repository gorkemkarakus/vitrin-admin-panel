import logoFull from '../assets/brand/logo-full.png'
import styles from './Logo.module.css'

export default function Logo() {
  return <img src={logoFull} alt="Adapptiv" className={styles.logo} />
}
