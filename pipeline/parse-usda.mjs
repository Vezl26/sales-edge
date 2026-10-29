// Pure parsers for USDA reports. No I/O here, so they are unit-testable.
import { num, isoFromUs } from './lib.mjs'

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 }

export function findLongDate(text) {
  const m = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i)
  if (!m) return null
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const NUM = '\\(?-?[\\d,]+\\.\\d{2}\\)?'
const signed = s => {
  if (s == null) return null
  const neg = /^\(.*\)$/.test(s.trim()) || s.trim().startsWith('-')
  const v = num(s.replace(/[()]/g, ''))
  return v == null ? null : neg ? -Math.abs(v) : v
}

// Row tail: trades, pounds, low - high, weighted average  (or dashes)
const ROW_TAIL = new RegExp(
  `^(.*?)\\s+(\\d[\\d,]*|-)\\s+([\\d,]+|-)\\s+(?:([\\d,]+\\.\\d{2})\\s*-\\s*([\\d,]+\\.\\d{2})|-\\s*-?|-)\\s+([\\d,]+\\.\\d{2}|-)\\s*$`,
)

function splitHead(head) {
  head = head.trim()
  let m = head.match(/^(\d{3}[A-Z]?)\s+(\d)\s+(.+)$/)
  if (m) return { imps: m[1], fat: Number(m[2]), desc: m[3].trim() }
  m = head.match(/^(\d)\s+(.+)$/)
  if (m) return { imps: '', fat: Number(m[1]), desc: m[2].trim() }
  return { imps: '', fat: null, desc: head }
}

function sectionOf(line, current) {
  const l = line.toLowerCase()
  if (/choice,\s*select\s*&\s*ungraded/.test(l)) return 'Ungraded'
  if (/^\s*choice cuts/.test(l)) return 'Choice'
  if (/^\s*select cuts/.test(l)) return 'Select'
  if (/^\s*blended gb/.test(l)) return 'BlendedGB'
  if (/^\s*gb\s*-/.test(l)) return 'GB'
  if (/^\s*beef trimmings/.test(l)) return 'Trim'
  if (/^\s*branded/.test(l)) return 'Branded'
  if (/fat limitations \(fl\) description/.test(l)) return 'end'
  return current
}

