// Live intelligence: watches finished transcript lines and raises cards
// (prices, market stats, customer talking points, your own price list hits).
import type { Settings, Customer } from '../types'
import type { KB } from '../kb/knowledge'
import { findCustomerMention, findPriceListItems, formatRow, customerTalkingPoints, accountLines } from '../kb/knowledge'
import { findCuts } from './lexicon'
import { type Card, type MarketBundle, priceCard, cutoutCard, killCard, cattleCard, groundCard, retailCard, money } from './market'
import type { Call } from '../types'

const ASKY = /\b(price|prices|cost|costs|where('?s| is)|what('?s| is)|market|quote|how much|at now|trading|running|going for|per pound|a pound)\b/i

export class IntelEngine {
  private lastShown = new Map<string, number>()
  customer: Customer | null = null
  onCustomer?: (c: Customer) => void

  constructor(
    private getMarket: () => MarketBundle,
    private getSettings: () => Settings,
    private getKB: () => KB,
    private getCalls: () => Call[],
  ) {}

  reset(customer: Customer | null) {
    this.lastShown.clear()
    this.customer = customer
  }

  private fresh(key: string, force: boolean, cooldownMs = 45000) {
    const t = this.lastShown.get(key) ?? 0
    if (!force && Date.now() - t < cooldownMs) return false
    this.lastShown.set(key, Date.now())
    return true
  }

  ingest(text: string): Card[] {
    const cards: Card[] = []
    const b = this.getMarket()
    const s = this.getSettings()
    const asky = ASKY.test(text)
    const lower = text.toLowerCase()

    // Customer recognized by name
    if (!this.customer) {
      const c = findCustomerMention(this.getKB(), text)
      if (c) {
        this.customer = c
        this.onCustomer?.(c)
        const card = this.customerCard(c)
        if (card) cards.push(card)
      }
    }

    // Beef cuts -> USDA price card
    const grade = /\bselect\b/i.test(text) ? 'Select' : /\bchoice\b/i.test(text) ? 'Choice' : undefined
    const seen = new Set<string>()
    for (const h of findCuts(text)) {
      if (seen.has(h.imps)) continue
      seen.add(h.imps)
      const card = priceCard(b, s, h.imps, grade)
      if (card && this.fresh(card.key, asky)) cards.push(card)
    }

    // Market stats on request
    if (/\bcut ?out\b|\bcomposite\b|\bprimal/i.test(lower)) pushIf(cards, cutoutCard(b), c => this.fresh(c.key, asky))
    if (/\b(kill|slaughter|harvest|packers? (are )?running|head count)\b/i.test(lower)) pushIf(cards, killCard(b), c => this.fresh(c.key, asky))
    if (/\b(fed cattle|cash cattle|live cattle|cattle prices?|steer prices?|carcass weights?|cattle weights?|dressed (price|weight)|live weight)\b/i.test(lower)) pushIf(cards, cattleCard(b), c => this.fresh(c.key, asky))
    if (/\b(ground beef|chubs?|grind|trim(mings)?|81s|80\/20|81\/19|93\/7|90s|50s|lean)\b/i.test(lower)) pushIf(cards, groundCard(b, text), c => this.fresh(c.key, asky))
    if (/\b(retail|in (the )?stores?|shelf|ad price|ads?\b|feature(d|s)?|grocery|consumers?|shoppers?)\b/i.test(lower)) pushIf(cards, retailCard(b, text), c => this.fresh(c.key, asky))

    // Account questions: "how's the account doing", volume, margin, vs last year
    if (this.customer && /\b(how('?s| is| are) (we|the account|it|things|business) (doing|going|trending|looking)|account|volume|margin|numbers|year over year|vs\.? last year|up or down|trending|ytd|year to date)\b/i.test(lower)) {
      const c = this.customer
      const lines = accountLines(c)
      if (lines.length && this.fresh(`acct:${c.id}`, asky, 60000)) {
        cards.push({ kind: 'customer', key: `acct:${c.id}`, title: `${c.name} account`, glass: [`ACCOUNT ${c.name.toUpperCase().slice(0, 18)}${c.metricsAsOf ? ` · ${c.metricsAsOf.slice(5)}` : ''}`, ...lines].join('\n').slice(0, 420), phone: [`${c.name} — numbers as of ${c.metricsAsOf || '?'} (internal, don't read margin aloud)`, ...lines].join('\n'), at: Date.now() })
      }
    }

    // Your own price lists (deli, chocolate, prepared foods...)
    for (const hit of findPriceListItems(this.getKB(), text)) {
      const key = `mine:${hit.doc.id}:${hit.name}`
      if (!this.fresh(key, asky, 60000)) continue
      const body = formatRow(hit.doc.table!, hit.row)
      cards.push({ kind: 'mine', key, title: hit.name, glass: `${hit.name.toUpperCase()}\n(${hit.doc.title})\n${body.replace(/ · /g, '\n')}`.slice(0, 380), phone: `${hit.name}\nFrom: ${hit.doc.title}\n${body}`, at: Date.now() })
    }

    // Quick conversions when a price is said out loud
    const conv = conversionCard(text)
    if (conv && this.fresh(conv.key, true, 15000)) cards.push(conv)

    return cards
  }

  customerCard(c: Customer): Card | null {
    const b = this.getMarket()
    const pts = customerTalkingPoints(c, this.getCalls(), b.news?.items || [])
    const items = c.items.slice(0, 3).map(i => `• ${i.name}${i.volume ? ' ' + i.volume : ''}`)
    const lines = [c.name.toUpperCase(), ...items, ...pts.map(p => `› ${p}`)]
    return { kind: 'customer', key: `cust:${c.id}`, title: c.name, glass: lines.join('\n').slice(0, 420), phone: lines.join('\n'), at: Date.now() }
  }
}

function pushIf(arr: Card[], c: Card | null, ok: (c: Card) => boolean) {
  if (c && ok(c)) arr.push(c)
}

/** "$9.20 a pound" -> per cwt and per kg; "$920 cwt" -> per lb. */
export function conversionCard(text: string): Card | null {
  const m = text.match(/\$?\s?(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:dollars?\s?)?(?:a|per|\/)\s?(pound|lb|hundredweight|cwt|kilo|kg)\b/i)
  if (!m) return null
  const v = Number(m[1].replace(',', '.'))
  if (!(v > 0)) return null
  const unit = m[2].toLowerCase()
  let lb: number
  if (unit === 'pound' || unit === 'lb') lb = v
  else if (unit === 'kilo' || unit === 'kg') lb = v / 2.20462
  else lb = v / 100
  const body = [`${money(lb)}/lb`, `${money(lb * 100)}/cwt`, `${money(lb * 2.20462)}/kg`, `40k lb load ${money(lb * 40000, 0)}`].join('\n')
  return { kind: 'info', key: `conv:${lb.toFixed(2)}`, title: 'Conversion', glass: `CONVERT ${m[0].trim()}\n${body}`, phone: body, at: Date.now() }
}
