// Stock-ticker column for the lens: the cuts being talked about, with price and day-over-day move.
import type { BeefData } from '../types'
import { bestRow, perLb, pct, arrow } from './market'
import { lexFor } from './lexicon'

export interface Mention { n: number; last: number }

const SHORT: Record<string, string> = {
  '109E': 'Rib BI', '112A': 'Ribeye', '114': 'Clod', '114A': 'Clod', '114D': 'TopBlade', '114E': 'ArmRst', '114F': 'ClodTndr',
  '116A': 'ChkRoll', '116B': 'ChkTndr', '916A': 'ChkRoll', '116G': 'ChkFlap', '120': 'Brisket', '120A': 'BrsktFlt',
  '123A': 'PlateRib', '130': 'ShortRib', '161': 'Round', '167A': 'Knuckle', '168': 'TopRnd', '169': 'Inside', '169A': 'Inside',
  '170': 'Goosenk', '171B': 'OutsRnd', '171C': 'EyeRnd', '174': 'ShtLoin', '175': 'Strip BI', '180': 'Strip',
  '184': 'TopButt', '184B': 'TopButt', '185A': 'Flap', '185B': 'BallTip', '185C': 'TriTip', '185D': 'TriTip',
  '189A': 'Tender', '191A': 'ButtTndr', '193': 'Flank',
}
export const shortName = (imps: string) => SHORT[imps] ?? (lexFor(imps)?.label.split(/[\s-]/)[0] ?? imps).slice(0, 8)

const line = (name: string, price: number | null, chg: number | null) =>
  `${name} ${price == null ? '--' : price.toFixed(2)}${chg == null ? '' : ` ${arrow(chg)}${Math.abs(chg).toFixed(1)}`}`

/** Cutout on top, then the most-mentioned cuts (ties: most recent). Cuts stay once mentioned. */
export function tickerText(m: Map<string, Mention>, beef: BeefData | null, grade: string, rows = 7): string {
  const out: string[] = []
  const c = beef?.cutout
  if (c?.choice) out.push(line('Choice', c.choice, c.choiceChg != null ? pct(c.choice, c.choice - c.choiceChg) : null))
  const ranked = [...m.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last).slice(0, rows - out.length)
  for (const [imps] of ranked) {
    const r = bestRow(beef, imps, grade)
    const ok = !!r?.wavg && r.wavg > 0
    if (!ok && (r?.prev ?? 0) > 0) { out.push(`${shortName(imps)} ~${perLb(r!.prev)!.toFixed(2)}`); continue } // no trade today: last price
    out.push(line(shortName(imps), ok ? perLb(r!.wavg) : null, ok && (r!.prev ?? 0) > 0 ? pct(r!.wavg, r!.prev) : null))
  }
  return out.join('\n')
}
