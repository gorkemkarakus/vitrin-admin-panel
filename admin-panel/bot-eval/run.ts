// Musteri asistani senaryo testi: gercek bot talimati + gercek OpenAI modeli,
// sahte salon (salon.ts). Veritabanina hicbir sey yazilmaz.
//
// Calistir (admin-panel klasorunden):
//   deno run --allow-net=api.openai.com --allow-read --allow-write --allow-env bot-eval/run.ts [filtre]
// OpenAI anahtari: OPENAI_API_KEY ortam degiskeni ya da ~/.adapptiv/openai-key dosyasi.
// Senaryolar hafta ici (Pzt-Cuma) calistirilmak uzere yazildi ("yarın" acik gun).
import { runChatbot } from '../supabase/functions/_shared/chatbot.ts'
import { EMPLOYEES, HOLIDAY, Salon, SALON_PHONE, SERVICES, WORKING_HOURS, istLocal } from './salon.ts'
import { SCENARIOS, type Turn } from './scenarios.ts'

const home = Deno.env.get('USERPROFILE') ?? Deno.env.get('HOME') ?? ''
const openaiKey =
  Deno.env.get('OPENAI_API_KEY') ??
  (await Deno.readTextFile(`${home}/.adapptiv/openai-key`).then((s) => s.trim()).catch(() => ''))
if (!openaiKey) {
  console.error('OpenAI anahtari yok: OPENAI_API_KEY ya da ~/.adapptiv/openai-key')
  Deno.exit(1)
}

// kullanim: run.ts [filtre] [--tekrar=3]
const repeatArg = Deno.args.find((a) => a.startsWith('--tekrar='))
const REPEAT = repeatArg ? Math.max(1, Number(repeatArg.split('=')[1]) || 1) : 1
const filterArg = Deno.args.find((a) => !a.startsWith('--'))
const filter = filterArg ? new RegExp(filterArg, 'i') : null
const BASE = 'https://sahte.supabase.co'

interface Result {
  id: string
  title: string
  turns: Turn[]
  failures: string[]
  ms: number[]
  error?: string
}

// chatbot-context'in gecmisten ad/telefon bulmasinin basit taklidi
function detected(history: { role: string; content: string }[]) {
  let phone: string | null = null
  let name: string | null = null
  for (const h of history) {
    if (h.role !== 'user') continue
    const p = [...h.content.matchAll(/(?:\+?90|0)?\s*5\d{2}\s*\d{3}\s*\d{2}\s*\d{2}/g)].pop()
    if (p) phone = p[0].replace(/\D/g, '')
    const n = h.content.match(/ad[ıi]m\s+([a-zçğıöşü]+(?:\s+[a-zçğıöşü]+)?)/i)
    if (n) name = n[1]
  }
  return { detected_full_name: name, detected_contact_phone: phone }
}

async function runScenario(sc: (typeof SCENARIOS)[number], idx: number): Promise<Result> {
  const salon = new Salon(sc.busy ?? [])
  const phone = `90555${String(idx).padStart(7, '0')}`
  if (sc.mine) salon.seed(phone, sc.mine)
  const history: { role: string; content: string }[] = []
  const turns: Turn[] = []
  const ms: number[] = []

  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('api.openai.com')) return fetch(url, init)
    const body = JSON.parse(String(init?.body ?? '{}'))
    const fn = u.split('/functions/v1/')[1]
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
    switch (fn) {
      case 'staff-whatsapp-webhook':
        return ok({ handled: false })
      case 'chatbot-context':
        return ok({
          business_name: 'Güzel Salon',
          bot_paused: false,
          services: SERVICES,
          employees: EMPLOYEES,
          working_hours: WORKING_HOURS,
          business_phone: SALON_PHONE,
          closed_days: [{ name: HOLIDAY.name, start_date: HOLIDAY.date, end_date: HOLIDAY.date, eve_closes_at: '13:00' }],
          appointments: salon.customerAppointments(phone),
          history: history.slice(-30),
          // gercek chatbot-context gibi: onceki mesajlardaki telefon ve 'adım X' hatirlanir
          ...detected(history),
        })
      case 'book-appointment':
        return ok(salon.book(body))
      case 'cancel-appointment':
        return ok(salon.cancel(body))
      case 'reschedule-appointment':
        return ok(salon.reschedule(body))
      case 'chatbot-log-message':
        for (const m of body.messages) history.push({ role: m.role, content: m.content })
        return ok({ status: 'ok' })
      default:
        return new Response('{}', { status: 404 })
    }
  }) as typeof fetch

  try {
    for (const userMsg of sc.messages) {
      const t = Date.now()
      const r = await runChatbot(
        { business_id: 'b', phone_number_id: 'pn', from: phone, customer_name: null, message: userMsg, wamid: `w${Date.now()}` },
        { supabaseUrl: BASE, anonKey: 'anon', botSecret: 'x', openaiKey, fetch: fakeFetch },
      )
      await r.log
      ms.push(Date.now() - t)
      turns.push({ user: userMsg, bot: r.reply })
    }
  } catch (e) {
    return { id: sc.id, title: sc.title, turns, failures: ['HATA: ' + (e instanceof Error ? e.message : e)], ms }
  }

  const booked = salon.activeFor(phone).map((a) => ({ at: istLocal(a.start), service: a.service_name, employee: a.employee_name }))
  const failures = sc.check({ turns, booked, allBot: turns.map((t) => t.bot).join('\n') })
  // her senaryoda gecerli genel kurallar
  const all = turns.map((t) => t.bot).join('\n')
  if (/XXX XX XX/.test(all)) failures.push('yer tutucu numara (XXX XX XX) verdi')
  if (/olarak alayım mı/i.test(all)) failures.push('"olarak alayım mı" kalibi kullandi')
  if (/gece\s*0?\d[:.]00\s*(mı|mi|mu|mü)/i.test(all)) failures.push('gece saatini secenek olarak sordu')
  if (/sistem talimat|iç talimat.*şunlar/i.test(all)) failures.push('talimat sizdirmis olabilir')
  if (/\bid:|randevu-\d/i.test(all)) failures.push('musteriye ic kimlik (id) yazdi')
  return { id: sc.id, title: sc.title, turns, failures, ms }
}

