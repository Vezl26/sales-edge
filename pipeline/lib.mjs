// Shared helpers for the Sales Edge data pipeline.
// Runs in GitHub Actions (Node 20+), no npm dependencies.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

export const OUT_DIR = path.resolve(process.env.DATA_DIR || 'app/public/data')
const pexec = promisify(execFile)

const UA = 'SalesEdge/1.0 (personal market-data pipeline; contact via GitHub repo)'

export async function fetchText(url, { timeoutMs = 45000, tries = 3 } = {}) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal })
      clearTimeout(t)
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return await res.text()
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastErr
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts))
}

export async function fetchBuffer(url, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal })
  clearTimeout(t)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// PDF -> text using poppler's pdftotext (installed in the workflow).
export async function pdfToText(buf, scratch = '/tmp') {
  const f = path.join(scratch, `se_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
  await writeFile(f, buf)
  const { stdout } = await pexec('pdftotext', ['-layout', f, '-'], { maxBuffer: 20 * 1024 * 1024 })
  return stdout
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(OUT_DIR, file), 'utf8'))
  } catch {
    return fallback
  }
}

export async function writeJson(file, data) {
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, file), JSON.stringify(data, null, 1) + '\n')
}

export const num = s => {
  if (s === undefined || s === null) return null
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  const t = String(s).replace(/[,$\s]/g, '')
  if (t === '' || t === '-' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// MM/DD/YYYY in US Central time (USDA's clock).
export function centralDate(d = new Date(), offsetDays = 0) {
  const x = new Date(d.getTime() + offsetDays * 86400000)
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(x)
  const g = t => p.find(q => q.type === t).value
  return `${g('month')}/${g('day')}/${g('year')}`
}

export const isoFromUs = us => {
  const m = String(us || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

export function log(...a) {
  console.log('[pipeline]', ...a)
}
