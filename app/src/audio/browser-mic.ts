// Computer/phone-browser microphone for testing outside the Even app.
// Produces the same format as the G2: PCM s16le, 16 kHz, mono, ~100 ms chunks.
export async function startBrowserMic(onPcm: (pcm: Uint8Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const ratio = ctx.sampleRate / 16000
  let pos = 0
  proc.onaudioprocess = e => {
    const input = e.inputBuffer.getChannelData(0)
    const outLen = Math.floor((input.length - pos) / ratio)
    const out = new Int16Array(Math.max(0, outLen))
    for (let i = 0; i < outLen; i++) {
      const s = input[Math.floor(pos + i * ratio)]
      out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)))
    }
    pos = (pos + outLen * ratio) - input.length
    if (pos < 0) pos = 0
    onPcm(new Uint8Array(out.buffer))
  }
  src.connect(proc)
  proc.connect(ctx.destination)
  return () => {
    proc.disconnect(); src.disconnect()
    stream.getTracks().forEach(t => t.stop())
    void ctx.close()
  }
}
