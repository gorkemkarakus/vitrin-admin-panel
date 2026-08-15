import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Avatar from '../components/Avatar'
import { MessagesIcon, ClockIcon } from '../components/icons'
import type { LayoutOutletContext } from '../layouts/DashboardLayout'
import styles from './MessagesPage.module.css'

interface RawMessage {
  role: 'user' | 'assistant'
  content: string
  customer_phone: string
  created_at: string
}

interface Customer {
  id: string
  full_name: string
  phone: string | null
  bot_paused_until: string | null
}

interface Conversation {
  phone: string
  customer: Customer | null
  lastMessage: string
  lastMessageAt: string
}

const RECENT_MESSAGES_LIMIT = 500
const PAUSE_PRESETS = [
  { label: '30 dakika', minutes: 30 },
  { label: '1 saat', minutes: 60 },
  { label: '4 saat', minutes: 240 },
  { label: 'Bugün sonuna kadar', minutes: null },
]

function isPaused(customer: Customer | null): boolean {
  if (!customer?.bot_paused_until) return false
  return new Date(customer.bot_paused_until).getTime() > Date.now()
}

function pausedUntilLabel(customer: Customer | null): string | null {
  if (!isPaused(customer)) return null
  const d = new Date(customer!.bot_paused_until!)
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function MessagesPage() {
  const { profile } = useAuth()
  const { setSearchPlaceholder } = useOutletContext<LayoutOutletContext>()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [thread, setThread] = useState<RawMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false)

  useEffect(() => {
    setSearchPlaceholder('Müşteri ara…')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadConversations(silent = false) {
    if (!silent) setLoading(true)
    const [{ data: messages }, { data: customers }] = await Promise.all([
      supabase
        .from('chatbot_messages')
        .select('role, content, customer_phone, created_at')
        .order('created_at', { ascending: false })
        .limit(RECENT_MESSAGES_LIMIT),
      supabase.from('customers').select('id, full_name, phone, bot_paused_until'),
    ])

    const customerByPhone = new Map((customers ?? []).filter((c) => c.phone).map((c) => [c.phone as string, c]))

    const byPhone = new Map<string, Conversation>()
    for (const m of (messages ?? []) as RawMessage[]) {
      if (byPhone.has(m.customer_phone)) continue
      byPhone.set(m.customer_phone, {
        phone: m.customer_phone,
        customer: customerByPhone.get(m.customer_phone) ?? null,
        lastMessage: m.content,
        lastMessageAt: m.created_at,
      })
    }
    setConversations(Array.from(byPhone.values()).sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1)))
    setLoading(false)
  }

  useEffect(() => {
    loadConversations()
  }, [])

  async function openConversation(phone: string) {
    setSelectedPhone(phone)
    setPauseMenuOpen(false)
    setThreadLoading(true)
    const { data } = await supabase
      .from('chatbot_messages')
      .select('role, content, customer_phone, created_at')
      .eq('customer_phone', phone)
      .order('created_at', { ascending: true })
      .limit(200)
    setThread((data ?? []) as RawMessage[])
    setThreadLoading(false)
  }

  async function setPause(phone: string, minutes: number | null) {
    const existing = conversations.find((c) => c.phone === phone)?.customer
    const until =
      minutes != null
        ? new Date(Date.now() + minutes * 60000).toISOString()
        : (() => {
            const d = new Date()
            d.setHours(23, 59, 59, 999)
            return d.toISOString()
          })()

    // customers'taki (business_id, phone) essizlik indeksi KISMI (phone IS
    // NOT NULL) — Supabase/PostgREST'in upsert'i (ON CONFLICT) kismi
    // indeksleri taniyamiyor, bu yuzden once-bul-sonra-guncelle/olustur
    // yapiliyor (test edilip dogrulandi, upsert 400 hatasi veriyordu).
    if (existing) {
      await supabase.from('customers').update({ bot_paused_until: until }).eq('id', existing.id)
    } else {
      await supabase
        .from('customers')
        .insert({ business_id: profile?.business_id, phone, full_name: 'Müşteri', bot_paused_until: until })
    }
    setPauseMenuOpen(false)
    await loadConversations(true)
  }

  async function resumeBot(phone: string) {
    const existing = conversations.find((c) => c.phone === phone)?.customer
    if (!existing) return
    await supabase.from('customers').update({ bot_paused_until: null }).eq('id', existing.id)
    await loadConversations(true)
  }

  const selectedConversation = conversations.find((c) => c.phone === selectedPhone) ?? null

  const todayConversationCount = useMemo(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    return conversations.filter((c) => new Date(c.lastMessageAt) >= todayStart).length
  }, [conversations])

  const pausedCount = useMemo(() => conversations.filter((c) => isPaused(c.customer)).length, [conversations])

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Yükleniyor…</p>

  if (conversations.length === 0) {
    return (
      <div className={`card ${styles.empty}`}>
        <div className={styles.iconWrap}>
          <MessagesIcon width={28} height={28} />
        </div>
        <h2 className={styles.title}>Henüz konuşma yok</h2>
        <p className={styles.sub}>
          Instagram ve WhatsApp bağlantıları kurulduğunda, gelen ve giden müşteri mesajları burada listelenecek.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.statsRow}>
        <div className={`card ${styles.statTile}`}>
          <span className={styles.statIcon}>
            <MessagesIcon width={16} height={16} />
          </span>
          <div>
            <div className={styles.statValue}>{todayConversationCount}</div>
            <div className={styles.statLabel}>Bugün Konuşma</div>
          </div>
        </div>
        <div className={`card ${styles.statTile}`}>
          <span className={`${styles.statIcon} ${styles.statIconWarn}`}>
            <ClockIcon width={16} height={16} />
          </span>
          <div>
            <div className={styles.statValue}>{pausedCount}</div>
            <div className={styles.statLabel}>Şu An Duraklatılmış</div>
          </div>
        </div>
      </div>

      <div className={styles.wrap}>
      <div className={`card ${styles.convList}`}>
        {conversations.map((c) => {
          const paused = isPaused(c.customer)
          return (
            <button
              key={c.phone}
              type="button"
              className={`${styles.convRow} ${selectedPhone === c.phone ? styles.convRowActive : ''}`}
              onClick={() => openConversation(c.phone)}
            >
              <Avatar name={c.customer?.full_name ?? c.phone} size={36} />
              <div className={styles.convText}>
                <span className={styles.convName}>
                  {c.customer?.full_name && c.customer.full_name !== 'Müşteri' ? c.customer.full_name : c.phone}
                </span>
                <span className={styles.convPreview}>{c.lastMessage}</span>
              </div>
              {paused && <span className={styles.pausedDot} title="Bot duraklatıldı" />}
            </button>
          )
        })}
      </div>

      <div className={`card ${styles.threadCard}`}>
        {!selectedConversation ? (
          <p className={styles.sub}>Soldan bir konuşma seç.</p>
        ) : (
          <>
            <div className={styles.threadHead}>
              <div>
                <div className={styles.convName}>
                  {selectedConversation.customer?.full_name && selectedConversation.customer.full_name !== 'Müşteri'
                    ? selectedConversation.customer.full_name
                    : selectedConversation.phone}
                </div>
                <div className={styles.sub}>{selectedConversation.phone}</div>
              </div>

              <div className={styles.pauseWrap}>
                {isPaused(selectedConversation.customer) ? (
                  <>
                    <span className={styles.pausedBadge}>
                      Bot duraklatıldı · {pausedUntilLabel(selectedConversation.customer)}'e kadar
                    </span>
                    <button type="button" className="btn-secondary" style={{ width: 'auto' }} onClick={() => resumeBot(selectedConversation.phone)}>
                      Botu geri aç
                    </button>
                  </>
                ) : (
                  <div className={styles.pauseMenuWrap}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ width: 'auto' }}
                      onClick={() => setPauseMenuOpen((v) => !v)}
                    >
                      Devral
                    </button>
                    {pauseMenuOpen && (
                      <div className={styles.pauseMenu}>
                        {PAUSE_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            className={styles.pauseMenuItem}
                            onClick={() => setPause(selectedConversation.phone, p.minutes)}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.threadBody}>
              {threadLoading ? (
                <p className={styles.sub}>Yükleniyor…</p>
              ) : (
                thread.map((m, i) => (
                  <div key={i} className={`bubble ${m.role === 'user' ? 'in' : 'out'}`}>
                    {m.content}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
