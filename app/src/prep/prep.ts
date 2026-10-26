// Meeting prep: auto-drafted from what the app knows, edited by Alan,
// and shown on the glasses as swipeable cards during the call.
import type { Call, Customer } from '../types'
import type { KB } from '../kb/knowledge'
import { customerBrief } from '../calls/summarize'
import { findCuts, lexFor } from '../intel/lexicon'
import { type MarketBundle, type Card, bestRow, perLb, money, pct, fmtPct, questionsFor, shortDate } from '../intel/market'

export interface Prep {
  id: string
  customerId?: string
  title: string
  /** Meeting date YYYY-MM-DD (optional) */
  date?: string
  /** The prep itself. "## Heading" lines split it into cards on the glasses. */
  notes: string
  createdAt: number
  updatedAt: number
}

const today = () => new Date().toISOString().slice(0, 10)

/** Build a first draft from customer profile, past calls, USDA prices and news. */
export function draftPrep(c: Customer | null, calls: Call[], m: MarketBundle, defaultGrade: string): string {
  const out: string[] = []
  const mine = c ? calls.filter(x => x.customerId === c.id).sort((a, b) => b.startedAt - a.startedAt) : []
  const last = mine[0]

  out.push('## Goal', '- (what do you want out of this meeting?)', '')

  const open = mine.flatMap(x => (x.summary?.followUps || []).filter(f => !f.done).map(f => ({ f, x })))
  if (open.length) {
    out.push('## Open follow-ups')
    for (const { f, x } of open.slice(0, 6)) out.push(`- ${f.owner}: ${f.text}${f.due ? ` (${f.due})` : ''} — from ${new Date(x.startedAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`)
    out.push('')
  }

  if (last?.summary) {
    out.push(`## Last call ${new Date(last.startedAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`)
    out.push(`- ${last.summary.headline}`)
    for (const n of last.summary.customerNeeds.slice(0, 2)) out.push(`- They said: ${n}`)
    for (const t of last.summary.talkingPointsNext.slice(0, 2)) out.push(`- ${t}`)
    out.push('')
  }

  // Their items with today's USDA price where we have one
  const cutsTheyBuy = new Map<string, string>()
  if (c?.items.length) {
    out.push('## What they buy')
    for (const it of c.items.slice(0, 10)) {
      const hit = findCuts(it.name)[0]
      let mkt = ''
      if (hit && m.beef) {
        cutsTheyBuy.set(hit.imps, it.name)
        const r = bestRow(m.beef, hit.imps, /select/i.test(it.name) ? 'Select' : defaultGrade)
        if (r && (r.wavg ?? 0) > 0) mkt = ` · USDA ${money(perLb(r.wavg))} ${fmtPct(pct(r.wavg, r.prev))}`.trimEnd()
      }
      out.push(`- ${it.name}${it.volume ? ` · ${it.volume}` : ''}${it.price ? ` · paying ${it.price}` : ''}${mkt}`)
    }
    out.push('')
  }

  // Market talking points
  const mk: string[] = []
  const co = m.beef?.cutout
  if (co?.choice) mk.push(`Choice cutout ${co.choice.toFixed(2)}${co.choiceChg != null ? ` (${co.choiceChg > 0 ? '+' : ''}${co.choiceChg.toFixed(2)})` : ''}, Select ${co.select?.toFixed(2) ?? '—'} · USDA ${shortDate(m.beef?.reportDate)}`)
  const kill = m.market?.slaughter?.cattle
  if (kill) mk.push(`Cattle kill YTD ${kill.ytdPct > 0 ? '+' : ''}${kill.ytdPct}% vs last year: tight supply`)
  if (m.beef) {
    for (const imps of cutsTheyBuy.keys()) {
      const r = bestRow(m.beef, imps, defaultGrade)
      const p = r ? pct(r.wavg, r.avg5 ?? r.prev) : null
      if (r && p != null && Math.abs(p) >= 1) mk.push(`${lexFor(imps)?.label} ${p > 0 ? 'firming' : 'softening'} ${fmtPct(p)}`)
    }
  }
  if (mk.length) out.push('## Market', ...mk.map(x => `- ${x}`), '')

  // Questions to ask
  const qs = new Set<string>()
  for (const imps of [...cutsTheyBuy.keys()].slice(0, 3)) {
    const r = m.beef ? bestRow(m.beef, imps, defaultGrade) : null
    const name = cutsTheyBuy.get(imps) || lexFor(imps)?.label || imps
    for (const q of questionsFor(imps, r ? pct(r.wavg, r.prev) : null, undefined, co?.spread).slice(0, 2)) {
      qs.add(/holiday/i.test(q) ? q : `${name}: ${q.replace(/\bit\b/, 'it')}`)
    }
  }
  const month = new Date().getMonth() + 1
  if ((month >= 10 || month <= 1) && ![...qs].some(q => /holiday/i.test(q))) qs.add('What holiday features and ad dates are locked?')
  qs.add("What's moving well in the deli and prepared foods case right now?")
  qs.add('Anything a competitor is offering that I should know about?')
  if (last?.summary?.customerNeeds[0]) qs.add(`Did we solve "${last.summary.customerNeeds[0].slice(0, 60)}"?`)
  out.push('## Questions to ask', ...[...qs].slice(0, 6).map(q => `- ${q}`), '')

  // News
  const words = (c?.items || []).flatMap(i => i.name.toLowerCase().split(/\W+/)).filter(w => w.length > 4)
  const nameW = (c?.name || '').toLowerCase()
  const news = (m.news?.items || []).filter(n => {
    const t = n.title.toLowerCase()
    return (nameW && t.includes(nameW)) || words.some(w => t.includes(w)) || n.topics.some(x => x === 'beef' || x === 'grocery')
  }).slice(0, 3)
  if (news.length) out.push('## News to mention', ...news.map(n => `- ${n.title} (${n.source})`), '')

  if (c?.learned.length) out.push('## Remember', ...c.learned.slice(-4).map(l => `- ${l}`), '')
  out.push('## Add / pitch', '- ')
  return out.join('\n')
}

