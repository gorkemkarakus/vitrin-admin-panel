import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import {
  UsersIcon,
  SendIcon,
  XCircleIcon,
  MehIcon,
  UserPlusIcon,
  StarIcon,
  TagIcon,
  ChevronRightIcon,
  PlusIcon,
  PencilIcon,
} from '../components/icons'
import CreateGroupModal from '../components/CreateGroupModal'
import GroupMembersModal from '../components/GroupMembersModal'
import SendCampaignModal from '../components/SendCampaignModal'
import TemplateModal from '../components/TemplateModal'
import styles from './TopluMesajPage.module.css'

export interface Customer {
  id: string
  full_name: string
  phone: string | null
  contact_phone: string | null
  marketing_consent: boolean
}
interface Appointment {
  customer_id: string | null
  service_id: string | null
  status: 'bekliyor' | 'onaylandi' | 'tamamlandi' | 'iptal' | 'gelmedi'
  scheduled_at: string
}
interface Service {
  id: string
  name: string
}
interface CustomGroupRow {
  id: string
  name: string
  description: string | null
}
interface CustomGroupMemberRow {
  group_id: string
  customer_id: string
}
export interface Template {
  id: string
  title: string
  message: string
}

export interface UiGroup {
  key: string
  name: string
  description: string
  memberIds: string[]
  icon: typeof UsersIcon
  isCustom: boolean
  customGroupId?: string
}

type Tab = 'gruplar' | 'sablonlar'

function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString()
}

