// App controller: owns state and wires glasses, phone UI, calls and data together.
import type { Call, CallIndexEntry, Customer, Settings } from './types'
import { DEFAULT_SETTINGS } from './types'
import type { Store } from './store'
import { type KB, loadKB, saveKB, numbersDigest } from './kb/knowledge'
import { loadMarket, type MarketBundle, type Card, marketPages, cutoutCard, killCard, cattleCard, shortDate } from './intel/market'
import { IntelEngine } from './intel/engine'
import { CallSession, loadCall, upsertIndex, glassTranscript, deleteCall } from './calls/session'
import { summaryToText, summaryPrompt, fmtClock } from './calls/summarize'
import { callPacket, parseClaudeNotes, rememberLines } from './calls/claude'
import { aiComplete, aiEnabled } from './ai/llm'
import type { Glasses } from './glasses/ui'
import { EnergyTracker } from './audio/speaker'

export interface Mic {
  open(source: 'glasses' | 'phone'): Promise<boolean>
  close(): Promise<void>
}

export class App {
  settings: Settings = { ...DEFAULT_SETTINGS }
  kb: KB = { customers: [], docs: [] }
  index: CallIndexEntry[] = []
  recentCalls: Call[] = []
  market: MarketBundle = { beef: null, market: null, news: null, loadedAt: 0, from: 'none' }
  session: CallSession | null = null
  lastEnded: Call | null = null
  engine: IntelEngine
  private listeners = new Set<() => void>()
  private calibrating: { tracker: EnergyTracker; done: (db: number | null) => void } | null = null
  toast = ''

