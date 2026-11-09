// Call summaries. Works with zero AI (rule-based), and upgrades to an AI summary
// when a model key is configured. Also builds a ready-to-paste packet for Claude.
import type { Call, CallSummary, FollowUp, Customer, Segment } from '../types'
import { findCuts, lexFor } from '../intel/lexicon'

const who = (s: Segment, other = 'Customer') => (s.spk === 'A' ? 'Alan' : s.spk === 'C' ? other : 'Unknown')

export function transcriptText(call: Call): string {
  const other = (call.otherLabel || call.customerName || 'Customer') + (isGroup(call) ? ' (group)' : '')
  const lines: string[] = []
  let last = ''
  for (const s of call.segments) {
    const w = who(s, other)
    const ts = fmtClock(s.t)
    if (w === last && lines.length) lines[lines.length - 1] += ' ' + s.text
    else lines.push(`[${ts}] ${w}: ${s.text}`)
    last = w
  }
  return lines.join('\n')
}

export const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const DAY = /(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|end of (the )?(day|week|month)|first thing|by \w+day|\d{1,2}\/\d{1,2})/i
// A real follow-up = a first-person commitment AND a business action verb (not "I'll kick it off to you").
const COMMIT_ALAN = /\b(i'll|i will|we'll|we will|i'm going to|i am going to|let me|i can (?:get|send|check|pull|run|find|have|share))\b.{0,40}\b(send|email|quote|price|check|confirm|call|follow up|get back|look into|find out|talk to|ask|ship|order|set up|schedule|book|deliver|pull|run|update|share|forward|get you|get that)\b/i
const MEETING_TALK = /\b(kick it off|kick off|hand it (over|off)|turn it over|pass it|share my screen|go ahead|next slide|on mute|can you hear|you're up|over to you|agenda)\b/i
// The other side only counts when they promise something TO Alan.
const COMMIT_CUST = /\b(i'll|i will|we'll|we will|let me|i'm going to)\b.{0,50}\b(get back to you|let you know|send you|send (it|that|those|them|over)|email you|call you|text you|follow up|get you|run it by|check (on|with)|confirm (with|for))\b/i
// Describing how they normally work is not a to-do.
const HABITUAL = /\b(sometimes|usually|typically|always|normally|generally|whenever|every (day|night|week|morning)|each (day|night|week))\b/i
const SUBORDINATE = /^(where|when|which|that|because|since|if|so that|while)\b/i
const TEMP = /\b\d{2,3}\s?(?:°\s?f?|degrees?|deg)\b|\b\d{2,3}\s?f\b/i
const MONEY = /\$\s?\d|\b(thousands?|millions?) of dollars\b/i
const DECISION = /\b(we('re| are)? (going|gonna) to|we will|we'll|moving forward|going forward|the plan|agreed|decided|propos(e|ed|al)|suggest(ed|ion)?|we need to|we want to|we gotta|(i|we) (asked|told) (them|him|her|y'all))\b/i
const ISSUE = /\b(credits?|discolor\w*|brown|purge|gass(ed|ing)|reject\w*|complain\w*|problem|issue|recall|shortage|spoil\w*|cold chain|temperature|warm)\b/i
const NEED = /\b(need|needs|looking for|want|wanted|short on|out of|running low|problem|issue|complain|too high|too expensive|competitor|cheaper|quality|late|delivery|shortage|promo|feature|ad)\b/i
const PRICE = /(\$\s?\d[\d,]*(\.\d+)?|\d+(\.\d+)?\s?(dollars|bucks|cents))(\s?(a|per|\/)\s?(lb|pound|case|cwt|hundredweight|box))?/gi
const VOLUME = /\b\d[\d,]*(\.\d+)?\s?(k\s)?(lbs?|pounds|cases|loads|boxes|pallets|trucks|combos|head)\b/gi

const PRODUCT_WORDS: [RegExp, string][] = [
  [/\bdeli|turkey breast|roast beef|ham|salami|pastrami|lunch ?meat/i, 'Deli'],
  [/\bchocolate|cocoa|confection|coating|chips?\b/i, 'Chocolate'],
  [/\bprepared|ready to (eat|cook)|meal kit|fully cooked|rotisserie|heat and eat/i, 'Prepared foods'],
  [/\bground beef|chubs?|patties|grind|trim\b|81\/19|80\/20|93\/7/i, 'Ground beef & trim'],
  [/\bcutout|market|futures|cattle|slaughter|kill|usda/i, 'Market conditions'],
  [/\bdelivery|truck|freight|route|ship/i, 'Logistics & delivery'],
  [/\bprice|pricing|quote|cost|margin/i, 'Pricing'],
  [/\bpromo|feature|ad\b|circular|holiday|thanksgiving|christmas|easter|memorial|labor day|july/i, 'Promotions & features'],
]

export function autoSummary(call: Call, customer?: Customer | null): CallSummary {
  const segs = call.segments
  const all = segs.map(s => s.text).join(' ')
  const topics = new Map<string, number>()
  for (const h of findCuts(all)) {
    const l = lexFor(h.imps)
    if (l) topics.set(`${l.label} (${h.imps})`, (topics.get(`${l.label} (${h.imps})`) || 0) + 1)
  }
  for (const [re, label] of PRODUCT_WORDS) {
    const n = segs.filter(s => re.test(s.text)).length
    if (n) topics.set(label, (topics.get(label) || 0) + n)
  }
  for (const it of customer?.items || []) {
    const w = it.name.toLowerCase().split(/\s+/).filter(x => x.length > 3)
    if (w.length && segs.some(s => w.every(x => s.text.toLowerCase().includes(x)))) topics.set(it.name, (topics.get(it.name) || 0) + 1)
  }

  const group = isGroup(call)
  const followUps: FollowUp[] = []
  for (const s of segs) {
    if (s.spk === '?') continue
    const isAlan = s.spk === 'A'
    if (!isAlan && group) continue // in a group meeting, only your own promises are trusted
    for (const sent of s.text.split(/(?<=[.!?])\s+/)) {
      const t = tidy(sent)
      if (t.endsWith('?') || t.split(/\s+/).length < 5) continue
      if (MEETING_TALK.test(t) || HABITUAL.test(t) || SUBORDINATE.test(t)) continue
      if (!(isAlan ? COMMIT_ALAN : COMMIT_CUST).test(t)) continue
      followUps.push({ owner: isAlan ? 'Alan' : 'Customer', text: t, due: t.match(DAY)?.[0], auto: true })
    }
  }

  const prices = withContext(segs, PRICE)
  const volumes = withContext(segs, VOLUME)
  const keyPts = keyPoints(segs)
  const customerNeeds = segs
    .filter(s => s.spk !== 'A')
    .flatMap(s => s.text.split(/(?<=[.!?])\s+/))
    .filter(x => NEED.test(x) && x.split(' ').length > 3)
    .map(tidy)
    .slice(0, 6)

  const top = [...topics.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  const mins = Math.max(1, Math.round(((call.endedAt ?? Date.now()) - call.startedAt) / 60000))
  const headline = `${call.customerName ? call.customerName + ' — ' : ''}${group ? 'Meeting · ' : ''}${top.slice(0, 3).join(', ') || 'General call'} (${mins} min)`
  const talkingPointsNext = [
    ...followUps.filter(f => f.owner === 'Alan').slice(0, 2).map(f => `Close the loop: ${f.text}`),
    ...customerNeeds.slice(0, 2).map(n => `Address: ${n}`),
  ]
  return {
    generatedBy: 'auto', headline, topics: top.slice(0, 8),
    followUps: dedupeFollowUps(followUps).slice(0, 8), prices, volumes, customerNeeds, talkingPointsNext,
    keyPoints: keyPts,
  }
}

/** Several people on the other side? Set by hand, or guessed when the speech service hears 4+ voices. */
export function isGroup(call: Call): boolean {
  if (call.group !== undefined) return call.group
  const counts = new Map<number, number>()
  for (const s of call.segments) if (s.dz !== undefined) counts.set(s.dz, (counts.get(s.dz) ?? 0) + 1)
  return [...counts.values()].filter(n => n >= 3).length >= 4
}

/** The sentences that carry numbers, temperatures, decisions and problems. */
function keyPoints(segs: Segment[]): string[] {
  const found: { n: number; text: string; score: number }[] = []
  let n = 0
  for (const s of segs) {
    if (s.spk === '?') continue
    for (const sent of s.text.split(/(?<=[.!?])\s+/)) {
      const t = tidy(sent)
      const words = t.split(/\s+/).length
      n++
      if (words < 8 || words > 40 || t.endsWith('?') || MEETING_TALK.test(t)) continue
      const score = (MONEY.test(t) ? 2 : 0) + (TEMP.test(t) ? 2 : 0) + (DECISION.test(t) ? 2 : 0) + (ISSUE.test(t) ? 1 : 0) + (/\d/.test(t) ? 1 : 0)
      if (score >= 3) found.push({ n, text: t.length > 220 ? t.slice(0, 217).replace(/\s\S*$/, '') + '…' : t, score })
    }
  }
  const top = found.sort((a, b) => b.score - a.score || a.n - b.n).slice(0, 8).sort((a, b) => a.n - b.n)
  return dedupe(top.map(x => x.text))
}

/** Each price/volume with the words around it, so "$89,000" is never a bare number. */
function withContext(segs: Segment[], re: RegExp, max = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of segs) {
    for (const m of s.text.matchAll(re)) {
      const key = m[0].trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const i = m.index ?? 0
      const from = Math.max(0, i - 70)
      const to = Math.min(s.text.length, i + m[0].length + 45)
      let ctx = s.text.slice(from, to).replace(/\s+/g, ' ').trim()
      if (from > 0) ctx = '…' + ctx.replace(/^\S*\s/, '')
      if (to < s.text.length) ctx = ctx.replace(/\s\S*$/, '') + '…'
      out.push(`${m[0].trim()} — “${ctx}”`)
      if (out.length >= max) return out
    }
  }
  return out
}

const dedupe = (a: string[]) => a.filter((x, i) => a.findIndex(y => y.toLowerCase().slice(0, 40) === x.toLowerCase().slice(0, 40)) === i)
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^(so|and|um|uh|okay|ok|yeah|well|you know),?\s+/i, '').trim()
const uniq = (a: string[]) => [...new Set(a.map(x => x.toLowerCase()))].map(x => a.find(y => y.toLowerCase() === x)!)
function dedupeFollowUps(f: FollowUp[]) {
  const seen = new Set<string>()
  return f.filter(x => { const k = x.text.toLowerCase().slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true })
}

// ---------- AI prompt (used for the in-app AI and for "Send to Claude") ----------
export function summaryPrompt(call: Call, customer: Customer | null, marketContext: string, myNumbers: string): string {
  const when = new Date(call.startedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
  return `You are Alan's sales assistant. Alan sells beef, deli, chocolate and prepared foods for Cargill.
Summarize this sales conversation. Be concrete and short. Only list follow-ups someone actually committed to
(not vague pleasantries), with owner and due date if said. Do not invent numbers.

Return these sections:
1. Headline (one line)
2. Key topics (bullets)
3. Follow-ups — "Owner: action (due)" — only real commitments
4. Prices, volumes and products mentioned
5. What the customer needs / objections
6. Talking points for the next conversation (use the market data below where relevant)
7. New facts to remember about this customer (preferences, people, schedules)

Call: ${when}${call.customerName ? ` with ${call.customerName}` : ''}
${customer ? `Customer profile:\n${customerBrief(customer)}\n` : ''}
Market data today:
${marketContext || '(none loaded)'}
${myNumbers ? `\nAlan's numbers:\n${myNumbers}\n` : ''}
Transcript (speaker labels come from mic loudness and may be wrong occasionally):
${transcriptText(call)}`
}

export function customerBrief(c: Customer): string {
  return [
    `Name: ${c.name}${c.segment ? ` (${c.segment})` : ''}${c.location ? `, ${c.location}` : ''}`,
    c.contact ? `Contact: ${c.contact}` : '',
    c.items.length ? `Buys: ${c.items.map(i => `${i.name}${i.volume ? ` ${i.volume}` : ''}${i.price ? ` @ ${i.price}` : ''}`).join('; ')}` : '',
    c.notes ? `Notes: ${c.notes}` : '',
    c.learned.length ? `Learned: ${c.learned.join('; ')}` : '',
  ].filter(Boolean).join('\n')
}

export function summaryToText(s: CallSummary): string {
  const sec = (t: string, a: string[]) => (a.length ? `${t}\n${a.map(x => `• ${x}`).join('\n')}` : '')
  if (s.aiText) return s.aiText
  return [
    s.headline,
    sec('Key points', s.keyPoints ?? []),
    sec('Topics', s.topics),
    sec(s.followUps.some(f => f.auto) ? 'Possible follow-ups (check them)' : 'Follow-ups', s.followUps.map(f => `${f.owner}: ${f.text}${f.due ? ` (${f.due})` : ''}`)),
    sec('Prices mentioned', s.prices),
    sec('Volumes mentioned', s.volumes),
    sec('Customer needs', s.customerNeeds),
    sec('Next time', s.talkingPointsNext),
  ].filter(Boolean).join('\n\n')
}
