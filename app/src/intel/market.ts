// Market data access, conversions and card formatting.
import type { BeefData, Cut, MarketData, NewsData, RetailBrief, Settings } from '../types'
import type { Store } from '../store'
import { CUTS, lexFor } from './lexicon'

export interface MarketBundle {
  beef: BeefData | null
  market: MarketData | null
  news: NewsData | null
  retail?: RetailBrief | null
  loadedAt: number
  from: string
}

const LOAD_LB = 40_000 // USDA: one load equals 40,000 pounds

export async function loadMarket(store: Store, settings: Settings): Promise<MarketBundle> {
  const bases = [settings.dataBaseUrl, import.meta.env.VITE_DATA_BASE_URL as string | undefined, './data/']
    .filter((b): b is string => !!b)
    .map(b => (b.endsWith('/') ? b : b + '/'))
  for (const base of bases) {
    try {
      const bust = `?t=${Math.floor(Date.now() / 300000)}`
      const [beef, market, news, retail] = await Promise.all([
        fetchJson<BeefData>(base + 'beef.json' + bust),
        fetchJson<MarketData>(base + 'market.json' + bust).catch(() => null),
        fetchJson<NewsData>(base + 'news.json' + bust).catch(() => null),
        fetchJson<RetailBrief>(base + 'retail-brief.json' + bust).catch(() => null),
      ])
      const bundle: MarketBundle = { beef, market, news, retail, loadedAt: Date.now(), from: base }
      void store.set('cache:market', bundle)
      return bundle
    } catch { /* try next */ }
  }
  const cached = await store.get<MarketBundle | null>('cache:market', null)
  if (cached) return { ...cached, from: 'offline cache' }
  return { beef: null, market: null, news: null, loadedAt: 0, from: 'none' }
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    return (await r.json()) as T
  } finally { clearTimeout(t) }
}

// ---------- lookups ----------

/** Best row for an IMPS code and grade: the one with the most volume that traded. */
export function cutRows(beef: BeefData | null, imps: string, grade?: string): Cut[] {
  if (!beef) return []
  return beef.cuts
    .filter(c => c.imps === imps && (!grade || c.grade === grade))
    .sort((a, b) => (b.lbs ?? 0) - (a.lbs ?? 0))
}

export function bestRow(beef: BeefData | null, imps: string, grade: string): Cut | null {
  const rows = cutRows(beef, imps, grade)
  return rows.find(r => (r.wavg ?? 0) > 0) || rows[0] || null
}

