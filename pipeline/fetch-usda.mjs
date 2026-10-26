// Pulls USDA market data and writes app/public/data/{beef,market,history,status}.json
// Sources (all free, public, no key):
//   LM_XB403  National Daily Boxed Beef Cutout & Cuts (PM)  - datamart JSON, PDF fallback
//   ams_3208  Daily Livestock Slaughter Under Federal Inspection - PDF
//   LM_CT100-family 5 Area daily direct slaughter cattle - datamart JSON (best effort)
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fetchJson, fetchBuffer, pdfToText, readJson, writeJson, OUT_DIR, log } from './lib.mjs'
import {
  parseBoxedBeefText, normalizeBoxedBeefDatamart, boxedBeefLooksValid,
  parseSlaughterText, normalizeFedCattle,
} from './parse-usda.mjs'

const DM = 'https://mpr.datamart.ams.usda.gov/services/v1.1/reports'
const status = { updatedAt: new Date().toISOString(), sources: {} }

async function saveRaw(name, data) {
  const dir = path.join(OUT_DIR, '..', '..', '..', 'pipeline', 'raw')
  await mkdir(dir, { recursive: true })
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 1)
  await writeFile(path.join(dir, name), body.slice(0, 2_000_000))
}

async function boxedBeef() {
  // Try both USDA formats and keep the more complete one (cutout + most priced cuts).
  const tries = []
  try {
    const json = await fetchJson(`${DM}/2453?allSections=true`)
    await saveRaw('2453.json', json)
    tries.push(normalizeBoxedBeefDatamart(json))
  } catch (e) { log('datamart 2453 failed:', e.message) }
  try {
    const txt = await pdfToText(await fetchBuffer('https://www.ams.usda.gov/mnreports/ams_2453.pdf'))
    await saveRaw('2453.txt', txt)
    tries.push(parseBoxedBeefText(txt))
  } catch (e) { log('pdf 2453 failed:', e.message) }
  const score = b => (b.cutout?.choice > 0 ? 1000 : 0) + b.cuts.filter(c => c.wavg > 0).length + (b.reportDate ? 500 : 0)
  const good = tries.filter(boxedBeefLooksValid).sort((a, b) => score(b) - score(a))
  if (!good.length) throw new Error('no usable boxed beef report (see pipeline/raw)')
  const best = good[0]
  // fill a missing cutout from the other source if same day
  const other = good.find(b => b !== best && b.reportDate === best.reportDate && b.cutout?.choice)
  if (!best.cutout?.choice && other) { best.cutout = other.cutout; best.primals = other.primals }
  return best
}

const cutKey = c => `${c.grade}|${c.imps}|${c.fat ?? ''}|${c.desc}`
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const r2 = v => (v == null ? null : Math.round(v * 100) / 100)

function mergeHistory(hist, beef) {
  hist.cuts ||= {}
  hist.cutout ||= []
  const d = beef.reportDate
  if (!d) return hist
  for (const c of beef.cuts) {
    if (!(c.wavg > 0)) continue
    const k = cutKey(c)
    const arr = (hist.cuts[k] ||= [])
    const i = arr.findIndex(x => x[0] === d)
    if (i >= 0) arr[i] = [d, c.wavg, c.lbs ?? 0]; else arr.push([d, c.wavg, c.lbs ?? 0])
    arr.sort((a, b) => a[0].localeCompare(b[0]))
    if (arr.length > 120) arr.splice(0, arr.length - 120)
  }
  if (beef.cutout.choice) {
    const i = hist.cutout.findIndex(x => x[0] === d)
    const row = [d, beef.cutout.choice, beef.cutout.select ?? null]
    if (i >= 0) hist.cutout[i] = row; else hist.cutout.push(row)
    hist.cutout.sort((a, b) => a[0].localeCompare(b[0]))
    if (hist.cutout.length > 250) hist.cutout.splice(0, hist.cutout.length - 250)
  }
  return hist
}

function enrich(beef, hist) {
  for (const c of beef.cuts) {
    const arr = (hist.cuts[cutKey(c)] || []).filter(x => x[0] <= beef.reportDate)
    const prior = arr.filter(x => x[0] < beef.reportDate)
    c.prev = prior.length ? prior[prior.length - 1][1] : null
    c.prevDate = prior.length ? prior[prior.length - 1][0] : null
    c.avg5 = r2(avg(arr.slice(-5).map(x => x[1])))
    c.avg20 = r2(avg(arr.slice(-20).map(x => x[1])))
    c.days = arr.length
  }
  const co = hist.cutout.filter(x => x[0] <= beef.reportDate)
  beef.cutout.avg5Choice = r2(avg(co.slice(-5).map(x => x[1])))
  beef.cutout.avg20Choice = r2(avg(co.slice(-20).map(x => x[1])))
  beef.cutoutSeries = co.slice(-30)
  return beef
}

async function slaughter() {
  const txt = await pdfToText(await fetchBuffer('https://www.ams.usda.gov/mnreports/ams_3208.pdf'))
  await saveRaw('3208.txt', txt)
  const s = parseSlaughterText(txt)
  if (!s.cattle) throw new Error('no cattle row found')
  return s
}

async function fedCattle() {
  // Slug 2466 is the 5-area daily weighted average direct slaughter cattle report
  // in the datamart user guide examples; verify via raw dump if numbers look off.
  const json = await fetchJson(`${DM}/2466?allSections=true`)
  await saveRaw('2466.json', json)
  const f = normalizeFedCattle(json)
  if (!f.rows.length) throw new Error('no fed cattle rows')
  return f
}

async function main() {
  const market = await readJson('market.json', {})
  let hist = await readJson('history.json', { cuts: {}, cutout: [] })

  try {
    const beef = await boxedBeef()
    hist = mergeHistory(hist, beef)
    enrich(beef, hist)
    beef.fetchedAt = status.updatedAt
    await writeJson('beef.json', beef)
    await writeJson('history.json', hist)
    status.sources.boxedBeef = { ok: true, reportDate: beef.reportDate, cuts: beef.cuts.length, via: beef.source }
    log('boxed beef', beef.reportDate, beef.cuts.length, 'cuts')
  } catch (e) {
    status.sources.boxedBeef = { ok: false, error: String(e.message || e) }
    log('boxed beef FAILED', e)
  }

  try {
    market.slaughter = await slaughter()
    status.sources.slaughter = { ok: true, reportDate: market.slaughter.reportDate }
  } catch (e) {
    status.sources.slaughter = { ok: false, error: String(e.message || e) }
    log('slaughter FAILED', e.message)
  }

  try {
    market.fedCattle = await fedCattle()
    status.sources.fedCattle = { ok: true, reportDate: market.fedCattle.reportDate, rows: market.fedCattle.rows.length }
  } catch (e) {
    status.sources.fedCattle = { ok: false, error: String(e.message || e) }
    log('fed cattle FAILED', e.message)
  }

  market.updatedAt = status.updatedAt
  await writeJson('market.json', market)
  const prev = await readJson('status.json', {})
  await writeJson('status.json', { ...prev, usda: status })
}

main().catch(e => { console.error(e); process.exit(1) })
