// Suggested replies when the customer asks something or pushes back.
// Built from live USDA numbers + your prep/docs. Free (no AI); upgrades to an AI
// suggestion when an AI key is set in Settings.
import type { Settings } from '../types'
import type { KB } from '../kb/knowledge'
import { findCuts, lexFor } from './lexicon'
import { type MarketBundle, bestRow, perLb, money, pct } from './market'
import { searchDocs } from '../prep/prompter'
import { isPrivateMetric } from '../kb/knowledge'
import type { Customer } from '../types'

export interface ReplyCtx { m: MarketBundle; s: Settings; kb: KB; goal?: string; avoid?: Set<string>; customer?: Customer | null }

const has = (re: RegExp, t: string) => re.test(t)
const spokenPct = (p: number | null) => (p == null ? '' : `${p >= 0 ? 'up' : 'down'} ${Math.abs(p).toFixed(0)}%`)

/** Returns a short line Alan can say, or null. */
export function suggestReply(text: string, ctx: ReplyCtx): string | null {
  const t = text.toLowerCase()
  const isQ = /\?\s*$/.test(text.trim()) || /^(what|how|why|when|where|can|could|will|would|do|does|is|are|any)\b/.test(t)
  const { m, s } = ctx
  const co = m.beef?.cutout
  const kill = m.market?.slaughter?.cattle
  const cut = findCuts(text)[0]

  // "How are we doing?": volume trend only, never margin or cost
  if (ctx.customer && /how('?s| is| are) (we|the account|it|things|business) (doing|going|trending|looking)|our (volume|numbers)|up or down|vs\.? last year/.test(t)) {
    const all = { ...(ctx.customer.metrics || {}) }
    const pub = Object.entries(all).filter(([k]) => !isPrivateMetric(k))
    const trend = pub.find(([k]) => /%|chg|change|vs|ly|yoy/i.test(k))
    const vol = pub.find(([k]) => /vol|lbs|cases|ytd/i.test(k) && k !== trend?.[0])
    if (trend || vol) {
      const up = trend && !/^-|\(/.test(trend[1].trim())
      return `${vol ? `You're at ${vol[1]} ${vol[0].toLowerCase()}` : 'Volume is'}${trend ? `, ${trend[1]} vs last year` : ''}. ${up ? "Good momentum, so let's build on it." : "Let's talk about what would get that back up."} What's moving best for you right now?`
    }
  }
  // Price question or push-back on a specific cut
  if (cut && has(/price|cost|pay|paying|quote|how much|where('?s| is)|running|market|high|expensive|cheaper|deal/, t)) {
    const r = bestRow(m.beef, cut.imps, s.defaultGrade)
    const lb = perLb(r?.wavg)
    if (r && lb) {
      const mv = pct(r.wavg, r.avg5 ?? r.prev)
      const dir = mv == null ? '' : mv > 1 ? ', and it has been firming' : mv < -1 ? ', and it has softened a bit' : ', steady this week'
      const label = /^\d/.test(cut.phrase) ? lexFor(cut.imps)!.label.toLowerCase().replace(/ \d.*$/, '') : cut.phrase.toLowerCase()
      if (has(/high|expensive|cheaper|too much|better price|competitor/, t))
        return `I hear you. ${r.grade} ${label} ${/s$/.test(label) ? "are" : "is"} trading around ${money(lb)}/lb at USDA${dir}. Let's look at volume or timing to get you a better number.`
      return `${r.grade} ${label} ${/s$/.test(label) ? "are" : "is"} trading around ${money(lb)}/lb at USDA${dir}. Want me to quote you on volume for next week?`
    }
  }
  // Competitor / price objection in general
  if (has(/cheaper|competitor|too (high|expensive)|better price|beat that|lower price|undercut/, t)) {
    const supply = kill ? ` Kill is ${kill.ytdPct > 0 ? 'up' : 'down'} ${Math.abs(kill.ytdPct)}% vs last year, so supply is tight.` : ''
    const sel = co?.spread ? ` One option is Select, about $${(co.spread / 100).toFixed(2)}/lb under Choice right now.` : ''
    return `Understood. The market's been firm${co?.choice ? ` (Choice cutout ${co.choice.toFixed(0)})` : ''}.${supply}${sel} What volume would you need to make it work?`
  }
  // Supply / availability
  if (has(/supply|availability|available|short(age)?|tight|can you get|in stock|out of/, t) && kill) {
    return `Cattle numbers are down ${Math.abs(kill.ytdPct)}% year to date, so supply is tight. Locking volume now is the best way to protect you. How much do you need, and for when?`
  }
  // Quality / color / temperature
  if (has(/gray|grey|brown|color|discolor|smell|spoil|bad|quality|temp(erature)?|warm|leak/, t)) {
    return `Let's get to the bottom of it. Gray inside a sealed package is normal, but temps and dates tell the real story. Can we pull the walk-in and receiving temp logs and the lot/pack date?`
  }
  // Delivery / service
  if (has(/deliver(y|ies)?|late|truck|driver|ship|order (is|was)|missing|wrong/, t)) {
    return `I'll check with logistics right after this and get back to you today with an answer and a time.`
  }
  // Holiday / features / ads
  if (has(/holiday|thanksgiving|christmas|new year|easter|ad\b|feature|promo|circular/, t)) {
    const rib = bestRow(m.beef, '112A', 'Choice')
    const ten = bestRow(m.beef, '189A', 'Choice')
    const px = [rib?.wavg ? `Ribeyes ~${money(perLb(rib.wavg))}` : '', ten?.wavg ? `tenderloins ~${money(perLb(ten.wavg))}` : ''].filter(Boolean).join(', ')
    return `Let's lock your feature volume now while we can still plan it${px ? `. ${px}/lb at USDA today` : ''}. What dates and items are you thinking?`
  }
  // Retail / shopper
  if (has(/retail|shoppers?|consumers?|in stores?|shelf/, t)) {
    const g = m.market?.retail?.items.find(i => /ground/i.test(i.item))
    if (g?.price) return `Retail ground beef is averaging ${money(g.price)}/lb in ads${g.pyPrice ? `, ${spokenPct(pct(g.price, g.pyPrice))} vs last year` : ''}. Shoppers are watching price, so value and consistency win.`
  }
  // Anything else they ask: answer from your documents if there's a solid match
  if (isQ) {
    const hit = searchDocs(ctx.kb, text, undefined, 1)[0]
    if (hit && hit.score >= 1.6) return `From ${hit.doc}: ${hit.text.slice(0, 180)}`
  }
  return null
}

export function aiReplyPrompt(question: string, recent: string, goal: string, facts: string): string {
  return `You are coaching Alan, a Cargill sales rep (beef, deli, chocolate, prepared foods), live during a customer conversation.
The customer just said: "${question}"
Recent conversation:
${recent}
${goal ? `Alan's goal: ${goal}\n` : ''}Facts you may use (never invent numbers):
${facts}
Write ONE thing Alan can say next: natural, confident, max 30 words, ending with a question that moves toward the goal when it fits. Output only the sentence.`
}
