import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { SearchIcon, PlusIcon, XCircleIcon, TrashIcon, PencilIcon } from './icons'
import Avatar from './Avatar'
import type { Customer, UiGroup } from '../pages/TopluMesajPage'
import styles from './GroupMembersModal.module.css'

export default function GroupMembersModal({
  group,
  allCustomers,
  customerById,
  lastServiceByCustomer,
  onClose,
  onChanged,
  onDeleted,
}: {
  group: UiGroup
  allCustomers: Customer[]
  customerById: Map<string, Customer>
  lastServiceByCustomer: Map<string, string>
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [memberIds, setMemberIds] = useState<string[]>(group.memberIds)
  const [addSearch, setAddSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description)
  const [error, setError] = useState<string | null>(null)

  const members = memberIds.map((id) => customerById.get(id)).filter((c): c is Customer => !!c)
  const memberIdSet = new Set(memberIds)
  const addCandidates = allCustomers.filter(
    (c) => !memberIdSet.has(c.id) && c.full_name.toLowerCase().includes(addSearch.trim().toLowerCase()),
  )

  async function handleAdd(customerId: string) {
    if (!group.customGroupId) return
    setError(null)
    const { error: err } = await supabase.from('customer_group_members').insert({
      group_id: group.customGroupId,
      customer_id: customerId,
    })
    if (err) {
      setError(err.message)
      return
    }
    setMemberIds((prev) => [...prev, customerId])
    onChanged()
  }

  async function handleRemove(customerId: string) {
    if (!group.customGroupId) return
    setError(null)
    const { error: err } = await supabase
      .from('customer_group_members')
      .delete()
      .eq('group_id', group.customGroupId)
      .eq('customer_id', customerId)
    if (err) {
      setError(err.message)
      return
    }
    setMemberIds((prev) => prev.filter((id) => id !== customerId))
    onChanged()
  }

  async function handleRename() {
    if (!group.customGroupId || !name.trim()) return
    const { error: err } = await supabase
      .from('customer_groups')
      .update({ name: name.trim(), description: description.trim() || null })
      .eq('id', group.customGroupId)
    if (err) {
      setError(err.message)
      return
    }
    setEditingName(false)
    onChanged()
  }

  async function handleDelete() {
    if (!group.customGroupId) return
    const ok = window.confirm(`"${group.name}" grubunu silmek istediğinize emin misiniz?`)
    if (!ok) return
    const { error: err } = await supabase.from('customer_groups').delete().eq('id', group.customGroupId)
    if (err) {
      setError(err.message)
      return
    }
    onDeleted()
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={`card ${styles.card}`} onClick={(e) => e.stopPropagation()}>
        {editingName ? (
          <div className={styles.editNameBlock}>
            <div className="field">
              <label htmlFor="editGroupName">Grup Adı</label>
              <input id="editGroupName" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="editGroupDesc">Açıklama</label>
              <input id="editGroupDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className={styles.editNameActions}>
              <button type="button" className="btn-secondary" onClick={() => setEditingName(false)}>
                Vazgeç
              </button>
              <button type="button" className="btn-primary" onClick={handleRename}>
                Kaydet
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.head}>
            <div className={styles.headText}>
              <h2 className={styles.title}>{group.name}</h2>
              <p className={styles.desc}>{group.description}</p>
            </div>
            {group.isCustom && (
              <div className={styles.headActions}>
                <button type="button" className={styles.iconBtn} onClick={() => setEditingName(true)} aria-label="Düzenle">
                  <PencilIcon width={15} height={15} />
                </button>
                <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={handleDelete} aria-label="Sil">
                  <TrashIcon width={15} height={15} />
                </button>
              </div>
            )}
          </div>
        )}

        <p className={styles.memberCount}>{members.length} kişi</p>

        {group.isCustom && (
          <>
            {adding ? (
              <div className={styles.addBlock}>
                <div className={styles.searchBox}>
                  <SearchIcon width={15} height={15} className={styles.searchIcon} />
                  <input
                    className={styles.searchInput}
                    placeholder="Eklenecek müşteriyi ara…"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className={styles.addList}>
                  {addCandidates.slice(0, 30).map((c) => (
                    <button type="button" key={c.id} className={styles.addRow} onClick={() => handleAdd(c.id)}>
                      <Avatar name={c.full_name} size={28} />
                      <span className={styles.addText}>
                        <span className={styles.addName}>{c.full_name}</span>
                        {lastServiceByCustomer.get(c.id) && (
                          <span className={styles.addLastService}>Son işlem: {lastServiceByCustomer.get(c.id)}</span>
                        )}
                      </span>
                      <PlusIcon width={14} height={14} />
                    </button>
                  ))}
                  {addCandidates.length === 0 && <p className={styles.empty}>Sonuç yok.</p>}
                </div>
                <button type="button" className={styles.doneAddBtn} onClick={() => setAdding(false)}>
                  Tamamlandı
                </button>
              </div>
            ) : (
              <button type="button" className={styles.addMemberBtn} onClick={() => setAdding(true)}>
                <PlusIcon width={14} height={14} />
                Üye Ekle
              </button>
            )}
          </>
        )}

        {error && <p className={styles.errorText}>{error}</p>}

        <div className={styles.memberList}>
          {members.map((c) => (
            <div className={styles.memberRow} key={c.id}>
              <Avatar name={c.full_name} size={32} />
              <span className={styles.memberName}>{c.full_name}</span>
              {c.contact_phone || c.phone ? <span className={styles.memberPhone}>{c.contact_phone || c.phone}</span> : null}
              {group.isCustom && (
                <button type="button" className={styles.removeBtn} onClick={() => handleRemove(c.id)} aria-label="Çıkar">
                  <XCircleIcon width={16} height={16} />
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && <p className={styles.empty}>Bu grupta henüz müşteri yok.</p>}
        </div>

        <button type="button" className="btn-secondary" onClick={onClose}>
          Kapat
        </button>
      </div>
    </div>
  )
}
