// Aggregates public news into app/public/data/news.json via Google News RSS (free, no key).
import { readFile } from 'node:fs/promises'
import { fetchText, readJson, writeJson, log } from './lib.mjs'

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

const tag = (xml, t) => {
  const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'))
  return m ? decode(m[1]) : ''
}

export function parseRss(xml) {
  const items = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const x = m[1]
    let title = tag(x, 'title')
    const source = tag(x, 'source')
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3))
    items.push({ title, link: tag(x, 'link'), source, date: new Date(tag(x, 'pubDate') || Date.now()).toISOString() })
  }
  return items
}

const norm = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

async function main() {
  const cfg = JSON.parse(await readFile(new URL('./news-topics.json', import.meta.url), 'utf8'))
  const prev = await readJson('news.json', { items: [] })
  const seen = new Map(prev.items.map(i => [norm(i.title), i]))
  const fresh = []
  const errors = {}
  for (const t of cfg.topics) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(t.q)}&hl=en-US&gl=US&ceid=US:en`
    try {
      const items = parseRss(await fetchText(url)).slice(0, 15)
      for (const it of items) {
        const k = norm(it.title)
        if (!k) continue
        const existing = seen.get(k)
        if (existing) { existing.topics = [...new Set([...(existing.topics || []), t.id])]; continue }
        const item = { ...it, topics: [t.id] }
        seen.set(k, item); fresh.push(item)
      }
      await new Promise(r => setTimeout(r, 800))
    } catch (e) { errors[t.id] = String(e.message || e); log('news topic failed', t.id, e.message) }
  }
  const cutoff = Date.now() - 10 * 86400000
  const all = [...seen.values()]
    .filter(i => new Date(i.date).getTime() > cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 200)
  await writeJson('news.json', {
    updatedAt: new Date().toISOString(),
    topics: cfg.topics.map(({ id, label }) => ({ id, label })),
    items: all,
  })
  const st = await readJson('status.json', {})
  await writeJson('status.json', { ...st, news: { updatedAt: new Date().toISOString(), added: fresh.length, total: all.length, errors } })
  log('news', fresh.length, 'new,', all.length, 'total')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1) })