/** Split prep into glasses cards: one per "## section", chunked to fit the side panel. */
export function prepCards(p: Prep, maxChars = 230): Card[] {
  const sections: { h: string; body: string[] }[] = []
  for (const line of p.notes.split('\n')) {
    const m = line.match(/^#{1,3}\s+(.+)/)
    if (m) sections.push({ h: m[1].trim(), body: [] })
    else if (line.trim() && !/^-\s*(\(.*\))?\s*$/.test(line.trim())) {
      if (!sections.length) sections.push({ h: 'Prep', body: [] })
      sections[sections.length - 1].body.push(line.trim().replace(/^[-*]\s*/, '• '))
    }
  }
  const pages: { h: string; text: string }[] = []
  for (const s of sections.filter(s => s.body.length)) {
    let cur = ''
    for (const b of s.body) {
      if (cur && (cur + '\n' + b).length > maxChars) { pages.push({ h: s.h, text: cur }); cur = b }
      else cur = cur ? cur + '\n' + b : b
    }
    if (cur) pages.push({ h: s.h, text: cur.slice(0, maxChars + 60) })
  }
  return pages.map((pg, i) => ({
    kind: 'info' as const,
    key: `prep:${p.id}:${i}`,
    title: `Prep · ${pg.h}`,
    glass: `PREP ${i + 1}/${pages.length} · ${pg.h.toUpperCase()}\n${pg.text}`,
    phone: `${pg.h}\n${pg.text}`,
    at: Date.now(),
  }))
}

/** The prep to use for a customer: today's/upcoming first, else most recently edited. */
export function prepFor(kb: KB, customerId?: string): Prep | null {
  const list = (kb.preps || []).filter(p => p.customerId === customerId)
  if (!list.length) return null
  const t = today()
  const dated = list.filter(p => p.date && p.date >= t).sort((a, b) => a.date!.localeCompare(b.date!))
  return dated[0] || [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

/** Ask Claude to write the prep (pasted into the Claude Project). */
export function prepPacket(c: Customer | null, calls: Call[], draft: string, marketSnapshot: string, goal: string): string {
  const mine = c ? calls.filter(x => x.customerId === c.id).sort((a, b) => b.startedAt - a.startedAt).slice(0, 5) : []
  const hist = mine.map(x => `${new Date(x.startedAt).toLocaleDateString()}: ${x.summary?.aiText?.slice(0, 1200) || x.summary?.headline || ''}`).join('\n\n')
  return `Prep me for an upcoming meeting. Use the project files (customers, my numbers, price lists, market) and our past call chats in this project.

Write it in exactly this format. Short bullets, because I read it on my glasses mid-conversation:
## Goal
## Open follow-ups
## What they buy
## Market
## Questions to ask
## Add / pitch
## Watch out for
## Remember

<prep_request>
<meeting>${c ? c.name : 'not tagged'}${goal ? `\nmy goal: ${goal}` : ''}</meeting>
${c ? `<customer_profile>\n${customerBrief(c)}\n</customer_profile>` : ''}
${hist ? `<recent_calls>\n${hist}\n</recent_calls>` : ''}
<market_snapshot>
${marketSnapshot || '(none)'}
</market_snapshot>
<app_draft>
${draft}
</app_draft>
</prep_request>`
}
