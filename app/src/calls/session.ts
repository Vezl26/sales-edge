// One live call: audio -> speech-to-text -> labeled transcript -> live cards.
import type { Call, Segment, Settings, Customer, CallIndexEntry } from '../types'
import type { Store } from '../store'
import { EnergyTracker, SpeakerMapper } from '../audio/speaker'
import { startDeepgram, type SttClient, type SttResult, type SttWord } from '../audio/stt-deepgram'
import type { Card } from '../intel/market'
import type { IntelEngine } from '../intel/engine'
import { autoSummary } from './summarize'
import { uid } from '../kb/knowledge'
import { recognizerKeyterms } from '../intel/lexicon'

export type SttState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error' | 'paused'

export class CallSession {
  call: Call
  interim = ''
  cards: Card[] = []
  cardIndex = -1
  sttState: SttState = 'idle'
  sttDetail = ''
  paused = false
  private energy = new EnergyTracker()
  private mapper: SpeakerMapper
  private stt: SttClient | null = null
  private saveTimer: number | null = null
  private dirty = false
  onChange: () => void = () => {}
  onCard: (c: Card) => void = () => {}
  onCustomerTagged: (c: Customer) => void = () => {}

  constructor(
    private store: Store,
    settings: Settings,
    private engine: IntelEngine,
    customer: Customer | null,
    keytermsExtra: string[],
    resume?: Call,
  ) {
    this.call = resume ?? {
      id: uid(), startedAt: Date.now(), segments: [], cards: [],
      customerId: customer?.id, customerName: customer?.name, otherLabel: customer?.name,
    }
    this.mapper = new SpeakerMapper(settings.alanLevelDb)
    for (const s of this.call.segments) if (s.dz !== undefined) this.mapper.observe(s.dz, s.db ?? null)
    engine.reset(customer)
    engine.onCustomer = c => {
      if (!this.call.customerId) {
        this.call.customerId = c.id
        this.call.customerName = c.name
        this.call.otherLabel ||= c.name
        this.onCustomerTagged(c)
        this.touch()
      }
    }
    if (settings.sttProvider === 'deepgram' && settings.deepgramKey) {
      this.stt = startDeepgram({
        apiKey: settings.deepgramKey,
        keyterms: recognizerKeyterms(keytermsExtra),
        onResult: r => this.onResult(r),
        onStatus: (s, d) => { this.sttState = this.paused ? 'paused' : s; this.sttDetail = d ?? ''; this.onChange() },
        onError: e => { this.sttState = 'error'; this.sttDetail = e; this.onChange() },
      })
    } else {
      this.sttState = 'error'
      this.sttDetail = 'Add a Deepgram key in Settings to transcribe'
    }
    this.saveTimer = window.setInterval(() => { if (this.dirty) void this.save() }, 10000)
    if (customer) {
      const c = engine.customerCard(customer)
      if (c) this.addCard(c)
    }
  }

  get elapsedMs() { return (this.call.endedAt ?? Date.now()) - this.call.startedAt }

  pushPcm(pcm: Uint8Array) {
    if (this.paused) return
    this.energy.push(pcm)
    this.stt?.sendPcm(pcm)
  }

  setPaused(p: boolean) {
    this.paused = p
    this.sttState = p ? 'paused' : 'live'
    this.onChange()
  }

  private onResult(r: SttResult) {
    if (!r.isFinal) {
      this.interim = r.text
      this.onChange()
      return
    }
    this.interim = ''
    if (!r.text.trim()) { this.onChange(); return }
    const runs = splitBySpeaker(r.words, r.text)
    const newText: string[] = []
    for (const run of runs) {
      const db = this.energy.dbBetween(run.start, run.end)
      if (run.dz !== undefined) this.mapper.observe(run.dz, db)
      const seg: Segment = { t: Math.max(0, run.start), spk: '?', text: run.text, dz: run.dz, db }
      seg.spk = this.mapper.label(seg.dz, db)
      this.call.segments.push(seg)
      newText.push(run.text)
    }
    this.relabel()
    for (const c of this.engine.ingest(newText.join(' '))) this.addCard(c)
    this.touch()
  }

  /** Re-run labels as the loudness picture improves (manual edits are kept). */
  relabel() {
    for (const s of this.call.segments) if (!s.manual) s.spk = this.mapper.label(s.dz, s.db ?? null)
  }

