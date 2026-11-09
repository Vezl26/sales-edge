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
// A real need or objection, not "let me know what you need" or "what we need to talk about".
const NEED = /\b(we need|i need|they need|need (?:to get|more|some|a few|\d)|looking for|short on|running low|too (?:high|expensive)|cheaper|competitor|complain\w*|problem|issue|shortage|late delivery|quality)\b/i
const NEED_META = /\b(talk about|let me know|what you need|what we need|need to (?:talk|chat|touch|catch|discuss)|need from you)\b/i
// Words that show an internal call (your boss or team) and not a customer.
const INTERNAL_HINT = /\b((?:my|our|your) (?:boss|manager|director)|(?:new|this|last|my|your) role|one[- ]on[- ]one|1:1|performance review|team meeting)\b/i
// Business substance: used to pick the sentences worth keeping when there are few numbers.
const BIZ = /\b(pric(?:e|es|ing)|cost(?:s|ing)?|contract|commitment|formula|usda|margin|volume|supply|case[- ]ready|leverage|quote|retailers?|cutout|forecast|rebate|credits?|freight|ground beef|trim|chubs?|deli|chocolate|cocoa)\b/gi
const ADVICE = /\b(remember|the idea is|you(?:'ll| will| can| should| gotta)|we (?:should|gotta)|make sure|the (?:key|point|goal) is)\b/i
const PRICE = /(\$\s?\d[\d,]*(\.\d+)?|\d+(\.\d+)?\s?(dollars|bucks|cents))(\s?(a|per|\/)\s?(lb|pound|case|cwt|hundredweight|box))?/gi
const VOLUME = /\b\d[\d,]*(\.\d+)?\s?(k\s)?(lbs?|pounds|cases|loads|boxes|pallets|trucks|combos|head)\b/gi

const PRODUCT_WORDS: [RegExp, string][] = [
  [/\b(?:deli|turkey breast|roast beef|salami|pastrami|lunch ?meat)\b/i, 'Deli'],
  [/\b(?:chocolate|cocoa|confection\w*|coating)\b/i, 'Chocolate'],
  [/\b(?:prepared foods?|ready to (?:eat|cook)|meal kits?|fully cooked|rotisserie|heat and eat)\b/i, 'Prepared foods'],
  [/\b(?:ground beef|chubs?|patties|grinds?|trim|81\/19|80\/20|93\/7)\b/i, 'Ground beef & trim'],
  [/\b(?:cutout|futures|cattle|slaughter|usda|boxed beef)\b/i, 'Market conditions'],
  [/\b(?:deliver(?:y|ies)|trucks?|freight|routes?|shipping|shipment)\b/i, 'Logistics & delivery'],
  [/\b(?:pric(?:e|es|ing)|quotes?|costs?|costing|margins?)\b/i, 'Pricing'],
  [/\b(?:promos?|promotions?|features?|ads?|circular|holiday|thanksgiving|christmas|easter|memorial day|labor day)\b/i, 'Promotions & features'],
]
/** A topic needs to come up in at least this many lines before it is listed. */
const MIN_TOPIC_LINES = 2

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
    if (n >= MIN_TOPIC_LINES) topics.set(label, (topics.get(label) || 0) + n)
  }
  for (const it of customer?.items || []) {
    const w = it.name.toLowerCase().split(/\s+/).filter(x => x.length > 3)
    if (w.length && segs.some(s => w.every(x => s.text.toLowerCase().includes(x)))) topics.set(it.name, (topics.get(it.name) || 0) + 1)
  }

  const group = isGroup(call)
  const internal = isInternal(call)
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
  const keyPts = keyPoints(segs, internal)
  const customerNeeds = internal ? [] : segs
    .filter(s => s.spk !== 'A')
    .flatMap(s => s.text.split(/(?<=[.!?])\s+/))
    .map(tidy)
    .filter(x => NEED.test(x) && !NEED_META.test(x) && !x.endsWith('?') && x.split(' ').length >= 5 && !HABITUAL.test(x))
    .slice(0, 6)

  const top = [...topics.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  const mins = Math.max(1, Math.round(((call.endedAt ?? Date.now()) - call.startedAt) / 60000))
  const headline = `${call.customerName ? call.customerName + ' — ' : ''}${internal ? 'Internal call · ' : group ? 'Meeting · ' : ''}${top.slice(0, 3).join(', ') || 'General call'} (${mins} min)`
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

/** A catch-up with your boss or team, not a customer. Set by hand, or guessed from the words used. */
export function isInternal(call: Call): boolean {
  if (call.internal !== undefined) return call.internal
  if (call.customerId) return false
  return call.segments.filter(s => INTERNAL_HINT.test(s.text)).length >= 2
}

/** Sentences about pricing, contracts and strategy. Fills in when a call has few numbers. */
function substance(segs: Segment[]): { n: number; text: string; score: number }[] {
  const out: { n: number; text: string; score: number }[] = []
  let n = 0
  for (const s of segs) {
    if (s.spk === '?') continue
    for (const sent of s.text.split(/(?<=[.!?])\s+/)) {
      const t = tidy(sent)
      const words = t.split(/\s+/).length
      n++
      if (words < 8 || words > 40 || t.endsWith('?') || MEETING_TALK.test(t)) continue
      const biz = new Set((t.match(BIZ) ?? []).map(x => x.toLowerCase())).size
      const score = Math.min(2, biz) + (ADVICE.test(t) ? 1 : 0)
      if (biz >= 2 || (biz >= 1 && ADVICE.test(t))) out.push({ n, text: t.length > 220 ? t.slice(0, 217).replace(/\s\S*$/, '') + '…' : t, score })
    }
  }
  return out
}

/** The sentences that carry numbers, temperatures, decisions and problems. */
function keyPoints(segs: Segment[], internal = false): string[] {
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
  const want = internal ? 6 : 5
  if (found.length < want) {
    const have = new Set(found.map(x => x.n))
    const extra = substance(segs).filter(x => !have.has(x.n)).sort((a, b) => b.score - a.score || a.n - b.n).slice(0, want - found.length)
    found.push(...extra)
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
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^((so|and|but|um|uh|okay|ok|yeah|well|like|right|you know),?\s+)+/i, '').trim()
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
    sec(s.headline.includes('Internal call') ? 'What was discussed' : 'Key points', s.keyPoints ?? []),
    sec('Topics', s.topics),
    sec(s.followUps.some(f => f.auto) ? 'Possible follow-ups (check them)' : 'Follow-ups', s.followUps.map(f => `${f.owner}: ${f.text}${f.due ? ` (${f.due})` : ''}`)),
    sec('Prices mentioned', s.prices),
    sec('Volumes mentioned', s.volumes),
    sec('Customer needs', s.customerNeeds),
    sec('Next time', s.talkingPointsNext),
  ].filter(Boolean).join('\n\n')
}
