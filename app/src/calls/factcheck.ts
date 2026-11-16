// After the call: what you actually said to each question, and any number you said that the data disagrees with.
import type { Call, QA } from '../types'
import type { MarketBundle } from '../intel/market'
import { bestRow, perLb } from '../intel/market'
import { findCuts, lexFor } from '../intel/lexicon'
import { keywords } from '../prep/prompter'

const NUM = /\$?\s?(\d{1,4}(?:[.,]\d{1,2})?)\s*(dollars?|bucks|cents|a pound|per pound|\/\s?lb|a lb|per lb|cwt|hundredweight)?/gi

/** Alan's words in the 45 seconds after each question. */
export function attachAnswers(call: Call): QA[] {
  return (call.qa ?? []).map(q => {
    const said = call.segments.filter(s => s.spk === 'A' && s.t >= q.t && s.t <= q.t + 45000).map(s => s.text).join(' ')
    return { ...q, alan: said ? said.split(/\s+/).slice(0, 45).join(' ') : undefined }
  })
}

/** Numbers you said about a cut or the cutout that are off from the data by more than a little. */
export function factCheck(call: Call, m: MarketBundle, grade: string): string[] {
  const out: string[] = []
  const date = m.beef?.reportDate ? m.beef.reportDate.slice(5).replace('-', '/') : 'latest'
  for (const s of call.segments.filter(x => x.spk === 'A')) {
    for (const sent of s.text.split(/(?<=[.!?])\s+/)) {
      const nums = [...sent.matchAll(NUM)].map(x => ({ v: Number(x[1].replace(',', '')), unit: (x[2] || '').toLowerCase(), raw: x[0].trim(), dollar: x[0].trim().startsWith('$') }))
        .filter(n => n.v > 0 && (n.dollar || !!n.unit || n.v < 1000))
      if (!nums.length) continue
      // Cutout: "Choice is at 360"
      const co = m.beef?.cutout
      if (/\b(cutout|choice|select)\b/i.test(sent) && co?.choice) {
        const isSel = /\bselect\b/i.test(sent) && !/\bchoice\b/i.test(sent)
        const real = isSel ? co.select : co.choice
        const n = nums.find(x => x.v >= 200 && x.v <= 600)
        if (real && n && Math.abs(n.v - real) / real > 0.02)
          out.push(`You said ${isSel ? 'Select' : 'Choice'} cutout ${n.raw}. USDA (${date}) had $${real.toFixed(2)}/cwt.`)
      }
      // A cut and a price in the same sentence
      const cut = findCuts(sent)[0]
      if (!cut) continue
      const r = bestRow(m.beef, cut.imps, grade)
      const lb = r?.wavg && r.wavg > 0 ? perLb(r.wavg)! : null
      if (!lb) continue
      for (const n of nums) {
        if (n.unit === 'cents') continue
        // $8.44 = per lb. $844 = per cwt. Anything else is probably not a price.
        const said = n.v >= 50 ? n.v / 100 : n.v
        if (said < 0.5 || said > 60) continue
        if (Math.abs(said - lb) / lb > 0.08) {
          out.push(`You said ${lexFor(cut.imps)?.label.toLowerCase() ?? cut.phrase} ${n.raw}. USDA (${date}) had ${r!.grade} at $${lb.toFixed(2)}/lb ($${(lb * 100).toFixed(0)}/cwt).`)
          break
        }
      }
    }
  }
  return [...new Set(out)].slice(0, 8)
}

// ---------- learning your answers ----------
export interface Learned { q: string; words: string[]; alan: string; at: number }

/** Your answer from a past call to a similar question (2+ shared key words). */
export function recallAnswer(list: Learned[], question: string): Learned | null {
  const w = keywords(question)
  let best: Learned | null = null
  let score = 1
  for (const l of list) {
    const n = l.words.filter(x => w.includes(x)).length
    if (n > score) { best = l; score = n }
  }
  return best
}

export function learnAnswers(list: Learned[], qa: QA[]): Learned[] {
  const add = qa.filter(q => q.alan && q.alan.split(' ').length >= 4).map(q => ({ q: q.q, words: keywords(q.q), alan: q.alan!, at: Date.now() }))
  return [...add, ...list].slice(0, 60)
}