export default function TopluMesajPage() {
  const [tab, setTab] = useState<Tab>('gruplar')
  const [loading, setLoading] = useState(true)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [customGroupRows, setCustomGroupRows] = useState<CustomGroupRow[]>([])
  const [customGroupMembers, setCustomGroupMembers] = useState<CustomGroupMemberRow[]>([])
  const [templates, setTemplates] = useState<Template[]>([])

  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [viewingGroup, setViewingGroup] = useState<UiGroup | null>(null)
  const [sendTarget, setSendTarget] = useState<{ name: string; memberIds: string[]; prefill?: string } | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<Template | 'new' | null>(null)
  const [pendingTemplateMessage, setPendingTemplateMessage] = useState<string | null>(null)

  async function loadAll() {
    setLoading(true)
    const [{ data: custs }, { data: appts }, { data: svcs }, { data: groups }, { data: members }, { data: tmpls }] =
      await Promise.all([
        fetchAll(() => supabase.from('customers').select('id, full_name, phone, contact_phone, marketing_consent').order('id')),
        fetchAll(() => supabase.from('appointments').select('customer_id, service_id, status, scheduled_at').order('id')),
        supabase.from('services').select('id, name'),
        supabase.from('customer_groups').select('id, name, description').order('created_at', { ascending: false }),
        fetchAll(() => supabase.from('customer_group_members').select('group_id, customer_id').order('group_id').order('customer_id')),
        supabase.from('campaign_message_templates').select('id, title, message').order('created_at', { ascending: false }),
      ])
    setCustomers(custs ?? [])
    setAppointments(appts ?? [])
    setServices(svcs ?? [])
    setCustomGroupRows(groups ?? [])
    setCustomGroupMembers(members ?? [])
    setTemplates(tmpls ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  // ---------- Sabit/akıllı gruplar — CustomersPage.tsx'teki segment desenindeki
  // gibi tamamen client-side, DB'ye hiçbir şey yazılmadan canlı hesaplanıyor. ----------
  const fixedGroups = useMemo<UiGroup[]>(() => {
    const completedByCustomer = new Map<string, Appointment[]>()
    for (const a of appointments) {
      if (a.status !== 'tamamlandi' || !a.customer_id) continue
      const list = completedByCustomer.get(a.customer_id) ?? []
      list.push(a)
      completedByCustomer.set(a.customer_id, list)
    }
    for (const list of completedByCustomer.values()) list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))

    const cancelCutoff = daysAgoIso(30)
    const cancelledIds = new Set<string>()
    for (const a of appointments) {
      if (a.status === 'iptal' && a.customer_id && a.scheduled_at >= cancelCutoff) cancelledIds.add(a.customer_id)
    }

    const inactiveCutoff = daysAgoIso(90)
    const longAbsentIds = new Set<string>()
    const firstTimeCutoff = daysAgoIso(60)
    const firstTimeIds = new Set<string>()
    const loyalCutoff = daysAgoIso(90)
    const loyalIds = new Set<string>()
    for (const [custId, list] of completedByCustomer) {
      const last = list[list.length - 1]
      if (last.scheduled_at < inactiveCutoff) longAbsentIds.add(custId)
      const first = list[0]
      if (first.scheduled_at >= firstTimeCutoff) firstTimeIds.add(custId)
      const recentCount = list.filter((a) => a.scheduled_at >= loyalCutoff).length
      if (recentCount >= 3) loyalIds.add(custId)
    }

    const serviceById = new Map(services.map((s) => [s.id, s.name]))
    const perServiceCutoff = daysAgoIso(180)
    const byService = new Map<string, Set<string>>()
    for (const a of appointments) {
      if (a.status !== 'tamamlandi' || !a.customer_id || !a.service_id) continue
      if (a.scheduled_at < perServiceCutoff) continue
      const set = byService.get(a.service_id) ?? new Set<string>()
      set.add(a.customer_id)
      byService.set(a.service_id, set)
    }

    const groups: UiGroup[] = []
    for (const [serviceId, custIds] of byService) {
      const name = serviceById.get(serviceId)
      if (!name || custIds.size === 0) continue
      groups.push({
        key: `service:${serviceId}`,
        name: `${name} Yaptıranlar`,
        description: 'Son 6 ay içinde bu hizmeti alan müşteriler',
        memberIds: Array.from(custIds),
        icon: TagIcon,
        isCustom: false,
      })
    }
    groups.push({
      key: 'surekli',
      name: 'Sürekli Randevu Alanlar',
      description: 'Son 3 ayda 3+ randevu alan sadık müşteriler',
      memberIds: Array.from(loyalIds),
      icon: StarIcon,
      isCustom: false,
    })
    groups.push({
      key: 'iptal',
      name: 'İptal Edenler',
      description: 'Son 30 günde randevusunu iptal eden müşteriler',
      memberIds: Array.from(cancelledIds),
      icon: XCircleIcon,
      isCustom: false,
    })
    groups.push({
      key: 'ilk_kez',
      name: 'İlk Kez Gelenler',
      description: 'Son 60 günde ilk kez gelen müşteriler',
      memberIds: Array.from(firstTimeIds),
      icon: UserPlusIcon,
      isCustom: false,
    })
    groups.push({
      key: 'uzun_suredir',
      name: 'Uzun Süredir Gelmeyenler',
      description: 'Son 90 günde randevu almayan müşteriler',
      memberIds: Array.from(longAbsentIds),
      icon: MehIcon,
      isCustom: false,
    })
    return groups
  }, [appointments, services])

  const customGroups = useMemo<UiGroup[]>(() => {
    const membersByGroup = new Map<string, string[]>()
    for (const m of customGroupMembers) {
      const list = membersByGroup.get(m.group_id) ?? []
      list.push(m.customer_id)
      membersByGroup.set(m.group_id, list)
    }
    return customGroupRows.map((g) => ({
      key: `custom:${g.id}`,
      name: g.name,
      description: g.description || 'Özel grup',
      memberIds: membersByGroup.get(g.id) ?? [],
      icon: UsersIcon,
      isCustom: true,
      customGroupId: g.id,
    }))
  }, [customGroupRows, customGroupMembers])

  // Müşteri seçici listelerinde (grup oluştur/üye ekle) her müşterinin
  // yanında son yaptırdığı işlemi göstermek için — sadece 'tamamlandi'
  // randevular arasından en yeni scheduled_at'e bakılıyor.
  const lastServiceByCustomer = useMemo(() => {
    const serviceNameById = new Map(services.map((s) => [s.id, s.name]))
    const map = new Map<string, { name: string; date: string }>()
    for (const a of appointments) {
      if (a.status !== 'tamamlandi' || !a.customer_id || !a.service_id) continue
      const name = serviceNameById.get(a.service_id)
      if (!name) continue
      const existing = map.get(a.customer_id)
      if (!existing || a.scheduled_at > existing.date) {
        map.set(a.customer_id, { name, date: a.scheduled_at })
      }
    }
    const nameOnly = new Map<string, string>()
    for (const [custId, v] of map) nameOnly.set(custId, v.name)
    return nameOnly
  }, [appointments, services])

  // Kampanya yalnizca ticari ileti izni olanlara gider (sunucu da ayrica suzer).
  const consentedOf = (ids: string[]) => ids.filter((id) => customers.find((c) => c.id === id)?.marketing_consent)

  function openSend(group: UiGroup) {
    setSendTarget({ name: group.name, memberIds: consentedOf(group.memberIds), prefill: pendingTemplateMessage ?? undefined })
    setPendingTemplateMessage(null)
  }

  function handleUseTemplate(message: string) {
    setPendingTemplateMessage(message)
    setTab('gruplar')
  }

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  return (
    <div className={styles.wrap}>
      <div className={styles.tabBar}>
        <button type="button" className={tab === 'gruplar' ? styles.tabActive : styles.tab} onClick={() => setTab('gruplar')}>
          <UsersIcon width={15} height={15} />
          Müşteri Grupları
        </button>
        <button
          type="button"
          className={tab === 'sablonlar' ? styles.tabActive : styles.tab}
          onClick={() => setTab('sablonlar')}
        >
          <SendIcon width={15} height={15} />
          Kampanya Mesajları
        </button>
      </div>

      {pendingTemplateMessage && (
        <p className={styles.hint}>Şablon seçildi — göndermek istediğiniz grubun "Mesaj Gönder" düğmesine tıklayın.</p>
      )}

      {tab === 'gruplar' ? (
        <>
          <div className={`card ${styles.introCard}`}>
            <span className={styles.introIcon}>
              <UsersIcon width={20} height={20} />
            </span>
            <div className={styles.introText}>
              <h2 className={styles.introTitle}>Doğru gruba, doğru mesaj!</h2>
              <p className={styles.introSub}>Müşterilerinize özel kampanyalar gönderin, randevularınızı artırın.</p>
            </div>
            <button type="button" className="btn-primary" onClick={() => setCreateGroupOpen(true)}>
              <PlusIcon width={15} height={15} />
              Yeni Grup Oluştur
            </button>
          </div>

          <h2 className={styles.sectionLabel}>Müşteri Gruplarım</h2>
          <div className={styles.groupList}>
            {[...customGroups, ...fixedGroups].map((g) => {
              const Icon = g.icon
              return (
                <div className="card" key={g.key}>
                  <div className={styles.groupRow}>
                    <button type="button" className={styles.groupMain} onClick={() => setViewingGroup(g)}>
                      <span className={styles.groupIcon}>
                        <Icon width={18} height={18} />
                      </span>
                      <span className={styles.groupText}>
                        <span className={styles.groupName}>{g.name}</span>
                        <span className={styles.groupDesc}>{g.description}</span>
                        <span className={styles.groupCount}>
                          {g.memberIds.length} kişi · {consentedOf(g.memberIds).length} kampanya izinli
                        </span>
                      </span>
                    </button>
                    <div className={styles.groupActions}>
                      <button
                        type="button"
                        className={`btn-secondary ${styles.sendBtn}`}
                        onClick={() => openSend(g)}
                        disabled={consentedOf(g.memberIds).length === 0}
                        title={consentedOf(g.memberIds).length === 0 ? 'Bu grupta kampanya izni olan müşteri yok' : undefined}
                      >
                        <SendIcon width={13} height={13} />
                        Mesaj Gönder
                      </button>
                      <ChevronRightIcon width={16} height={16} className={styles.groupChevron} onClick={() => setViewingGroup(g)} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className={styles.templateHead}>
            <h2 className={styles.sectionLabel}>Kampanya Şablonlarım</h2>
            <button type="button" className="btn-primary" onClick={() => setEditingTemplate('new')}>
              <PlusIcon width={15} height={15} />
              Yeni Şablon
            </button>
          </div>
          {templates.length === 0 ? (
            <p className={styles.hint}>Henüz şablon yok. İlk kampanya mesajınızı oluşturun.</p>
          ) : (
            <div className={styles.templateGrid}>
              {templates.map((t) => (
                <div className="card" key={t.id}>
                  <h3 className={styles.templateTitle}>{t.title}</h3>
                  <p className={styles.templateMessage}>{t.message}</p>
                  <div className={styles.templateActions}>
                    <button type="button" className="btn-primary" onClick={() => handleUseTemplate(t.message)}>
                      Kullan
                    </button>
                    <button type="button" className={styles.iconBtn} onClick={() => setEditingTemplate(t)} aria-label="Düzenle">
                      <PencilIcon width={15} height={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {createGroupOpen && (
        <CreateGroupModal
          customers={customers}
          lastServiceByCustomer={lastServiceByCustomer}
          onClose={() => setCreateGroupOpen(false)}
          onCreated={() => {
            setCreateGroupOpen(false)
            loadAll()
          }}
        />
      )}

      {viewingGroup && (
        <GroupMembersModal
          group={viewingGroup}
          allCustomers={customers}
          customerById={customerById}
          lastServiceByCustomer={lastServiceByCustomer}
          onClose={() => setViewingGroup(null)}
          onChanged={() => {
            loadAll()
          }}
          onDeleted={() => {
            setViewingGroup(null)
            loadAll()
          }}
        />
      )}

      {sendTarget && (
        <SendCampaignModal
          targetName={sendTarget.name}
          memberIds={sendTarget.memberIds}
          initialMessage={sendTarget.prefill}
          templates={templates}
          onClose={() => setSendTarget(null)}
        />
      )}

      {editingTemplate && (
        <TemplateModal
          template={editingTemplate === 'new' ? null : editingTemplate}
          onClose={() => setEditingTemplate(null)}
          onSaved={() => {
            setEditingTemplate(null)
            loadAll()
          }}
          onDeleted={() => {
            setEditingTemplate(null)
            loadAll()
          }}
        />
      )}
    </div>
  )
}
