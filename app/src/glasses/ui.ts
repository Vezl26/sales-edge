// Everything drawn on the G2 lens (576x288, green, text containers only).
// Screens: home menu, live call, paged readers (market, news, call notes), pickers.
import * as SDK from '@evenrealities/even_hub_sdk'
import {
  TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, TextContainerUpgrade, OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

type Bridge = Awaited<ReturnType<typeof SDK.waitForEvenAppBridge>>
export type GEvent = 'tap' | 'double' | 'up' | 'down' | 'exit'

interface ListScreen { kind: 'list'; title: string; items: string[]; onPick: (i: number) => void; onBack?: () => void }
interface PagesScreen { kind: 'pages'; title: string; pages: string[]; page: number; onBack: () => void; onTap?: () => void }
export type CallLayout = 'split' | 'prep' | 'conv' | 'conv-wide'
interface CallScreen { kind: 'call'; layout: CallLayout; onTap: () => void; onDouble: () => void; onStep: (d: 1 | -1) => void }
type Screen = ListScreen | PagesScreen | CallScreen

const W = 576
const H = 288

export class Glasses {
  private screen: Screen | null = null
  private started = false
  private lastScroll = 0
  private renderQueue: Promise<unknown> = Promise.resolve()
  private callText = { status: '', transcript: '', intel: '', ticker: '' }
  private pendingCall: typeof this.callText | null = null
  private callTimer: number | null = null

  constructor(private bridge: Bridge | null) {}

  get available() { return !!this.bridge }

  // ---------- page builders ----------
  private text(id: number, name: string, x: number, y: number, w: number, h: number, content: string, capture = 0, border = 0) {
    return new TextContainerProperty({
      xPosition: x, yPosition: y, width: w, height: h, borderWidth: border, borderColor: border ? 6 : 0,
      borderRadius: border ? 4 : 0, paddingLength: 4, containerID: id, containerName: name,
      content: content.slice(0, 990), isEventCapture: capture,
    })
  }

  private async apply(page: { containerTotalNum: number; textObject?: TextContainerProperty[]; listObject?: ListContainerProperty[] }) {
    if (!this.bridge) return
    const job = async () => {
      if (!this.started) {
        this.started = true
        const r = await this.bridge!.createStartUpPageContainer(new CreateStartUpPageContainer(page))
        if (r !== 0) console.warn('createStartUpPageContainer failed', r)
      } else {
        await this.bridge!.rebuildPageContainer(new RebuildPageContainer(page))
      }
    }
    this.renderQueue = this.renderQueue.then(job, job)
    await this.renderQueue
  }

  /** Must run once before the glasses mic can be opened. */
  async ensureStarted() {
    if (!this.started) await this.showMessage('Sales Edge', 'Starting…')
  }

  async showList(title: string, items: string[], onPick: (i: number) => void, onBack?: () => void) {
    const safe = items.slice(0, 20).map(s => s.slice(0, 60))
    this.screen = { kind: 'list', title, items: safe, onPick, onBack }
    await this.apply({
      containerTotalNum: 2,
      textObject: [this.text(1, 'title', 0, 0, W, 40, title)],
      listObject: [new ListContainerProperty({
        xPosition: 0, yPosition: 40, width: W, height: H - 40, borderWidth: 1, borderColor: 6, borderRadius: 6,
        paddingLength: 4, containerID: 2, containerName: 'menu', isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({ itemCount: safe.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: safe }),
      })],
    })
  }

  async showPages(title: string, pages: string[], onBack: () => void, onTap?: () => void) {
    this.screen = { kind: 'pages', title, pages: pages.length ? pages : ['(empty)'], page: 0, onBack, onTap }
    await this.renderPage()
  }

  private async renderPage() {
    const s = this.screen
    if (!s || s.kind !== 'pages') return
    const head = `${s.title}  ${s.page + 1}/${s.pages.length}  ▲▼ page · 2×tap back`
    await this.apply({
      containerTotalNum: 2,
      textObject: [
        this.text(1, 'body', 0, 30, W, H - 30, s.pages[s.page], 1),
        this.text(2, 'head', 0, 0, W, 30, head),
      ],
    })
  }

  async showMessage(title: string, body: string) {
    this.screen = { kind: 'pages', title, pages: [body], page: 0, onBack: () => {} }
    await this.renderPage()
  }

  async showCall(handlers: Omit<CallScreen, 'kind' | 'layout'>, status: string, transcript: string, intel: string, layout: CallLayout = 'split', ticker = '') {
    this.screen = { kind: 'call', layout, ...handlers }
    this.callText = { status, transcript, intel, ticker }
    // conv: captions/cue on the left, a stock-ticker column of cuts on the right, one-line strip at the bottom.
    // conv-wide: same without the ticker (used while the prep notes are open, so they read full width).
    if (layout === 'conv' || layout === 'conv-wide') {
      const TW = 214, mainH = H - 28 - 46
      const boxes = [
        this.text(1, 'evt', 0, 0, W, H, ' ', 1),
        this.text(2, 'status', 0, 0, W, 28, status),
        this.text(3, 'transcript', 0, 28, layout === 'conv' ? W - TW - 2 : W, mainH, transcript),
        this.text(4, 'intel', 0, H - 44, W, 44, intel, 0, 1),
      ]
      if (layout === 'conv') boxes.push(this.text(5, 'ticker', W - TW, 28, TW, mainH, ticker || ' ', 0, 1))
      await this.apply({ containerTotalNum: boxes.length, textObject: boxes })
      return
    }
    // split: transcript left, cards right. prep: prep full width, a short transcript strip at the bottom.
    const boxes = layout === 'prep'
      ? [this.text(4, 'intel', 0, 30, W, 188, intel, 0, 1), this.text(3, 'transcript', 0, 220, W, H - 220, transcript)]
      : [this.text(3, 'transcript', 0, 30, 300, H - 30, transcript), this.text(4, 'intel', 302, 30, W - 302, H - 30, intel, 0, 1)]
    await this.apply({
      containerTotalNum: 4,
      textObject: [this.text(1, 'evt', 0, 0, W, H, ' ', 1), this.text(2, 'status', 0, 0, W, 30, status), ...boxes],
    })
  }

  /** Throttled in-place updates for the live call (BLE is slow; ~150 ms/update). */
  updateCall(status: string, transcript: string, intel: string, layout: CallLayout = 'split', ticker = '') {
    if (this.screen?.kind !== 'call') return
    if (this.screen.layout !== layout) {
      const { onTap, onDouble, onStep } = this.screen
      void this.showCall({ onTap, onDouble, onStep }, status, transcript, intel, layout, ticker)
      return
    }
    this.pendingCall = { status, transcript, intel, ticker }
    if (this.callTimer !== null) return
    this.callTimer = window.setTimeout(() => {
      this.callTimer = null
      const next = this.pendingCall
      this.pendingCall = null
      if (!next || this.screen?.kind !== 'call' || !this.bridge) return
      const jobs: [number, string, string][] = []
      if (next.intel !== this.callText.intel) jobs.push([4, 'intel', next.intel])
      if (next.transcript !== this.callText.transcript) jobs.push([3, 'transcript', next.transcript])
      if (next.status !== this.callText.status) jobs.push([2, 'status', next.status])
      if (next.ticker !== this.callText.ticker && this.screen.layout === 'conv') jobs.push([5, 'ticker', next.ticker || ' '])
      this.callText = next
      for (const [id, name, content] of jobs) {
        const job = () => this.bridge!.textContainerUpgrade(new TextContainerUpgrade({ containerID: id, containerName: name, content: content.slice(0, 1900) }))
        this.renderQueue = this.renderQueue.then(job, job)
      }
    }, 250)
  }

  // ---------- input ----------
  handle(ev: GEvent, listIndex?: number) {
    const s = this.screen
    if (!s) return
    if (ev === 'up' || ev === 'down') {
      if (Date.now() - this.lastScroll < 300) return
      this.lastScroll = Date.now()
    }
    if (s.kind === 'list') {
      if (ev === 'tap') s.onPick(listIndex ?? 0)
      else if (ev === 'double') s.onBack ? s.onBack() : void this.bridge?.shutDownPageContainer(1)
    } else if (s.kind === 'pages') {
      if (ev === 'down' && s.page < s.pages.length - 1) { s.page++; void this.renderPage() }
      else if (ev === 'up' && s.page > 0) { s.page--; void this.renderPage() }
      else if (ev === 'tap' && s.onTap) { if (s.page < s.pages.length - 1) { s.page++; void this.renderPage() } else s.onTap() }
      else if (ev === 'double') s.onBack()
    } else if (s.kind === 'call') {
      if (ev === 'tap') s.onTap()
      else if (ev === 'double') s.onDouble()
      else if (ev === 'down') s.onStep(1)
      else if (ev === 'up') s.onStep(-1)
    }
  }

  get current() { return this.screen?.kind ?? null }
}

/** Normalize SDK events into simple gestures. CLICK_EVENT (0) often arrives as undefined. */
export function toGesture(event: any): { g: GEvent; index?: number } | null {
  const env = event.listEvent || event.textEvent || event.sysEvent
  if (!env) return null
  const t = env.eventType ?? OsEventTypeList.CLICK_EVENT
  const index = event.listEvent?.currentSelectItemIndex
  switch (t) {
    case OsEventTypeList.CLICK_EVENT: return { g: 'tap', index }
    case OsEventTypeList.DOUBLE_CLICK_EVENT: return { g: 'double' }
    case OsEventTypeList.SCROLL_TOP_EVENT: return { g: 'up' }
    case OsEventTypeList.SCROLL_BOTTOM_EVENT: return { g: 'down' }
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT: return { g: 'exit' }
    default: return null
  }
}
