import { useEffect, useRef, useState } from 'react'
import styles from './Select.module.css'

export interface SelectOption {
  value: string
  label: string
  sub?: string // ikinci satır (ör. telefon numarası, süre/fiyat)
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  id?: string
}

// Native <select>'in kapali hali input'lardan farkli goruntuleniyordu
// (stil verilmemis, tarayici varsayilani) — form'daki diger alanlarla
// tutarli, ozel bir acilir kutu. StatusDropdown ile ayni etkilesim deseni
// ama duz metin listeler icin (renkli nokta yok, input gorunumlu tetikleyici).
export default function Select({ value, options, onChange, placeholder = 'Seçin…', id }: SelectProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value) ?? null

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
        id={id}
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={current ? styles.triggerText : styles.triggerPlaceholder}>
          {current ? current.label : placeholder}
        </span>
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
          {options.length === 0 && <div className={styles.menuEmpty}>Seçenek yok</div>}
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
              <span className={styles.menuItemText}>
                <span className={styles.menuItemLabel}>{o.label}</span>
                {o.sub && <span className={styles.menuItemSub}>{o.sub}</span>}
              </span>
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
