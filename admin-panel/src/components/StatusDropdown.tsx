import { useEffect, useRef, useState } from 'react'
import styles from './StatusDropdown.module.css'

export interface StatusDropdownOption {
  value: string
  label: string
  color: string // nokta + kapalı haldeki yazı rengi (ör. 'var(--warn-text)')
  bg: string // kapalı haldeki zemin rengi (ör. 'var(--warn-bg)')
}

interface StatusDropdownProps {
  value: string
  options: StatusDropdownOption[]
  onChange: (value: string) => void
  urgent?: boolean
}

// Native <select>'in açık menüsü tarayıcıya/işletim sistemine bırakılır ve
// CSS ile neredeyse hiç biçimlendirilemez — kapalı haldeki "hap" görünümüyle
// açıldığında çıkan standart kare liste birbirine uymuyordu (test edilip
// bildirildi). Bu yüzden açılır menü sıfırdan, tamamen kontrol edilebilir
// şekilde kuruldu.
export default function StatusDropdown({ value, options, onChange, urgent }: StatusDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger} ${urgent ? styles.triggerUrgent : ''}`}
        style={{ color: current.color, background: current.bg }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.dot} style={{ background: current.color }} />
        {current.label}
        <svg className={styles.chevron} width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className={styles.menu} role="listbox">
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`${styles.menuItem} ${o.value === value ? styles.menuItemActive : ''}`}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className={styles.dot} style={{ background: o.color }} />
              <span className={styles.menuItemLabel}>{o.label}</span>
              {o.value === value && (
                <svg width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden="true">
                  <path
                    d="M1 5L4.5 8.5L11 1.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
