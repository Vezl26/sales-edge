// Everything that goes to (and comes back from) Claude.
// Format: XML-style tagged sections — Claude reads these most reliably.
import type { Call, Customer, KnowledgeDoc, FollowUp, CallSummary } from '../types'
import type { KB } from '../kb/knowledge'
import { numbersDigest } from '../kb/knowledge'
import { transcriptText, customerBrief, fmtClock } from './summarize'

/** Paste this once into the Claude Project's "Instructions". */
export const PROJECT_INSTRUCTIONS = `You are Alan's sales assistant. Alan sells beef, deli, chocolate and prepared foods for Cargill and talks with customers in person and by phone. His smart glasses record conversations and send them here.

The project files contain his customers, his sales numbers, his price lists, and a USDA market snapshot. Use them, and cite the file when you use a number. Never invent prices, volumes or commitments. If something is unclear in the transcript, say so.

WHEN I PASTE A <call>:
The transcript labels come from microphone loudness ("Alan" = me, the other name = customer). They are usually right but can flip. Use context to fix obvious mistakes.

Reply in exactly this format so my app can read it back:

## Headline
One line: who, what, outcome.

## Key topics
- bullets

## Follow-ups
- Alan: action (due date if said)
- Customer: action (due date if said)
Only real commitments someone made. No "keep in touch" filler. Write "None" if there are none.

## Prices & volumes
- every price, volume, product or cut mentioned, with who said it

## Customer needs & objections
- bullets

## Market angle
- 2-3 points tying this customer to today's market (cutout, cut prices, kill, news) from the snapshot

## Talking points for next time
- 3-5 specific things to bring up next conversation

## Remember about this customer
- new durable facts (people, preferences, schedules, competitors). These get saved to the customer profile.

WHEN I ASK OTHER QUESTIONS (e.g. "what did I talk about with Food Lion on 10/12?", "prep me for my call with X", "how am I tracking vs last year?"):
Answer from the pasted calls in this project's chats and the project files. Be direct and specific, and use numbers when you have them.`

const tag = (name: string, body: string, attrs = '') => (body.trim() ? `<${name}${attrs}>\n${body.trim()}\n</${name}>` : '')

/** The packet for one call. Short task line on top so it also works outside the Project. */
export function callPacket(call: Call, customer: Customer | null, marketSnapshot: string, myNumbers: string): string {
  const start = new Date(call.startedAt)
  const mins = Math.max(1, Math.round(((call.endedAt ?? Date.now()) - call.startedAt) / 60000))
  const info = [
    `date: ${start.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    `time: ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
    `length: ${mins} min`,
    `customer: ${call.customerName || 'not tagged'}`,
    `speaker labels: Alan = me, ${call.otherLabel || call.customerName || 'Customer'} = them`,
    `call id: ${call.id}`,
  ].join('\n')
  const auto = call.summary
  const autoNotes = auto ? [
    auto.followUps.length ? `possible follow-ups: ${auto.followUps.map(f => `${f.owner}: ${f.text}`).join(' | ')}` : '',
    auto.prices.length ? `prices heard: ${auto.prices.join(', ')}` : '',
    auto.volumes.length ? `volumes heard: ${auto.volumes.join(', ')}` : '',
  ].filter(Boolean).join('\n') : ''
  const cards = call.cards.filter(c => c.kind === 'price' || c.kind === 'mine').map(c => `[${fmtClock(c.t)}] ${c.title}: ${c.body.split('\n').slice(0, 4).join(' · ')}`).join('\n')
  return [
    'Summarize this sales call using the format in the project instructions. (If there are no project instructions: give headline, key topics, real follow-ups with owner and due date, prices & volumes, customer needs, market angle, talking points for next time, and facts to remember.)',
    '',
    `<call>`,
    tag('call_info', info),
    customer ? tag('customer_profile', customerBrief(customer)) : '',
    tag('market_snapshot', marketSnapshot),
    tag('my_numbers', myNumbers),
    tag('prices_shown_on_glasses', cards),
    tag('app_auto_notes', autoNotes),
    call.notes ? tag('alans_notes', call.notes) : '',
    tag('transcript', transcriptText(call) || '(empty)'),
    `</call>`,
  ].filter(x => x !== '').join('\n')
}

