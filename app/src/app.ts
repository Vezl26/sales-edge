// App controller: owns state and wires glasses, phone UI, calls and data together.
import type { Call, CallIndexEntry, Customer, Settings } from './types'
import { DEFAULT_SETTINGS } from './types'
import type { Store } from './store'
import { type KB, loadKB, saveKB, numbersDigest, reportHighlights } from './kb/knowledge'
import { loadMarket, type MarketBundle, type Card, marketPages, cutoutCard, killCard, cattleCard, retailCard, shortDate } from './intel/market'
import { IntelEngine } from './intel/engine'
import { CallSession, loadCall, upsertIndex, glassTranscript, deleteCall } from './calls/session'
import { summaryToText, summaryPrompt, fmtClock } from './calls/summarize'
import { callPacket, parseClaudeNotes, rememberLines } from './calls/claude'
import { aiComplete, aiEnabled } from './ai/llm'
import type { Glasses } from './glasses/ui'
import { EnergyTracker } from './audio/speaker'
import { prepFor, prepCards, type Prep } from './prep/prep'
import { Prompter, searchDocs, onPrepShare } from './prep/prompter'
import { suggestReply, aiReplyPrompt } from './intel/replies'

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
    // Pasting a key is enough: default to the free Gemini setup
    if (this.settings.aiKey && this.settings.aiProvider === 'none') {
      this.settings = { ...this.settings, aiProvider: 'openai-compatible', aiBaseUrl: this.settings.aiBaseUrl || DEFAULT_SETTINGS.aiBaseUrl, aiModel: this.settings.aiModel || DEFAULT_SETTINGS.aiModel }
    }
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
  async startCall(customer: Customer | null, forcedPrep?: Prep, group = false, internal = false) {
    if (this.session) return
    await this.glasses.ensureStarted()
    // This customer's names and contacts go first so the recognizer hears "Brad" and not "brisket".
    const contacts = (customer?.contact ?? '').split(/[,;/&\n]| and /).map(x => x.trim()).filter(Boolean)
    const mine = customer ? [customer.name, ...customer.aliases, ...contacts, ...contacts.flatMap(x => x.split(/\s+/).filter(w => w.length > 2))] : []
    const extra = [...mine, ...this.kb.customers.flatMap(c => [c.name, ...c.aliases]), ...this.kb.customers.flatMap(c => c.items.map(i => i.name))]
    const s = new CallSession(this.store, this.settings, this.engine, customer, extra)
    if (group) s.call.group = true
    if (internal) s.call.internal = true
    this.session = s
    s.onChange = () => { this.renderCallOnGlasses(); this.emit() }
    s.onCustomerTagged = c => this.attachPrep(c.id)
    s.onLines = (text, spk) => this.assist(text, spk)
    this.attachPrep(customer?.id ?? null, forcedPrep)
    await this.glasses.showCall({
      onTap: () => this.togglePause(),
      onDouble: () => void this.endCall(),
      onStep: d => s.swipe(d),
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
    await this.glasses.showCall({ onTap: () => this.togglePause(), onDouble: () => void this.endCall(), onStep: d => s.swipe(d) },
      this.callStatus(), glassTranscript(s.call, ''), this.intelText())
    await this.mic.open(this.settings.micSource)
    this.emit()
  }

  /** Load the customer's prep (or an untagged prep picked on the glasses) into the call. */
  attachPrep(customerId: string | null, forced?: Prep) {
    const s = this.session
    if (!s) return
    const p = forced ?? (customerId ? prepFor(this.kb, customerId) : null)
    const cust = this.customerById(customerId ?? undefined)
    if (cust) this.engine.customer = cust
    if (!p || s.cards.some(c => c.key.startsWith(`prep:${p.id}:`))) return
    s.addPrepCards(prepCards(p))
    s.prompter = new Prompter(p)
    s.call.notes = [s.call.notes, `Prep used: ${p.title}`].filter(Boolean).join('\n')
  }

  async savePrep(p: Prep) {
    this.kb.preps ||= []
    const i = this.kb.preps.findIndex(x => x.id === p.id)
    p.updatedAt = Date.now()
    if (i >= 0) this.kb.preps[i] = p; else this.kb.preps.unshift(p)
    await this.saveKB()
  }

  async deletePrep(id: string) {
    this.kb.preps = (this.kb.preps || []).filter(p => p.id !== id)
    await this.saveKB()
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
    const cards = s.prompter ? ` · prep ${s.prompter.done}/${s.prompter.points.length}✓` : s.cards.length ? ` · card ${s.cardIndex + 1}/${s.cards.length}` : ''
    return `${st} ${fmtClock(s.elapsedMs)}${who}${cards} · 2×tap end`
  }

  private lastRefAt = 0
  /** Conversate-style help: when talk drifts away from the prep, pull a reference from your documents. */
  assist(text: string, spk: string[]) {
    const s = this.session
    if (!s) return
    if (spk.includes('C') || spk.includes('?')) this.maybeReply(text)
    if (Date.now() - this.lastRefAt < 45000) return
    const vocab = s.prompter?.vocab()
    // With prep: only step in when the conversation is mostly off the prep.
    if (vocab && onPrepShare(text, vocab) > 0.35) return
    // Without prep: only for what the customer raises.
    if (!vocab && !spk.includes('C')) return
    const hits = searchDocs(this.kb, text, vocab, 2)
    if (!hits.length) return
    this.lastRefAt = Date.now()
    const body = hits.map(h => `• ${h.text.slice(0, 150)}\n  [${h.doc.slice(0, 28)}]`).join('\n')
    s.addCard({ kind: 'info', key: `ref:${Date.now()}`, title: 'Reference', glass: `REFERENCE (off prep)\n${body}`, phone: `From your documents:\n${hits.map(h => `• ${h.text}\n  — ${h.doc}`).join('\n')}`, at: Date.now() })
  }

  private lastReplyAt = 0
  /** Suggested line to say back when the customer asks or pushes back. */
  private maybeReply(text: string) {
    const s = this.session
    if (!s || Date.now() - this.lastReplyAt < 20000) return
    const goal = s.prompter?.goal
    const line = suggestReply(text, { m: this.market, s: this.settings, kb: this.kb, goal, customer: this.customerById(s.call.customerId) })
    const show = (say: string, via: string) => {
      this.lastReplyAt = Date.now()
      s.addCard({ kind: 'tip', key: `say:${Date.now()}`, title: 'Suggested reply', glass: `SAY:\n${say}`, phone: `They said: "${text}"\n\nYou could say (${via}):\n${say}`, at: Date.now() })
    }
    if (line) { show(line, 'from market data'); return }
    const asked = /\?\s*$/.test(text.trim())
    if (asked && aiEnabled(this.settings)) {
      this.lastReplyAt = Date.now()
      const recent = s.call.segments.slice(-8).map(x => `${x.spk === 'A' ? 'Alan' : 'Customer'}: ${x.text}`).join('\n')
      const priv = this.settings.aiPrivate
      const facts = [this.marketContext().slice(0, 1500), !priv && s.prompter ? s.prompter.prep.notes.slice(0, 1500) : ''].filter(Boolean).join('\n')
      aiComplete(this.settings, aiReplyPrompt(text, recent, goal || '', facts), 120)
        .then(say => { if (say && this.session === s) show(say.replace(/^["']|["']$/g, ''), 'AI') })
        .catch(() => {})
    }
  }

  intelText(): string {
    const s = this.session
    if (s?.prompter) {
      if (s.overlay && Date.now() < s.overlayUntil) {
        const left = Math.ceil((s.overlayUntil - Date.now()) / 1000)
        setTimeout(() => this.renderCallOnGlasses(), (left + 0.3) * 1000)
        return `${s.overlay.glass}\n\n(back to prep in ${left}s · swipe = now)`
      }
      return s.prompter.view()
    }
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
    const parts = [cutoutCard(this.market)?.phone, killCard(this.market)?.phone, cattleCard(this.market)?.phone, retailCard(this.market, '', 12)?.phone, this.latestReportBrief()].filter(Boolean)
    return parts.join('\n\n')
  }

  /** Newest weekly report = "current". */
  latestReport() {
    return [...this.kb.docs].filter(d => d.kind === 'report').sort((a, b) => (b.asOf || '').localeCompare(a.asOf || '') || b.addedAt - a.addedAt)[0] || null
  }

  latestReportBrief(): string {
    const r = this.latestReport()
    if (!r) return ''
    const body = r.table ? numbersDigest(r).join('\n') : reportHighlights(r.text).join('\n')
    return `CURRENT WEEKLY REPORT: ${r.title}${r.asOf ? ` (week of ${r.asOf})` : ''}\n${body}`
  }

  numbersContext(): string {
    return this.kb.docs.filter(d => d.kind === 'numbers').flatMap(d => [`[${d.title}]`, ...numbersDigest(d)]).join('\n')
  }

  async aiSummarize(id: string) {
    const call = await this.getCall(id)
    if (!call) return
    try {
      const priv = this.settings.aiPrivate
      const text = await aiComplete(this.settings, summaryPrompt(call, priv ? null : this.customerById(call.customerId), this.marketContext(), priv ? '' : this.numbersContext()), 1400)
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
    const items = ['▶ Start call', '▶ Start call: pick customer', 'Meeting prep', 'Market brief', 'News', 'Recent calls', 'Open follow-ups']
    await this.glasses.showList('SALES EDGE · tap to choose · 2×tap exit', items, i => {
      if (i === 0) void this.startCall(null)
      if (i === 1) void this.pickCustomer()
      if (i === 2) void this.showPreps()
      if (i === 3) void this.glasses.showPages('MARKET', marketPages(this.market, this.settings), () => void this.showHome())
      if (i === 4) void this.showNews()
      if (i === 5) void this.showRecent()
      if (i === 6) void this.showFollowUps()
    })
  }

  /** Glasses: read a prep before walking in; tap starts the call with it loaded. */
  async showPreps() {
    const preps = [...(this.kb.preps || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt).slice(0, 19)
    if (!preps.length) {
      await this.glasses.showPages('PREP', ['No prep notes yet.\nWrite one in the phone app\n> Prep tab.'], () => void this.showHome())
      return
    }
    await this.glasses.showList('MEETING PREP', preps.map(p => `${p.date ? p.date.slice(5).replace('-', '/') + ' ' : ''}${p.title}`), i => {
      const p = preps[i]
      const pages = prepCards(p, 380).map(c => c.glass)
      void this.glasses.showPages(p.title.slice(0, 20).toUpperCase(), [...pages, 'Tap to START THE CALL\nwith this prep loaded.'],
        () => void this.showPreps(), () => void this.startCall(this.customerById(p.customerId), p))
    }, () => void this.showHome())
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