  constructor(public store: Store, public glasses: Glasses, public mic: Mic) {
    this.engine = new IntelEngine(() => this.market, () => this.settings, () => this.kb, () => this.recentCalls)
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit() { for (const fn of this.listeners) fn() }
  notify(msg: string) { this.toast = msg; this.emit(); setTimeout(() => { if (this.toast === msg) { this.toast = ''; this.emit() } }, 3500) }

  async init() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.store.get<Partial<Settings>>('settings', {})) }
    this.kb = await loadKB(this.store)
    this.index = await this.store.get<CallIndexEntry[]>('calls:index', [])
    await this.loadRecentCalls()
    await this.refreshMarket()
    setInterval(() => void this.refreshMarket(), 15 * 60 * 1000)
    this.emit()
  }

  async loadRecentCalls() {
    const ids = this.index.slice(0, 25).map(e => e.id)
    this.recentCalls = (await Promise.all(ids.map(id => loadCall(this.store, id)))).filter((c): c is Call => !!c)
  }

  async refreshMarket() {
    this.market = await loadMarket(this.store, this.settings)
    this.emit()
  }

  async saveSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch }
    await this.store.set('settings', this.settings)
    this.emit()
  }

  async saveKB() { await saveKB(this.store, this.kb); this.emit() }

  customerById(id?: string) { return this.kb.customers.find(c => c.id === id) || null }

  // ---------- audio routing ----------
  onPcm(pcm: Uint8Array) {
    if (this.calibrating) { this.calibrating.tracker.push(pcm); return }
    this.session?.pushPcm(pcm)
  }

  /** One-time voice check: speak normally for ~6 s so the app learns how loud you are. */
  async calibrateVoice(): Promise<number | null> {
    if (this.session) throw new Error('Finish the call first')
    await this.glasses.ensureStarted()
    const ok = await this.mic.open(this.settings.micSource)
    if (!ok) throw new Error('Could not open the microphone')
    const tracker = new EnergyTracker()
    const db = await new Promise<number | null>(resolve => {
      this.calibrating = { tracker, done: resolve }
      setTimeout(() => resolve(tracker.voicedMedian()), 6500)
    })
    this.calibrating = null
    await this.mic.close()
    if (db != null) await this.saveSettings({ alanLevelDb: Math.round(db * 10) / 10 })
    return db
  }

  // ---------- calls ----------
  async startCall(customer: Customer | null) {
    if (this.session) return
    await this.glasses.ensureStarted()
    const extra = [...this.kb.customers.flatMap(c => [c.name, ...c.aliases]), ...this.kb.customers.flatMap(c => c.items.map(i => i.name))]
    const s = new CallSession(this.store, this.settings, this.engine, customer, extra)
    this.session = s
    s.onChange = () => { this.renderCallOnGlasses(); this.emit() }
    await this.glasses.showCall({
      onTap: () => this.togglePause(),
      onDouble: () => void this.endCall(),
      onStep: d => s.stepCard(d),
    }, this.callStatus(), glassTranscript(s.call, ''), this.intelText())
    const ok = await this.mic.open(this.settings.micSource)
    if (!ok) this.notify('Microphone did not open — check app permissions')
    this.emit()
  }

  /** Continue a call after the Even app moved us to/from the background. */
  async resumeCall(call: Call) {
    if (this.session || call.endedAt) return
    await this.glasses.ensureStarted()
    const extra = this.kb.customers.flatMap(c => [c.name, ...c.aliases])
    const s = new CallSession(this.store, this.settings, this.engine, this.customerById(call.customerId), extra, call)
    this.session = s
    s.onChange = () => { this.renderCallOnGlasses(); this.emit() }
    await this.glasses.showCall({ onTap: () => this.togglePause(), onDouble: () => void this.endCall(), onStep: d => s.stepCard(d) },
      this.callStatus(), glassTranscript(s.call, ''), this.intelText())
    await this.mic.open(this.settings.micSource)
    this.emit()
  }

  togglePause() {
    const s = this.session
    if (!s) return
    s.setPaused(!s.paused)
    void this.mic[s.paused ? 'close' : 'open'](this.settings.micSource as never)
  }

  callStatus(): string {
    const s = this.session
    if (!s) return ''
    const st = s.paused ? 'II PAUSED' : s.sttState === 'live' ? '● LIVE' : s.sttState === 'error' ? '! ' + s.sttDetail.slice(0, 30) : `… ${s.sttState}`
    const who = s.call.customerName ? ` · ${s.call.customerName.slice(0, 16)}` : ''
    const cards = s.cards.length ? ` · card ${s.cardIndex + 1}/${s.cards.length}` : ''
    return `${st} ${fmtClock(s.elapsedMs)}${who}${cards} · 2×tap end`
  }

  intelText(): string {
    const s = this.session
    if (!s || s.cardIndex < 0) {
      const co = cutoutCard(this.market)
      return co ? `Say a cut to see price.\n\n${co.glass}` : 'Say a cut name\n(e.g. "strip loin")\nto see USDA price.'
    }
    return s.cards[s.cardIndex].glass
  }

  renderCallOnGlasses() {
    const s = this.session
    if (!s) return
    this.glasses.updateCall(this.callStatus(), glassTranscript(s.call, s.interim), this.intelText())
  }

  async endCall() {
    const s = this.session
    if (!s) return
    await this.mic.close()
    const customer = this.customerById(s.call.customerId)
    const call = await s.end(customer)
    this.session = null
    this.lastEnded = call
    this.index = await this.store.get<CallIndexEntry[]>('calls:index', [])
    this.recentCalls = [call, ...this.recentCalls.filter(c => c.id !== call.id)].slice(0, 25)
    this.emit()
    await this.showCallOnGlasses(call, () => void this.showHome())
    if (aiEnabled(this.settings)) void this.aiSummarize(call.id)
  }

  async getCall(id: string) { return this.recentCalls.find(c => c.id === id) || (await loadCall(this.store, id)) }

  async updateCall(call: Call) {
    await this.store.set(`call:${call.id}`, call)
    await upsertIndex(this.store, call)
    this.index = await this.store.get<CallIndexEntry[]>('calls:index', [])
    const i = this.recentCalls.findIndex(c => c.id === call.id)
    if (i >= 0) this.recentCalls[i] = call
    this.emit()
  }

  async removeCall(id: string) {
    await deleteCall(this.store, id)
    this.index = this.index.filter(x => x.id !== id)
    this.recentCalls = this.recentCalls.filter(c => c.id !== id)
    this.emit()
  }

  marketContext(): string {
    const parts = [cutoutCard(this.market)?.phone, killCard(this.market)?.phone, cattleCard(this.market)?.phone].filter(Boolean)
    return parts.join('\n\n')
  }

  numbersContext(): string {
    return this.kb.docs.filter(d => d.kind === 'numbers').flatMap(d => [`[${d.title}]`, ...numbersDigest(d)]).join('\n')
  }

  async aiSummarize(id: string) {
    const call = await this.getCall(id)
    if (!call) return
    try {
      const text = await aiComplete(this.settings, summaryPrompt(call, this.customerById(call.customerId), this.marketContext(), this.numbersContext()), 1400)
      call.summary = { ...(call.summary ?? { generatedBy: 'ai', headline: '', topics: [], followUps: [], prices: [], volumes: [], customerNeeds: [], talkingPointsNext: [] }), generatedBy: 'ai', aiText: text }
      const head = text.split('\n').find(l => l.trim() && !/^#*\s*1\.?\s*headline/i.test(l))
      if (head) call.summary.headline = head.replace(/^[#*\d.\s-]+/, '').slice(0, 120)
      await this.updateCall(call)
      this.notify('AI summary ready')
    } catch (e) {
      this.notify(`AI summary failed: ${(e as Error).message}`)
    }
  }

  packetFor(call: Call) {
    return callPacket(call, this.customerById(call.customerId), this.marketContext(), this.numbersContext())
  }

  /** Save Claude's notes onto the call; facts to remember go to the customer. */
  async applyClaudeNotes(id: string, text: string): Promise<{ followUps: number; remembered: number }> {
    const call = await this.getCall(id)
    if (!call || !text.trim()) return { followUps: 0, remembered: 0 }
    call.summary = parseClaudeNotes(text)
    await this.updateCall(call)
    let remembered = 0
    const c = this.customerById(call.customerId)
    if (c) {
      const date = new Date(call.startedAt).toLocaleDateString()
      const facts = rememberLines(text).map(f => `${date}: ${f}`).filter(f => !c.learned.includes(f))
      c.learned = [...c.learned, ...facts].slice(-40)
      c.updatedAt = Date.now()
      remembered = facts.length
      await this.saveKB()
    }
    return { followUps: call.summary.followUps.length, remembered }
  }

  // ---------- glasses navigation ----------
  async showHome() {
    if (this.session) return
    const items = ['▶ Start call', '▶ Start call: pick customer', 'Market brief', 'News', 'Recent calls', 'Open follow-ups']
    await this.glasses.showList('SALES EDGE · tap to choose · 2×tap exit', items, i => {
      if (i === 0) void this.startCall(null)
      if (i === 1) void this.pickCustomer()
      if (i === 2) void this.glasses.showPages('MARKET', marketPages(this.market, this.settings), () => void this.showHome())
      if (i === 3) void this.showNews()
      if (i === 4) void this.showRecent()
      if (i === 5) void this.showFollowUps()
    })
  }

  async pickCustomer() {
    const cs = [...this.kb.customers].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 19)
    if (!cs.length) {
      await this.glasses.showPages('CUSTOMERS', ['No customers yet.\nAdd them in the phone app\n> Customers.'], () => void this.showHome())
      return
    }
    await this.glasses.showList('Who are you meeting?', ['(no customer)', ...cs.map(c => c.name)], i => {
      void this.startCall(i === 0 ? null : cs[i - 1])
    }, () => void this.showHome())
  }

  async showNews() {
    const items = (this.market.news?.items || []).slice(0, 18)
    if (!items.length) {
      await this.glasses.showPages('NEWS', ['No news loaded yet.'], () => void this.showHome())
      return
    }
    await this.glasses.showList(`NEWS · ${items.length} latest`, items.map(n => n.title), i => {
      const n = items[i]
      void this.glasses.showPages('NEWS', [`${n.title}\n\n${n.source} · ${new Date(n.date).toLocaleDateString()}\n\nFull story on the phone app > Market.`], () => void this.showNews())
    }, () => void this.showHome())
  }

  async showRecent() {
    const idx = this.index.slice(0, 19)
    if (!idx.length) {
      await this.glasses.showPages('CALLS', ['No calls yet.'], () => void this.showHome())
      return
    }
    await this.glasses.showList('RECENT CALLS', idx.map(e => `${new Date(e.startedAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${e.customerName || 'Call'} ${Math.round(e.durationSec / 60)}m`), async i => {
      const call = await this.getCall(idx[i].id)
      if (call) await this.showCallOnGlasses(call, () => void this.showRecent())
    }, () => void this.showHome())
  }

  async showFollowUps() {
    const lines: string[] = []
    for (const c of this.recentCalls) {
      for (const f of c.summary?.followUps.filter(f => !f.done) || []) {
        lines.push(`${shortDate(new Date(c.startedAt).toISOString().slice(0, 10))} ${c.customerName || ''}\n${f.owner}: ${f.text}${f.due ? ` (${f.due})` : ''}`)
      }
    }
    await this.glasses.showPages('FOLLOW-UPS', paginate(lines.join('\n\n') || 'Nothing open. Nice.'), () => void this.showHome())
  }

  async showCallOnGlasses(call: Call, back: () => void) {
    const text = call.summary ? summaryToText(call.summary) : 'No summary.'
    await this.glasses.showPages('CALL NOTES', paginate(text), back)
  }
}

/** Split long text into ~420-char pages at line/word boundaries. */
export function paginate(text: string, size = 420): string[] {
  const pages: string[] = []
  let cur = ''
  for (const para of text.split('\n')) {
    let p = para
    while (p.length > size) {
      const cut = p.lastIndexOf(' ', size)
      const n = cut > 50 ? cut : size
      if (cur) { pages.push(cur); cur = '' }
      pages.push(p.slice(0, n))
      p = p.slice(n).trim()
    }
    if ((cur + '\n' + p).length > size) { pages.push(cur); cur = p }
    else cur = cur ? cur + '\n' + p : p
  }
  if (cur.trim()) pages.push(cur)
  return pages.length ? pages : ['']
}

export type { Card }