// ---------- formatting ----------
export const perLb = (cwt: number | null | undefined) => (cwt == null ? null : cwt / 100)
export const money = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
export const pct = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null || !b ? null : ((a - b) / b) * 100
export const arrow = (p: number | null) => (p == null ? '' : p > 0.05 ? '▲' : p < -0.05 ? '▼' : '=')
export const fmtPct = (p: number | null) => (p == null ? '' : `${arrow(p)}${Math.abs(p).toFixed(1)}%`)
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
export const shortDate = (iso?: string | null) => {
  if (!iso) return '?'
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

export interface Card {
  kind: 'price' | 'cutout' | 'kill' | 'cattle' | 'ground' | 'mine' | 'tip' | 'customer' | 'news' | 'info'
  key: string
  title: string
  /** Text for the glasses panel (kept short) */
  glass: string
  /** Fuller text for the phone */
  phone: string
  at: number
}

export function trendWord(p: number | null): 'up' | 'down' | 'flat' {
  if (p == null) return 'flat'
  return p > 1 ? 'up' : p < -1 ? 'down' : 'flat'
}

/** Questions to ask, based on the market move, season and product. */
export function questionsFor(imps: string, movePct: number | null, month = new Date().getMonth() + 1, spread?: number): string[] {
  const lex = lexFor(imps)
  const q: string[] = []
  const t = trendWord(movePct)
  if (t === 'up') q.push('Market is firming. Want to lock volume for the next few weeks?')
  if (t === 'down') q.push('It has softened. Good window to feature it or add volume?')
  if (t === 'flat') q.push("What's your weekly movement on it right now?")
  const p = lex?.primal
  const holiday = month >= 10 || month === 1
  const grilling = month >= 3 && month <= 8
  if (holiday && (imps === '109E' || imps === '112A' || imps === '189A' || imps === '174'))
    q.push('Are your holiday rib/tenderloin features booked yet?')
  if (grilling && ['180', '112A', '185C', '185A', '193', '184', '184B', '116G'].includes(imps))
    q.push('Grilling ads set for the next few weeks?')
  if ((month >= 11 || month <= 2) && (p === 'Brisket' || imps === '116A' || imps === '114' || imps === '168' || imps === '171C'))
    q.push('Planning roast or braise features this winter?')
  if (spread != null && spread > 12 && (p === 'Loin' || p === 'Rib')) q.push(`Choice/Select spread is $${spread.toFixed(0)}. Would Select fit that program?`)
  q.push('Fresh or frozen? Choice, Select or a branded program?')
  return q.slice(0, 3)
}

export function priceCard(b: MarketBundle, s: Settings, imps: string, gradeHint?: string): Card | null {
  const beef = b.beef
  const lex = lexFor(imps)
  if (!beef || !lex) return null
  const grade = gradeHint || s.defaultGrade
  const row = bestRow(beef, imps, grade) || bestRow(beef, imps, grade === 'Choice' ? 'Select' : 'Choice')
  if (!row) return null
  const other = bestRow(beef, imps, row.grade === 'Choice' ? 'Select' : 'Choice')
  const live = (row.wavg ?? 0) > 0
  const price = live ? row.wavg : row.prev ?? null
  const dd = live ? pct(row.wavg, row.prev) : null
  const v5 = live ? pct(row.wavg, row.avg5) : null
  const lb = perLb(price)
  const caseLb = s.caseWeights[imps]
  const lines: string[] = []
  lines.push(`${lex.label.toUpperCase()} ${imps}`)
  lines.push(`${row.grade} · USDA ${shortDate(beef.reportDate)}`)
  if (lb != null) lines.push(`${money(lb)}/lb${!live ? `  (last trade ${shortDate(row.prevDate)})` : dd != null ? `  ${fmtPct(dd)} d/d` : ''}`)
  if (live && row.low != null && row.high != null) lines.push(`rng ${money(perLb(row.low))}–${money(perLb(row.high))}`)
  if (row.avg5 && live && (row.days ?? 0) >= 3) lines.push(`5d avg ${money(perLb(row.avg5))} ${fmtPct(v5)}`)
  if (other && (other.wavg ?? 0) > 0) lines.push(`${other.grade.slice(0, 3)} ${money(perLb(other.wavg))}/lb`)
  if (caseLb && lb != null) lines.push(`Case ${caseLb}lb ≈ ${money(lb * caseLb, 0)}`)
  const qs = questionsFor(imps, (row.days ?? 0) >= 3 ? v5 : dd, undefined, beef.cutout.spread)
  const glass = [...lines, `? ${qs[0]}`].join('\n')
  const phone = [
    ...lines,
    price != null ? `= ${money(price)}/cwt · ${money(lb != null ? lb * 2.20462 : null)}/kg` : '',
    lb != null ? `Load (${LOAD_LB.toLocaleString()} lb) ≈ ${money(lb * LOAD_LB, 0)}` : '',
    live ? `${row.trades ?? 0} trades · ${(row.lbs ?? 0).toLocaleString()} lb` : '',
    row.avg20 && (row.days ?? 0) >= 10 ? `20-day avg ${money(perLb(row.avg20))}/lb` : '',
    '',
    'Questions to ask:',
    ...qs.map(x => `• ${x}`),
  ].filter(x => x !== '').join('\n')
  return { kind: 'price', key: `price:${imps}:${row.grade}`, title: lex.label, glass, phone, at: Date.now() }
}

export function cutoutCard(b: MarketBundle): Card | null {
  const c = b.beef?.cutout
  if (!c?.choice) return null
  const lines = [
    `CUTOUT ${shortDate(b.beef!.reportDate)}`,
    `Choice ${c.choice.toFixed(2)} ${c.choiceChg != null ? arrow(c.choiceChg) + Math.abs(c.choiceChg).toFixed(2) : ''}`,
    `Select ${c.select?.toFixed(2) ?? '—'} ${c.selectChg != null ? arrow(c.selectChg) + Math.abs(c.selectChg).toFixed(2) : ''}`,
    `Spread ${c.spread?.toFixed(2) ?? '—'} · ${c.loads ?? '?'} loads`,
  ]
  if (c.avg5Choice) lines.push(`5d avg Ch ${c.avg5Choice.toFixed(2)}`)
  const primals = (b.beef!.primals || []).map(p => `${p.name} ${p.choice?.toFixed(0) ?? '—'}/${p.select?.toFixed(0) ?? '—'}`)
  return {
    kind: 'cutout', key: 'cutout', title: 'Boxed beef cutout',
    glass: lines.join('\n'),
    phone: [...lines, '(USD per 100 lb)', '', 'Primals Choice/Select:', ...primals].join('\n'),
    at: Date.now(),
  }
}

export function killCard(b: MarketBundle): Card | null {
  const s = b.market?.slaughter
  const c = s?.cattle
  if (!c) return null
  const vsLy = pct(c.wtd, c.lyWtd)
  const lines = [
    `CATTLE KILL ${shortDate(s!.reportDate)}${s!.status === 'estimate' ? ' est' : ''}`,
    `Today ${c.today.toLocaleString()}`,
    `Wk ago ${k(c.weekAgo)} · Yr ago ${k(c.yearAgo)}`,
    `WTD ${k(c.wtd)} ${fmtPct(vsLy)} vs LY`,
    `YTD ${k(c.ytd)} ${c.ytdPct > 0 ? '▲' : '▼'}${Math.abs(c.ytdPct)}%`,
  ]
  return { kind: 'kill', key: 'kill', title: 'Cattle slaughter', glass: lines.join('\n'), phone: lines.join('\n'), at: Date.now() }
}

export function cattleCard(b: MarketBundle): Card | null {
  const f = b.market?.fedCattle
  if (!f?.rows?.length) return null
  const pickRow = (cls: RegExp, basis: RegExp) => f.rows.filter(r => cls.test(r.cls) && basis.test(r.basis)).sort((a, z) => (z.head ?? 0) - (a.head ?? 0))[0]
  const live = pickRow(/steer/i, /live/i)
  const dressed = pickRow(/steer/i, /dressed/i)
  const lines = [`FED CATTLE 5-area ${shortDate(f.reportDate)}`]
  if (live) lines.push(`Live steer ${money(live.price)}/cwt${live.weight ? ` · ${Math.round(live.weight)}lb` : ''}`)
  if (dressed) lines.push(`Dressed ${money(dressed.price)}/cwt${dressed.weight ? ` · ${Math.round(dressed.weight)}lb` : ''}`)
  if (lines.length === 1) {
    const r = f.rows[0]
    lines.push(`${r.cls} ${r.basis} ${money(r.price)}`)
  }
  return { kind: 'cattle', key: 'cattle', title: 'Fed cattle', glass: lines.join('\n'), phone: lines.join('\n'), at: Date.now() }
}

export function groundCard(b: MarketBundle, text: string): Card | null {
  const beef = b.beef
  if (!beef) return null
  const rows = [...(beef.ground || []).map(g => ({ ...g, src: 'GB' })), ...(beef.trim || []).map(t => ({ ...t, src: 'Trim' }))]
  if (!rows.length) return null
  const m = text.match(/\b(50|65|73|75|80|81|85|90|93|95)\s*(s|%|percent|\/\d+|'s)?\b/i)
  const lean = m?.[1]
  const sel = rows.filter(r => (lean ? r.desc.includes(lean) : true) && (r.wavg ?? 0) > 0).slice(0, 4)
  if (!sel.length) return null
  const lines = [`GRIND/TRIM ${shortDate(beef.reportDate)}`, ...sel.map(r => `${r.desc.slice(0, 22)} ${money(perLb(r.wavg))}`)]
  return { kind: 'ground', key: `ground:${lean ?? 'all'}`, title: 'Ground beef & trim', glass: lines.join('\n'), phone: lines.join('\n'), at: Date.now() }
}

/** Compact multi-page market brief for the glasses Market screen. */
export function marketPages(b: MarketBundle, s: Settings): string[] {
  const pages: string[] = []
  const co = cutoutCard(b)
  if (co) pages.push(co.phone)
  const kill = killCard(b)
  const cat = cattleCard(b)
  if (kill || cat) pages.push([kill?.glass, cat?.glass].filter(Boolean).join('\n\n'))
  if (b.beef) {
    const rows = CUTS.map(c => bestRow(b.beef, c.imps, s.defaultGrade)).filter((r): r is Cut => !!r && (r.wavg ?? 0) > 0)
    const fmt = (r: Cut) => `${r.imps.padEnd(5)} ${lexFor(r.imps)!.label.slice(0, 16).padEnd(16)} ${money(perLb(r.wavg))} ${fmtPct(pct(r.wavg, r.prev))}`
    for (let i = 0; i < rows.length; i += 8) {
      pages.push([`${s.defaultGrade} cuts $/lb · ${shortDate(b.beef.reportDate)}`, ...rows.slice(i, i + 8).map(fmt)].join('\n'))
    }
    const movers = rows.filter(r => r.prev).map(r => ({ r, p: pct(r.wavg, r.prev)! })).sort((a, z) => Math.abs(z.p) - Math.abs(a.p)).slice(0, 7)
    if (movers.length) pages.splice(1, 0, ['BIGGEST MOVERS d/d', ...movers.map(({ r, p }) => `${lexFor(r.imps)!.label.slice(0, 18)} ${fmtPct(p)} ${money(perLb(r.wavg))}`)].join('\n'))
  }
  const rc = retailCard(b, '', 8)
  if (rc) pages.push(rc.glass)
  if (!pages.length) pages.push('No market data yet.\nOpen the phone app > Settings\nto check the data link.')
  return pages
}

/** US grocery ad prices (USDA weekly retail feature report) matching words in the text. */
export function retailCard(b: MarketBundle, text: string, max = 5): Card | null {
  const r = b.market?.retail
  if (!r?.items?.length) return null
  const t = text.toLowerCase()
  const want: RegExp[] = []
  if (/ground|grind|hamburger|burger|chub|patt/.test(t)) want.push(/ground/i)
  if (/strip|new york|ny strip/.test(t)) want.push(/strip/i)
  if (/rib ?eye|ribeye|rib roast|prime rib/.test(t)) want.push(/rib ?eye|rib roast/i)
  if (/tenderloin|filet|fillet/.test(t)) want.push(/tenderloin|filet/i)
  if (/sirloin|top butt/.test(t)) want.push(/sirloin/i)
  if (/brisket/.test(t)) want.push(/brisket/i)
  if (/chuck|roast/.test(t)) want.push(/chuck/i)
  if (/round|london broil/.test(t)) want.push(/round|london/i)
  if (/flank|skirt|flap/.test(t)) want.push(/flank|skirt|flap/i)
  if (/short rib/.test(t)) want.push(/short rib/i)
  const rows = r.items
    .filter(i => i.price != null && (want.length ? want.some(w => w.test(i.item)) : true) && /conventional/i.test(i.env))
    .sort((a, z) => (z.stores ?? 0) - (a.stores ?? 0))
    .slice(0, max)
  if (!rows.length) return null
  const fr = r.summary?.feature_rate
  const lines = [
    `RETAIL ADS wk of ${shortDate(r.reportDate)}`,
    ...rows.map(i => `${i.item.slice(0, 24)} ${money(i.price)}${i.pyPrice ? ` ${fmtPct(pct(i.price, i.pyPrice))} y/y` : ''}`),
  ]
  if (fr?.cw != null) lines.push(`Feature rate ${fr.cw}%${fr.pw != null ? ` (prev ${fr.pw}%)` : ''}`)
  return { kind: 'info', key: `retail:${want.map(w => w.source).join(',') || 'all'}`, title: 'US retail beef ads', glass: lines.join('\n'), phone: [...lines, '', '$/lb, weighted average advertised price, USDA AMS weekly retail feature report. y/y = vs same week last year.'].join('\n'), at: Date.now() }
}
