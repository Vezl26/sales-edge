import './styles.css'
import * as SDK from '@evenrealities/even_hub_sdk'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { Store, localKV, type KV } from './store'
import { Glasses, toGesture } from './glasses/ui'
import { App, type Mic } from './app'
import { PhoneUI } from './phone/ui'
import { startBrowserMic } from './audio/browser-mic'
import type { Call } from './types'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

const sdk = SDK as unknown as {
  AudioInputSource?: { Glasses: string; Phone: string }
  setBackgroundState?: (key: string, fn: () => Record<string, unknown>) => void
  onBackgroundRestore?: (key: string, fn: (saved: Record<string, unknown>) => void) => void
}

async function getBridge(): Promise<Bridge | null> {
  const timeout = new Promise<null>(r => setTimeout(() => r(null), 3000))
  try { return await Promise.race([waitForEvenAppBridge(), timeout]) } catch { return null }
}

async function boot() {
  const bridge = await getBridge()
  const kv: KV = bridge
    ? { get: async k => (await bridge.getLocalStorage(k)) ?? '', set: (k, v) => bridge.setLocalStorage(k, v) }
    : localKV()
  const store = new Store(kv)
  const glasses = new Glasses(bridge)

  let app: App
  let stopBrowserMic: (() => void) | null = null
  const mic: Mic = {
    async open(source) {
      if (bridge) {
        const src = source === 'phone' ? sdk.AudioInputSource?.Phone ?? 'phone' : sdk.AudioInputSource?.Glasses ?? 'glasses'
        try { return await (bridge.audioControl as (o: boolean, s?: unknown) => Promise<boolean>)(true, src) } catch { return false }
      }
      // Desktop/browser preview: use the computer mic
      try { stopBrowserMic = await startBrowserMic(pcm => app.onPcm(pcm)); return true } catch { return false }
    },
    async close() {
      if (bridge) { try { await bridge.audioControl(false) } catch { /* ignore */ } }
      stopBrowserMic?.(); stopBrowserMic = null
    },
  }

  app = new App(store, glasses, mic)
  new PhoneUI(app)

  // Keep a live call alive when the Even app moves us to the background.
  sdk.setBackgroundState?.('call', () => (app.session ? { call: app.session.snapshot() } : {}))
  let ready = false
  let pendingResume: Call | null = null
  sdk.onBackgroundRestore?.('call', saved => {
    const call = (saved as { call?: Call }).call
    if (!call) return
    if (ready) void app.resumeCall(call)
    else pendingResume = call
  })

  if (bridge) {
    bridge.onEvenHubEvent(ev => {
      const pcm = ev.audioEvent?.audioPcm
      if (pcm) { app.onPcm(pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm as ArrayLike<number>)); return }
      const g = toGesture(ev)
      if (!g) return
      if (g.g === 'exit') { if (app.session) void app.endCall(); return }
      glasses.handle(g.g, g.index)
    })
  }

  await app.init()
  ready = true
  if (pendingResume) await app.resumeCall(pendingResume)
  else if (!app.session) await app.showHome()
}

boot().catch(err => {
  console.error(err)
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;padding:16px">Startup error: ${String(err?.message || err)}</pre>`)
})
