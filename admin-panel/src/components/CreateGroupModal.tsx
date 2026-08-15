import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { SearchIcon, CheckCircleIcon } from './icons'
import Avatar from './Avatar'
import type { Customer } from '../pages/TopluMesajPage'
import styles from './CreateGroupModal.module.css'

export default function CreateGroupModal({
  customers,
  lastServiceByCustomer,
  onClose,
  onCreated,
}: {
  customers: Customer[]
  lastServiceByCustomer: Map<string, string>
  onClose: () => void
  onCreated: () => void
}) {
  const { profile } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = customers.filter((c) => c.full_name.toLowerCase().includes(search.trim().toLowerCase()))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (!profile?.business_id) return
    if (!name.trim()) {
      setError('Grup adı gerekli')
      return
    }
    setSaving(true)
    setError(null)
    const { data: group, error: groupErr } = await supabase
      .from('customer_groups')
      .insert({ business_id: profile.business_id, name: name.trim(), description: description.trim() || null })
      .select()
      .single()
    if (groupErr || !group) {
      setError(groupErr?.message ?? 'Grup oluşturulamadı')
      setSaving(false)
      return
    }
    if (selected.size > 0) {
      const rows = Array.from(selected).map((customerId) => ({
        group_id: group.id,
        customer_id: customerId,
        business_id: profile.business_id,
      }))
      const { error: memberErr } = await supabase.from('customer_group_members').insert(rows)
      if (memberErr) {
        setError(memberErr.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    onCreated()
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={`card ${styles.card}`} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Yeni Grup Oluştur</h2>

        <div className="field">
          <label htmlFor="groupName">Grup Adı</label>
          <input id="groupName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. VIP Müşteriler" />
        </div>
        <div className="field">
          <label htmlFor="groupDesc">Açıklama (opsiyonel)</label>
          <input id="groupDesc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Bu grup ne için?" />
        </div>

        <div className={styles.pickerLabel}>
          Müşteri seçin <span>{selected.size} seçili</span>
        </div>
        <div className={styles.searchBox}>
          <SearchIcon width={15} height={15} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Müşteri ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.pickerList}>
          {filtered.map((c) => (
            <button type="button" key={c.id} className={styles.pickerRow} onClick={() => toggle(c.id)}>
              <Avatar name={c.full_name} size={32} />
              <span className={styles.pickerText}>
                <span className={styles.pickerName}>{c.full_name}</span>
                {lastServiceByCustomer.get(c.id) && (
                  <span className={styles.pickerLastService}>Son işlem: {lastServiceByCustomer.get(c.id)}</span>
                )}
              </span>
              {selected.has(c.id) && <CheckCircleIcon width={16} height={16} className={styles.pickerCheck} />}
            </button>
          ))}
          {filtered.length === 0 && <p className={styles.empty}>Müşteri bulunamadı.</p>}
        </div>

        {error && <p className={styles.errorText}>{error}</p>}

        <div className={styles.actions}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Oluşturuluyor…' : 'Grubu Oluştur'}
          </button>
        </div>
      </div>
    </div>
  )
}
