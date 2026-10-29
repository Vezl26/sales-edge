// Knowledge base: customers, uploaded docs (your numbers, price lists, notes).
// Everything lives only on the phone (Even app storage) — never in the public repo.
import type { Customer, KnowledgeDoc, NewsItem, Call } from '../types'
import type { Store } from '../store'

import type { Prep } from '../prep/prep'

export interface KB { customers: Customer[]; docs: KnowledgeDoc[]; preps?: Prep[] }

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export async function loadKB(store: Store): Promise<KB> {
  return store.get<KB>('kb', { customers: [], docs: [] })
}
export async function saveKB(store: Store, kb: KB) { await store.set('kb', kb) }

// ---------- CSV / TSV ----------
export function parseDelimited(text: string): { headers: string[]; rows: string[][] } | null {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim())
  if (lines.length < 2) return null
  const delim = (lines[0].match(/\t/g)?.length ?? 0) > 0 ? '\t' : (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const split = (l: string) => {
    const out: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (ch === delim && !q) { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }
  const headers = split(lines[0])
  if (headers.length < 2) return null
  const rows = lines.slice(1).map(split).filter(r => r.some(c => c))
  return { headers, rows }
}

const normName = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Import customers from a CSV with columns like Customer, Item, Volume, Price, Notes, Contact. */
export function importCustomersCsv(kb: KB, text: string): number {
  const t = parseDelimited(text)
  if (!t) return 0
  const h = t.headers.map(x => x.toLowerCase())
  const col = (...names: RegExp[]) => h.findIndex(x => names.some(n => n.test(x)))
  const cName = col(/customer|account|company|store|name/)
  if (cName < 0) return 0
  const cItem = col(/item|product|sku|cut|description/)
  const cVol = col(/vol|lbs|pounds|cases|qty|quantity|weekly/)
  const cPrice = col(/price|\$|cost|fob/)
  const cNotes = col(/note|comment/)
  const cContact = col(/contact|buyer|phone|email/)
  const cSeg = col(/segment|channel|type/)
  let n = 0
  for (const r of t.rows) {
    const name = r[cName]?.trim()
    if (!name) continue
    let c = kb.customers.find(x => normName(x.name) === normName(name))
    if (!c) {
      c = { id: uid(), name, aliases: [], items: [], notes: '', learned: [], updatedAt: Date.now() }
      kb.customers.push(c); n++
    }
    if (cContact >= 0 && r[cContact]) c.contact = r[cContact]
    if (cSeg >= 0 && r[cSeg]) c.segment = r[cSeg]
    if (cNotes >= 0 && r[cNotes] && !c.notes.includes(r[cNotes])) c.notes = (c.notes ? c.notes + '\n' : '') + r[cNotes]
    if (cItem >= 0 && r[cItem]) {
      const existing = c.items.find(i => normName(i.name) === normName(r[cItem]))
      const item = existing || { name: r[cItem] }
      if (cVol >= 0 && r[cVol]) item.volume = r[cVol]
      if (cPrice >= 0 && r[cPrice]) item.price = r[cPrice]
      if (!existing) c.items.push(item)
    }
    c.updatedAt = Date.now()
  }
  return n
}

// ---------- matching in live transcript ----------
export function findCustomerMention(kb: KB, text: string): Customer | null {
  const t = ' ' + normName(text) + ' '
  let best: { c: Customer; len: number } | null = null
  for (const c of kb.customers) {
    for (const n of [c.name, ...c.aliases]) {
      const nn = normName(n)
      if (nn.length < 3) continue
      if (t.includes(' ' + nn + ' ') && (!best || nn.length > best.len)) best = { c, len: nn.length }
    }
  }
  return best?.c ?? null
}

export interface PriceListHit { doc: KnowledgeDoc; row: string[]; name: string }

/** Find items from YOUR uploaded price lists (deli, chocolate, prepared foods...) mentioned in text. */
export function findPriceListItems(kb: KB, text: string): PriceListHit[] {
  const t = ' ' + normName(text) + ' '
  const hits: PriceListHit[] = []
  for (const doc of kb.docs) {
    if (!doc.table || (doc.kind !== 'pricing' && doc.kind !== 'numbers')) continue
    const nameCol = guessNameColumn(doc.table)
    for (const row of doc.table.rows) {
      const name = row[nameCol]
      if (!name) continue
      const nn = normName(name)
      if (nn.length < 4) continue
      // exact phrase, or all significant words (>=2 of them) present
      const words = nn.split(' ').filter(w => w.length > 2 && !STOP.has(w))
      const phrase = t.includes(' ' + nn + ' ')
      const allWords = words.length >= 2 && words.every(w => t.includes(' ' + w + ' '))
      if (phrase || allWords) hits.push({ doc, row, name })
    }
  }
  return hits.slice(0, 3)
}
const STOP = new Set(['the', 'and', 'with', 'lbs', 'case', 'pack', 'fresh', 'frozen', 'each', 'per', 'bulk'])

export function guessNameColumn(table: { headers: string[]; rows: string[][] }): number {
  const h = table.headers.map(x => x.toLowerCase())
  const byName = h.findIndex(x => /item|product|description|name|sku desc/.test(x))
  if (byName >= 0) return byName
  // first column that is mostly non-numeric
  for (let i = 0; i < h.length; i++) {
    const vals = table.rows.slice(0, 20).map(r => r[i] || '')
    if (vals.filter(v => /[a-z]{3}/i.test(v)).length > vals.length / 2) return i
  }
  return 0
}

export function formatRow(table: { headers: string[] }, row: string[]): string {
  return table.headers.map((h, i) => (row[i] ? `${h}: ${row[i]}` : '')).filter(Boolean).join(' · ')
}

// ---------- talking points ----------
export function customerTalkingPoints(c: Customer, calls: Call[], news: NewsItem[]): string[] {
  const pts: string[] = []
  const mine = calls.filter(x => x.customerId === c.id).sort((a, b) => b.startedAt - a.startedAt)
  const last = mine[0]
  if (last?.summary) {
    const open = last.summary.followUps.filter(f => !f.done)
    for (const f of open.slice(0, 2)) pts.push(`Follow up: ${f.text}${f.due ? ` (${f.due})` : ''}`)
    if (last.summary.customerNeeds[0]) pts.push(`Last time they needed: ${last.summary.customerNeeds[0]}`)
  }
  for (const l of c.learned.slice(-2)) pts.push(l)
  const words = c.items.flatMap(i => normName(i.name).split(' ')).filter(w => w.length > 4)
  const n = news.find(it => words.some(w => normName(it.title).includes(w)))
  if (n) pts.push(`News: ${n.title}`)
  if (c.notes) pts.push(c.notes.split('\n')[0])
  return pts.slice(0, 5)
}

/** Simple roll-up of a "numbers" table so talking points can cite it. */
export function numbersDigest(doc: KnowledgeDoc): string[] {
  const t = doc.table
  if (!t) return doc.text.split('\n').filter(l => /\d/.test(l)).slice(0, 8)
  const h = t.headers.map(x => x.toLowerCase())
  const nameCol = h.findIndex(x => /customer|account|item|product|name|month|period/.test(x))
  const numCols = t.headers.map((_, i) => i).filter(i => i !== nameCol && t.rows.filter(r => /^-?[$\d,.%()]+$/.test((r[i] || '').trim())).length > t.rows.length * 0.6)
  const val = (s: string) => Number(String(s).replace(/[$,%()\s]/g, '')) * (/^\(.*\)$/.test(s.trim()) ? -1 : 1)
  const out: string[] = []
  for (const ci of numCols.slice(0, 3)) {
    const total = t.rows.reduce((a, r) => a + (val(r[ci] || '0') || 0), 0)
    out.push(`${t.headers[ci]} total: ${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
    if (nameCol >= 0) {
      const top = [...t.rows].sort((a, b) => (val(b[ci] || '0') || 0) - (val(a[ci] || '0') || 0)).slice(0, 3)
      out.push(`Top by ${t.headers[ci]}: ${top.map(r => `${r[nameCol]} ${(val(r[ci]) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`).join(', ')}`)
    }
  }
  return out
}

/** Pull the key points out of a long prose report (e.g. a weekly market outlook PDF). */
export function reportHighlights(text: string, max = 8): string[] {
  const flat = text.replace(/\r/g, '')
  // 1) Executive-summary bullets with CAPS labels: "• CATTLE PRICES (link): ..."
  const bullets = flat.split(/\n?\s*[•▪●]\s+/).slice(1)
    .map(b => b.replace(/\s*\n\s*/g, ' ').trim())
    .filter(b => /^[A-Z][A-Z0-9 ,&/-]{3,}(\s*\([^)]*\))?\s*:/.test(b))
  if (bullets.length >= 2) {
    return bullets.slice(0, max).map(b => {
      const m = b.match(/^([A-Z][A-Z0-9 ,&/-]{3,})(?:\s*\([^)]*\))?\s*:\s*(.+)$/)!
      const label = m[1].trim().replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase())
      const body = m[2].split(/(?<=[.!?])\s+/).slice(0, 2).join(' ')
      return `${label}: ${body}`.slice(0, 320)
    })
  }
  // 2) Otherwise: sentences that carry numbers
  return flat.replace(/\s*\n\s*/g, ' ').split(/(?<=[.!?])\s+/)
    .filter(x => /\d/.test(x) && x.length > 40 && x.length < 300).slice(0, max)
}