// ---------- knowledge files for the Claude Project ----------
export function customersFile(kb: KB): string {
  const lines = ['# Alan\'s customers', `Exported ${new Date().toLocaleString()} from Sales Edge.`, '']
  for (const c of [...kb.customers].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`## ${c.name}`)
    if (c.aliases.length) lines.push(`Also called: ${c.aliases.join(', ')}`)
    if (c.segment) lines.push(`Segment: ${c.segment}`)
    if (c.location) lines.push(`Location: ${c.location}`)
    if (c.contact) lines.push(`Contact: ${c.contact}`)
    if (c.items.length) {
      lines.push('', '| Item | Volume | Price | Notes |', '|---|---|---|---|')
      for (const i of c.items) lines.push(`| ${i.name} | ${i.volume ?? ''} | ${i.price ?? ''} | ${i.notes ?? ''} |`)
    }
    if (c.notes) lines.push('', `Notes: ${c.notes}`)
    if (c.learned.length) lines.push('', 'Learned from calls:', ...c.learned.map(l => `- ${l}`))
    lines.push('')
  }
  return lines.join('\n')
}

export function docsFile(docs: KnowledgeDoc[], title: string): string {
  const out = [`# ${title}`, `Exported ${new Date().toLocaleString()} from Sales Edge.`, '']
  for (const d of docs) {
    out.push(`## ${d.title} (${d.kind}, added ${new Date(d.addedAt).toLocaleDateString()})`)
    if (d.table) {
      if (d.kind === 'numbers') out.push('Quick totals:', ...numbersDigest(d).map(x => `- ${x}`), '')
      out.push(`| ${d.table.headers.join(' | ')} |`, `|${d.table.headers.map(() => '---').join('|')}|`)
      for (const r of d.table.rows) out.push(`| ${d.table.headers.map((_, i) => (r[i] ?? '').replace(/\|/g, '/')).join(' | ')} |`)
    } else out.push(d.text)
    out.push('')
  }
  return out.join('\n')
}

// ---------- reading Claude's answer back ----------
const section = (text: string, name: RegExp): string[] => {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^#{1,4}\s/.test(l.trim()) && name.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,4}\s/.test(l.trim())) break
    const t = l.replace(/^\s*[-*•]\s*/, '').trim()
    if (t && !/^none\.?$/i.test(t)) out.push(t)
  }
  return out
}

export function parseClaudeNotes(text: string): CallSummary {
  const headline = section(text, /headline/i)[0] || text.split('\n').find(l => l.trim())?.replace(/^[#*\s]+/, '') || ''
  const followUps: FollowUp[] = section(text, /follow/i).map(l => {
    const m = l.match(/^\**(Alan|Customer|Both|[A-Z][\w .'-]{1,30}?)\**\s*[:—-]\s*(.+)$/)
    const owner: FollowUp['owner'] = !m ? 'Alan' : /^alan$/i.test(m[1]) ? 'Alan' : /^both$/i.test(m[1]) ? 'Both' : 'Customer'
    const body = m ? m[2] : l
    const due = body.match(/\(([^)]*\b(today|tomorrow|day|week|month|mon|tue|wed|thu|fri|sat|sun|\d{1,2}\/\d{1,2})[^)]*)\)\s*$/i)?.[1]
    return { owner, text: due ? body.replace(/\s*\([^)]*\)\s*$/, '') : body, due }
  })
  return {
    generatedBy: 'ai',
    headline: headline.slice(0, 160),
    topics: section(text, /topic/i),
    followUps,
    prices: section(text, /price|volume/i),
    volumes: [],
    customerNeeds: section(text, /need|objection/i),
    talkingPointsNext: [...section(text, /talking point|next time/i), ...section(text, /market angle/i)],
    aiText: text.trim(),
  }
}

export function rememberLines(text: string): string[] {
  return section(text, /remember/i)
}
