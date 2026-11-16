// Teleprompter + Conversate-style assist.
// - Prompter: the prep becomes a script; points get checked off as they're talked about.
// - Reference search: when talk drifts off the prep, find the best matching lines in your documents.
import type { Prep } from './prep'
import type { KB } from '../kb/knowledge'

const STOP = new Set(('the and for are but not you your our with that this have has had was were will would could should about from they them their there what when where which who how why been being into than then also just like know yeah okay right well really very some more most much many want need get got make made going think thing things time week weeks year last next good great sure lot can its it\'s i\'m we\'re don\'t that\'s let\'s here pretty kind able look looking said says say tell told call').split(' '))

export const keywords = (t: string): string[] =>
  [...new Set(t.toLowerCase().replace(/[^a-z0-9/%° ]+/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)).map(stem))]
const stem = (w: string) => w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '')

interface Point { section: string; text: string; words: string[]; covered: boolean }

export class Prompter {
  points: Point[] = []
  goal = ''
  idx = 0
  constructor(public prep: Prep) {
    let section = ''
    for (const line of prep.notes.split('\n')) {
      const h = line.match(/^#{1,3}\s+(.+)/)
      if (h) { section = h[1].trim(); continue }
      const t = line.trim().replace(/^[-*•]\s*/, '')
      if (!t || /^\(.*\)$/.test(t) || /^source:/i.test(t)) continue
      if (/^goal$/i.test(section)) { this.goal ||= t; continue }
      this.points.push({ section, text: t, words: keywords(t), covered: false })
    }
  }

  get done() { return this.points.filter(p => p.covered).length }

  /** Words of the prep — used to tell on-topic talk from drift. */
  vocab(): Set<string> { return new Set(this.points.flatMap(p => p.words)) }

  /** Check off points that were just talked about. Returns how many got checked.
   *  The cursor only moves when the point you're on gets covered, so the screen never jumps ahead. */
  ingest(text: string): number {
    const said = new Set(keywords(text))
    let n = 0
    for (const p of this.points) {
      if (p.covered || p.words.length === 0) continue
      const hit = p.words.filter(w => said.has(w)).length
      const need = p.words.length <= 3 ? Math.max(1, p.words.length - 1) : Math.max(2, Math.ceil(p.words.length * 0.4))
      if (hit >= need) { p.covered = true; n++ }
    }
    if (n && this.points[this.idx]?.covered) this.moveToNextOpen()
    return n
  }

  private moveToNextOpen() {
    const next = this.points.findIndex((p, i) => i > this.idx && !p.covered)
    if (next >= 0) this.idx = next
  }

  /** Ring swipe: down = done, go to the next point in order. Up = back one. */
  step(d: 1 | -1) {
    if (!this.points.length) return
    if (d === 1) {
      this.points[this.idx].covered = true
      if (this.idx < this.points.length - 1) this.idx++
    } else this.idx = Math.max(0, this.idx - 1)
  }

  /** Section names in order (each "## heading" = one slide or topic). */
  sections(): string[] { return [...new Set(this.points.map(p => p.section))] }

  /** Glasses view: the slide/section you're on, its points in order, the current one marked. */
  view(maxChars = 300, maxLines = 6): string {
    if (!this.points.length) return 'Prep is empty.'
    const cur = this.points[this.idx]
    const secs = this.sections()
    const si = secs.indexOf(cur.section)
    const inSec = this.points.filter(p => p.section === cur.section)
    const pos = inSec.indexOf(cur)
    const head = `${(cur.section || 'Prep').toUpperCase().slice(0, 34)}   ${si + 1}/${secs.length}`
    const lines = [head]
    // One finished line above for context, then the current one, then what's left in this section.
    for (const p of inSec.slice(Math.max(0, pos - 1))) {
      const mark = p === cur ? '▶ ' : p.covered ? '✓ ' : '   '
      const l = mark + p.text
      if (p !== cur && (lines.length >= maxLines || (lines.join('\n') + '\n' + l).length > maxChars)) break
      lines.push(l)
    }
    const last = inSec[inSec.length - 1]
    const shownAll = lines[lines.length - 1].endsWith(last.text)
    if (shownAll && secs[si + 1]) {
      const nx = `Next: ${secs[si + 1]}`
      if (lines.length <= maxLines - 2) lines.push('', nx)
      else if (lines.length <= maxLines - 1) lines.push(nx)
    }
    return lines.join('\n')
  }

  uncovered(): string[] {
    return this.points.filter(p => !p.covered).map(p => `${p.section}: ${p.text}`)
  }
}

// ---------- reference search over your documents ----------
interface Sent { doc: string; text: string; words: string[] }
const cache = new Map<string, Sent[]>()
let dfCache: { key: string; all: Sent[]; df: Map<string, number> } | null = null

function sentencesOf(kb: KB): Sent[] {
  const out: Sent[] = []
  for (const d of kb.docs) {
    const key = `${d.id}:${d.addedAt}`
    let s = cache.get(key)
    if (!s) {
      const lines = d.table
        ? d.table.rows.map(r => d.table!.headers.map((h, i) => (r[i] ? `${h}: ${r[i]}` : '')).filter(Boolean).join(', '))
        : d.text.replace(/([^.!?:\n])\n(?=[a-z(])/g, '$1 ').split(/\n+|(?<=[.!?])\s+/)
      s = lines.map(x => x.trim()).filter(x => x.length > 25 && x.length < 400 && (x.match(/[a-z]/gi)?.length ?? 0) > x.length * 0.5)
        .map(text => ({ doc: d.title, text, words: keywords(text) }))
      cache.set(key, s)
    }
    out.push(...s)
  }
  return out
}

/** Best matching lines from your docs for what was just said. */
export function searchDocs(kb: KB, text: string, avoid?: Set<string>, max = 3): { doc: string; text: string; score: number }[] {
  const q = keywords(text).filter(w => !avoid?.has(w))
  if (q.length < 2) return []
  const key = kb.docs.map(d => `${d.id}:${d.addedAt}:${d.text.length}`).join('|')
  if (!dfCache || dfCache.key !== key) {
    const all = sentencesOf(kb)
    const df = new Map<string, number>()
    for (const s of all) for (const w of new Set(s.words)) df.set(w, (df.get(w) ?? 0) + 1)
    dfCache = { key, all, df }
  }
  const { all, df } = dfCache
  const scored = all.map(s => {
    const hits = q.filter(w => s.words.includes(w))
    const score = hits.reduce((a, w) => a + 1 / Math.log2(1 + (df.get(w) ?? 1)), 0)
    return { doc: s.doc, text: s.text, score, n: hits.length }
  }).filter(x => x.n >= 2 && x.score >= 1.2).sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  return scored.filter(x => (seen.has(x.text) ? false : (seen.add(x.text), true))).slice(0, max)
}

/** How much of what was said is about the prep (0..1). */
export function onPrepShare(text: string, vocab: Set<string>): number {
  const w = keywords(text)
  if (!w.length) return 1
  return w.filter(x => vocab.has(x)).length / w.length
}
