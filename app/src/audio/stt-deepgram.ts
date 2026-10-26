// Streaming speech-to-text with Deepgram (WebSocket). New accounts get free credit
// that covers hundreds of hours of calls. Speaker diarization is on.
// Input: PCM s16le, 16 kHz, mono (exactly what the G2 mic delivers).

export interface SttWord { word: string; start: number; end: number; speaker?: number }
export interface SttResult {
  isFinal: boolean
  speechFinal: boolean
  text: string
  words: SttWord[] // times in ms, relative to call audio start
  connection: number
}

export interface SttOptions {
  apiKey: string
  keyterms: string[]
  onResult: (r: SttResult) => void
  onStatus: (s: 'connecting' | 'live' | 'reconnecting' | 'closed', detail?: string) => void
  onError: (e: string) => void
}

export interface SttClient {
  sendPcm(chunk: Uint8Array): void
  close(): void
}

export function startDeepgram(opts: SttOptions): SttClient {
  const params = new URLSearchParams({
    model: 'nova-3', language: 'en-US', encoding: 'linear16', sample_rate: '16000', channels: '1',
    interim_results: 'true', smart_format: 'true', punctuate: 'true', diarize: 'true',
    endpointing: '300', utterance_end_ms: '1200', vad_events: 'false',
  })
  for (const k of opts.keyterms.slice(0, 80)) params.append('keyterm', k)
  const url = `wss://api.deepgram.com/v1/listen?${params}`

  let ws: WebSocket | null = null
  let closed = false
  let connection = 0
  let connBaseMs = 0 // call-audio time at which the current socket started
  let sentMs = 0 // total call audio sent (ms)
  let backlog: Uint8Array[] = []
  let keepAlive: number | null = null
  let lastSend = Date.now()
  let retries = 0

  const connect = () => {
    if (closed) return
    opts.onStatus(connection === 0 ? 'connecting' : 'reconnecting')
    const sock = new WebSocket(url, ['token', opts.apiKey])
    sock.binaryType = 'arraybuffer'
    const myConn = ++connection
    sock.onopen = () => {
      retries = 0
      // flush audio captured while (re)connecting (cap ~20 s); Deepgram's clock
      // starts at the first byte we send on this socket.
      const flush = backlog.slice(-2000)
      const flushMs = flush.reduce((a, b) => a + (b.byteLength / 32000) * 1000, 0)
      connBaseMs = sentMs - flushMs
      connBases.set(myConn, connBaseMs)
      opts.onStatus('live')
      for (const b of flush) sendNow(sock, b)
      backlog = []
    }
    sock.onmessage = ev => {
      if (typeof ev.data !== 'string') return
      let msg: any
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0]
        if (!alt) return
        const base = connBaseMsAt(myConn)
        const words: SttWord[] = (alt.words || []).map((w: any) => ({
          word: w.punctuated_word || w.word,
          start: base + w.start * 1000,
          end: base + w.end * 1000,
          speaker: typeof w.speaker === 'number' ? myConn * 100 + w.speaker : undefined,
        }))
        opts.onResult({ isFinal: !!msg.is_final, speechFinal: !!msg.speech_final, text: alt.transcript || '', words, connection: myConn })
      } else if (msg.type === 'Error' || msg.err_code) {
        opts.onError(msg.description || msg.err_msg || 'Deepgram error')
      }
    }
    sock.onerror = () => { /* onclose handles retry */ }
    sock.onclose = ev => {
      if (ws === sock) ws = null
      if (closed) { opts.onStatus('closed'); return }
      if (ev.code === 1008 || ev.code === 4001 || ev.code === 4008) {
        opts.onError('Deepgram rejected the key (check Settings).')
        opts.onStatus('closed', 'auth')
        return
      }
      const delay = Math.min(15000, 800 * 2 ** retries++)
      opts.onStatus('reconnecting', `retry in ${Math.round(delay / 1000)}s`)
      setTimeout(connect, delay)
    }
    ws = sock
  }

  const connBases = new Map<number, number>()
  const connBaseMsAt = (c: number) => connBases.get(c) ?? connBaseMs

  const sendNow = (sock: WebSocket, b: Uint8Array) => {
    sock.send(b as unknown as ArrayBuffer)
    lastSend = Date.now()
  }

  keepAlive = window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastSend > 7000) {
      ws.send(JSON.stringify({ type: 'KeepAlive' }))
    }
  }, 4000)

  connect()

  return {
    sendPcm(chunk) {
      sentMs += (chunk.byteLength / 32000) * 1000
      if (ws && ws.readyState === WebSocket.OPEN) sendNow(ws, chunk)
      else { backlog.push(chunk); if (backlog.length > 4000) backlog.splice(0, 1000) }
    },
    close() {
      closed = true
      if (keepAlive !== null) clearInterval(keepAlive)
      try { ws?.send(JSON.stringify({ type: 'CloseStream' })) } catch { /* ignore */ }
      setTimeout(() => { try { ws?.close() } catch { /* ignore */ } }, 1500)
    },
  }
}