/** Parse pdftotext -layout output of LM_XB403 (ams_2453.pdf). */
export function parseBoxedBeefText(text) {
  const out = {
    source: 'USDA AMS LM_XB403 (PDF)',
    reportDate: findLongDate(text),
    cutout: {}, primals: [], cuts: [], ground: [], trim: [], cutoutHistory: [], volume: {},
  }
  const lines = text.split(/\r?\n/)
  let section = null
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    let m = line.match(/^\s*(Choice Cuts|Select Cuts|Trimmings|Ground Beef)\s+([\d.]+)\s+loads\s+([\d,]+)\s+pounds/i)
    if (m) { out.volume[m[1].toLowerCase().replace(/\s+/g, '_')] = { loads: num(m[2]), lbs: num(m[3]) }; continue }
    const s = sectionOf(line, section)
    if (s !== section) { section = s; continue }

    if ((m = line.match(new RegExp(`Current Cutout Values:?\\s+(${NUM})\\s+(${NUM})`, 'i')))) {
      out.cutout.choice = signed(m[1]); out.cutout.select = signed(m[2]); continue
    }
    if ((m = line.match(new RegExp(`Change from prior day:?\\s+(${NUM})\\s+(${NUM})`, 'i')))) {
      out.cutout.choiceChg = signed(m[1]); out.cutout.selectChg = signed(m[2]); continue
    }
    if ((m = line.match(new RegExp(`Choice/Select spread:?\\s+(${NUM})`, 'i')))) {
      out.cutout.spread = signed(m[1]); continue
    }
    if ((m = line.match(/Total Load Count[^:]*:?\s+([\d,.]+)/i))) {
      out.cutout.loads = num(m[1]); continue
    }
    if (/Composite Primal Values/i.test(line)) continue
    if ((m = line.match(new RegExp(`^\\s*(?:Primal\\s+)?(Rib|Chuck|Round|Loin|Brisket|Short Plate|Flank)\\s+(${NUM})\\s+(${NUM})\\s*$`, 'i')))) {
      out.primals.push({ name: titleCase(m[1]), choice: signed(m[2]), select: signed(m[3]) }); continue
    }
    if ((m = line.match(/^\s*(\d{2}\/\d{2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/))) {
      out.cutoutHistory.push({ md: m[1], loads: num(m[6]), choice: num(m[7]), select: num(m[8]) }); continue
    }
    if (!section || section === 'end') continue
    m = line.match(ROW_TAIL)
    if (!m) continue
    const head = splitHead(m[1])
    if (!head.desc || /^(item description|imps|fl\b)/i.test(head.desc)) continue
    const row = {
      imps: head.imps, fat: head.fat, desc: head.desc,
      trades: num(m[2]), lbs: num(m[3]), low: num(m[4]), high: num(m[5]), wavg: num(m[6]),
    }
    if (section === 'Choice' || section === 'Select' || section === 'Ungraded' || section === 'Branded') {
      out.cuts.push({ grade: section, ...row })
    } else if (section === 'GB' || section === 'BlendedGB') {
      out.ground.push({ type: section === 'GB' ? 'Steer/Heifer' : 'Blended', ...row })
    } else if (section === 'Trim') {
      out.trim.push(row)
    }
  }
  return out
}

const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

// ---------- Datamart JSON (mpr.datamart.ams.usda.gov) ----------
// The exact field names are not documented in the user guide, so this walks the
// payload and picks fields by name pattern. Raw payloads are archived so the
// mapping can be tightened later.

function collectRows(node, sectionName, acc) {
  if (Array.isArray(node)) {
    for (const n of node) collectRows(n, sectionName, acc)
    return acc
  }
  if (node && typeof node === 'object') {
    const sec = node.reportSection || node.report_section || node.section || node.sectionName || sectionName
    if (Array.isArray(node.results)) {
      for (const r of node.results) acc.push({ section: sec || '', row: r })
      return acc
    }
    const looksRow = Object.keys(node).some(k => /report_date|item_description|weighted_average|price/i.test(k)) &&
      !Object.values(node).some(v => Array.isArray(v))
    if (looksRow) { acc.push({ section: sec || '', row: node }); return acc }
    for (const v of Object.values(node)) if (v && typeof v === 'object') collectRows(v, sec, acc)
  }
  return acc
}

const pick = (row, ...patterns) => {
  for (const p of patterns) {
    const k = Object.keys(row).find(k => p.test(k))
    if (k !== undefined && row[k] !== null && row[k] !== '') return row[k]
  }
  return undefined
}

export function normalizeBoxedBeefDatamart(json) {
  const rows = collectRows(json, '', [])
  const out = {
    source: 'USDA AMS LM_XB403 (Datamart)', reportDate: null,
    cutout: {}, primals: [], cuts: [], ground: [], trim: [], cutoutHistory: [], volume: {},
  }
  for (const { section, row } of rows) {
    const sec = String(section || pick(row, /section/i) || '').toLowerCase()
    const date = pick(row, /^report_date$/i, /report_date/i)
    if (date && !out.reportDate) out.reportDate = isoFromUs(date) || String(date).slice(0, 10)
    const desc = pick(row, /item_description/i, /^description$/i, /primal_desc/i, /^item$/i)
    const wavg = num(pick(row, /weighted_average/i, /wtd_avg/i, /weighted_avg/i))
    if (/current cutout|cutout value/.test(sec) || (row.choice_600_900_current !== undefined)) {
      const c = num(pick(row, /choice.*current/i, /^choice_600_900$/i, /choice/i))
      const s = num(pick(row, /select.*current/i, /^select_600_900$/i, /select/i))
      if (c != null) out.cutout.choice = out.cutout.choice ?? c
      if (s != null) out.cutout.select = out.cutout.select ?? s
      const cc = num(pick(row, /choice.*change/i)); const sc = num(pick(row, /select.*change/i))
      if (cc != null) out.cutout.choiceChg = cc
      if (sc != null) out.cutout.selectChg = sc
      continue
    }
    if (/composite primal|primal/.test(sec) && !desc) {
      for (const [k, v] of Object.entries(row)) {
        const m = k.match(/^primal_(rib|chuck|round|loin|brisket|short_plate|flank)/i)
        if (m) {
          const name = titleCase(m[1].replace('_', ' '))
          let p = out.primals.find(x => x.name === name)
          if (!p) out.primals.push(p = { name, choice: null, select: null })
          if (/select/i.test(sec) || /select/i.test(k)) p.select = num(v); else p.choice = num(v)
        }
      }
      continue
    }
    if (!desc || wavg === undefined) continue
    const base = {
      imps: String(pick(row, /imps/i) ?? '').trim(),
      fat: num(pick(row, /^fl$|fat/i)),
      desc: String(desc).trim(),
      trades: num(pick(row, /number_trades|trades/i)),
      lbs: num(pick(row, /total_pounds|pounds/i)),
      low: num(pick(row, /price_range_low|low/i)),
      high: num(pick(row, /price_range_high|high/i)),
      wavg,
    }
    if (/ungraded|choice,? ?select/.test(sec)) out.cuts.push({ grade: 'Ungraded', ...base })
    else if (/choice/.test(sec)) out.cuts.push({ grade: 'Choice', ...base })
    else if (/select/.test(sec)) out.cuts.push({ grade: 'Select', ...base })
    else if (/blended/.test(sec)) out.ground.push({ type: 'Blended', ...base })
    else if (/gb|ground/.test(sec)) out.ground.push({ type: 'Steer/Heifer', ...base })
    else if (/trim/.test(sec)) out.trim.push(base)
  }
  return out
}

export function boxedBeefLooksValid(b) {
  const priced = (b?.cuts || []).filter(c => c.wavg > 0).length
  return priced >= 10 || (b?.cutout?.choice > 0 && priced >= 5)
}

// ---------- Daily slaughter (ams_3208.pdf) ----------
export function parseSlaughterText(text) {
  const out = { source: 'USDA AMS Daily Livestock Slaughter (ams_3208)', reportDate: findLongDate(text) }
  const final = /-\s*Final/i.test(text)
  out.status = final ? 'final' : 'estimate'
  for (const species of ['Cattle', 'Calves', 'Hogs', 'Sheep']) {
    const m = text.match(new RegExp(`^\\s*${species}\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s+(-?[\\d.]+)%`, 'mi'))
    if (!m) continue
    out[species.toLowerCase()] = {
      today: num(m[1]), weekAgo: num(m[2]), yearAgo: num(m[3]),
      wtd: num(m[4]), prevWtd: num(m[5]), lyWtd: num(m[6]),
      ytd: num(m[7]), lyYtd: num(m[8]), ytdPct: num(m[9]),
    }
  }
  return out
}

// ---------- Weekly retail beef feature activity (ams_3228.pdf) ----------
const RETAIL_SECTIONS = ['Brisket', 'Chuck', 'Loin', 'Rib', 'Round', 'Sirloin', 'Other/Misc.', 'Ground', 'Deli', 'Variety Meat']
const ENV = '(Conventional|Organic|Natural|Grass ?Fed|Grassfed|Kosher|Halal|Branded)'
export function parseRetailText(text) {
  const out = { source: 'USDA AMS Weekly Retail Beef Feature Activity (ams_3228)', reportDate: findLongDate(text), summary: {}, items: [] }
  const seen = new Set()
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    let m = line.match(/^(Feature Rate|Activity Index|Total Outlets)[^\d]*([\d,.]+)%?\s+([\d,.]+)%?\s+([\d,.]+)%?/i)
    if (m) { out.summary[m[1].toLowerCase().replace(/\s+/g, '_')] = { cw: num(m[2]), pw: num(m[3]), py: num(m[4]) }; continue }
    for (const s of RETAIL_SECTIONS) {
      if (line.startsWith(s + ' ') && /\b(Per lb|Each|Per Unit|Per Pkg)\b/i.test(line.slice(s.length, s.length + 12))) {
        section = s; line = line.slice(s.length).trim(); break
      }
    }
    line = line.replace(/^(Per lb|Each|Per Unit|Per Pkg)\s+/i, '')
    m = line.match(new RegExp(`^(.+?)\\s+${ENV}\\s+(Fresh|Frozen)\\s+([\\d,]+)\\s+(\\d+\\.\\d{2})(?:\\s+([\\d,]+)\\s+(\\d+\\.\\d{2}))?(?:\\s+([\\d,]+)\\s+(\\d+\\.\\d{2}))?\\s*$`, 'i'))
    if (!m) continue
    const key = `${m[1]}|${m[2]}|${m[3]}`
    if (seen.has(key)) continue // regional tables repeat items; keep the national row
    seen.add(key)
    out.items.push({ section, item: m[1].trim(), env: m[2], cond: m[3], stores: num(m[4]), price: num(m[5]), pwStores: num(m[6]), pwPrice: num(m[7]), pyStores: num(m[8]), pyPrice: num(m[9]) })
  }
  return out
}

// ---------- 5-area fed cattle (datamart) ----------
export function normalizeFedCattle(json) {
  const rows = collectRows(json, '', []).map(r => r.row)
  const out = { source: 'USDA AMS 5 Area Daily Direct Slaughter Cattle (Datamart)', reportDate: null, rows: [] }
  for (const row of rows) {
    const date = pick(row, /^report_date$/i)
    if (date && !out.reportDate) out.reportDate = isoFromUs(date)
    const cls = pick(row, /class_description/i)
    const basis = pick(row, /selling_basis_description/i)
    const price = num(pick(row, /weighted_avg_price|wtd_avg_price|weighted_average_price/i))
    if (!cls || price == null) continue
    out.rows.push({
      cls: String(cls), basis: String(basis || ''), grade: String(pick(row, /grade_description/i) || ''),
      head: num(pick(row, /head_count/i)), price,
      low: num(pick(row, /price_range_low/i)), high: num(pick(row, /price_range_high/i)),
      weight: num(pick(row, /weight_range_avg|avg_weight|average_weight|weighted_avg_weight/i)),
    })
  }
  return out
}