  flip(index: number) {
    const s = this.call.segments[index]
    if (!s) return
    s.spk = s.spk === 'A' ? 'C' : 'A'
    s.manual = true
    this.touch()
  }

  swapAll() {
    for (const s of this.call.segments) { s.spk = s.spk === 'A' ? 'C' : s.spk === 'C' ? 'A' : '?'; s.manual = true }
    this.touch()
  }

  addCard(c: Card) {
    this.cards.push(c)
    this.cardIndex = this.cards.length - 1
    this.call.cards.push({ t: this.elapsedMs, kind: c.kind, title: c.title, body: c.phone })
    this.onCard(c)
    this.onChange()
  }

  /** Put prep cards up front and jump to the first one. */
  addPrepCards(cards: Card[]) {
    if (!cards.length) return
    const first = this.cards.length
    for (const c of cards) {
      this.cards.push(c)
      this.call.cards.push({ t: this.elapsedMs, kind: 'prep', title: c.title, body: c.phone })
    }
    this.cardIndex = first
    this.onChange()
  }

  stepCard(dir: 1 | -1) {
    if (!this.cards.length) return
    this.cardIndex = Math.max(0, Math.min(this.cards.length - 1, this.cardIndex + dir))
    this.onChange()
  }

  private touch() { this.dirty = true; this.onChange() }

  async save() {
    this.dirty = false
    await this.store.set(`call:${this.call.id}`, this.call)
    await upsertIndex(this.store, this.call)
  }

  async end(customer: Customer | null): Promise<Call> {
    this.call.endedAt = Date.now()
    this.stt?.close()
    if (this.saveTimer !== null) clearInterval(this.saveTimer)
    this.call.summary = autoSummary(this.call, customer)
    await this.save()
    return this.call
  }

  /** Background snapshot (host may move the app to a headless WebView). */
  snapshot(): Call { return JSON.parse(JSON.stringify(this.call)) }
}

interface Run { text: string; start: number; end: number; dz?: number }

export function splitBySpeaker(words: SttWord[], fallback: string): Run[] {
  if (!words.length) return [{ text: fallback.trim(), start: 0, end: 0 }]
  const runs: Run[] = []
  for (const w of words) {
    const last = runs[runs.length - 1]
    if (last && last.dz === w.speaker) { last.text += ' ' + w.word; last.end = w.end }
    else runs.push({ text: w.word, start: w.start, end: w.end, dz: w.speaker })
  }
  return runs
}

export async function upsertIndex(store: Store, call: Call) {
  const idx = await store.get<CallIndexEntry[]>('calls:index', [])
  const e: CallIndexEntry = {
    id: call.id, startedAt: call.startedAt,
    durationSec: Math.round(((call.endedAt ?? Date.now()) - call.startedAt) / 1000),
    customerName: call.customerName, headline: call.summary?.headline,
    openFollowUps: call.summary?.followUps.filter(f => !f.done).length ?? 0,
  }
  const i = idx.findIndex(x => x.id === call.id)
  if (i >= 0) idx[i] = e; else idx.unshift(e)
  idx.sort((a, b) => b.startedAt - a.startedAt)
  await store.set('calls:index', idx)
}

export async function loadCall(store: Store, id: string): Promise<Call | null> {
  return store.get<Call | null>(`call:${id}`, null)
}

export async function deleteCall(store: Store, id: string) {
  await store.del(`call:${id}`)
  const idx = await store.get<CallIndexEntry[]>('calls:index', [])
  await store.set('calls:index', idx.filter(x => x.id !== id))
}

/** Plain transcript lines for the glasses (newest at the bottom). */
export function glassTranscript(call: Call, interim: string, maxChars = 260): string {
  const other = (call.otherLabel || 'Cust').split(' ')[0].slice(0, 8)
  const tag = (s: Segment) => (s.spk === 'A' ? 'Me' : s.spk === 'C' ? other : '··')
  const lines: string[] = []
  let lastSpk = ''
  for (const s of call.segments.slice(-14)) {
    if (s.spk === lastSpk && lines.length) lines[lines.length - 1] += ' ' + s.text
    else lines.push(`${tag(s)}: ${s.text}`)
    lastSpk = s.spk
  }
  if (interim) lines.push(`… ${interim}`)
  let out = lines.join('\n')
  if (out.length > maxChars) out = '…' + out.slice(out.length - maxChars + 1).replace(/^\S*\s/, '')
  return out || 'Listening…'
}