const selected = SCENARIOS.filter((s) => !filter || filter.test(s.id) || filter.test(s.title))
// her senaryo REPEAT kez calisir: model her seferinde biraz farkli cevap
// verdigi icin "bazen bozulan" davranis ancak tekrarla gorunur
const jobs = selected.flatMap((s) => Array.from({ length: REPEAT }, () => s))
console.log(`${selected.length} senaryo x ${REPEAT} = ${jobs.length} konusma calisiyor...`)
const results: Result[] = []
const PARALLEL = 6
for (let i = 0; i < jobs.length; i += PARALLEL) {
  const batch = await Promise.all(jobs.slice(i, i + PARALLEL).map((s, j) => runScenario(s, i + j)))
  for (const r of batch) {
    results.push(r)
    console.log(`${r.failures.length ? '✗' : '✓'} ${r.id} ${r.title}${r.failures.length ? '  -> ' + r.failures.join('; ') : ''}`)
  }
}

const passed = results.filter((r) => !r.failures.length).length
const allMs = results.flatMap((r) => r.ms).sort((a, b) => a - b)
const median = allMs[Math.floor(allMs.length / 2)] ?? 0
console.log(`\n${passed}/${results.length} gecti · cevap suresi medyan ${(median / 1000).toFixed(1)} sn`)
if (REPEAT > 1) {
  const byId = new Map<string, { ok: number; all: number; title: string }>()
  for (const r of results) {
    const e = byId.get(r.id) ?? { ok: 0, all: 0, title: r.title }
    e.all++
    if (!r.failures.length) e.ok++
    byId.set(r.id, e)
  }
  const flaky = [...byId].filter(([, e]) => e.ok < e.all)
  console.log(flaky.length ? 'Her seferinde gecmeyenler:' : 'Butun senaryolar her tekrarda gecti.')
  for (const [id, e] of flaky) console.log(`  ${id} ${e.title}: ${e.ok}/${e.all}`)
}

// okumak icin rapor
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
const rows = results
  .map(
    (r) => `<section class="${r.failures.length ? 'fail' : 'pass'}">
<h2>${r.failures.length ? '✗' : '✓'} ${esc(r.id)} — ${esc(r.title)}</h2>
${r.failures.length ? `<ul class="why">${r.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
${r.turns.map((t, i) => `<div class="u">${esc(t.user)}</div><div class="b">${esc(t.bot || '(cevap yok)')}<small>${((r.ms[i] ?? 0) / 1000).toFixed(1)} sn</small></div>`).join('')}
</section>`,
  )
  .join('\n')
const html = `<!doctype html><meta charset="utf-8"><title>Bot testi</title>
<style>body{font:15px/1.45 system-ui;max-width:760px;margin:24px auto;padding:0 16px;background:#f5f6f8;color:#111827}
h1{font-size:22px}section{background:#fff;border-radius:16px;padding:14px 16px;margin:14px 0;border-left:5px solid #16a34a}
section.fail{border-left-color:#dc2626}h2{font-size:15px;margin:0 0 8px}.why{color:#b91c1c;margin:0 0 8px;padding-left:18px}
.u,.b{padding:8px 12px;border-radius:12px;margin:6px 0;max-width:85%}.u{background:#dcf8c6;margin-left:auto}.b{background:#eef0f4}
small{display:block;color:#6b7280;font-size:11px;margin-top:4px}</style>
<h1>Bot testi — ${passed}/${results.length} geçti · medyan ${(median / 1000).toFixed(1)} sn</h1>
${rows}`
const out = `${home}/Desktop/Adapptiv-bot-testi.html`
await Deno.writeTextFile(out, html)
console.log('rapor:', out)
