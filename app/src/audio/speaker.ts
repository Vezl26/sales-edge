// "Who is talking" without voiceprints.
// The G2 mics sit on Alan's face, so his voice arrives much louder than the
// customer's. We measure loudness per 10 ms frame and combine it with the speech
// service's diarization (speaker 0/1/...) to label each line Alan vs Customer.

const FRAME_MS = 10
const SAMPLES_PER_FRAME = 160 // 16 kHz

export class EnergyTracker {
  private frames: number[] = [] // dBFS per 10ms frame, indexed by audio time
  private carry: number[] = []

  /** Push raw PCM s16le mono 16 kHz. */
  push(pcm: Uint8Array) {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    for (let i = 0; i + 1 < pcm.byteLength; i += 2) {
      this.carry.push(view.getInt16(i, true))
      if (this.carry.length === SAMPLES_PER_FRAME) {
        let sum = 0
        for (const s of this.carry) sum += s * s
        const rms = Math.sqrt(sum / SAMPLES_PER_FRAME) / 32768
        this.frames.push(rms > 0 ? 20 * Math.log10(rms) : -100)
        this.carry = []
      }
    }
    // keep ~2 hours max
    if (this.frames.length > 720_000) this.frames.splice(0, 100_000)
  }

  get durationMs() { return this.frames.length * FRAME_MS }

  /** Loudness of the voiced part of [startMs, endMs]: mean of the loudest half of frames. */
  dbBetween(startMs: number, endMs: number): number | null {
    const a = Math.max(0, Math.floor(startMs / FRAME_MS))
    const b = Math.min(this.frames.length, Math.ceil(endMs / FRAME_MS))
    if (b - a < 3) return null
    const xs = this.frames.slice(a, b).sort((x, y) => y - x)
    const top = xs.slice(0, Math.max(2, Math.floor(xs.length / 2)))
    return top.reduce((s, v) => s + v, 0) / top.length
  }

  /** Median loudness of voiced frames (used for the one-time voice check). */
  voicedMedian(): number | null {
    const v = this.frames.filter(d => d > -50).sort((x, y) => x - y)
    if (v.length < 50) return null
    return v[Math.floor(v.length * 0.6)]
  }

  reset() { this.frames = []; this.carry = [] }
}

export type Label = 'A' | 'C' | '?'

export class SpeakerMapper {
  private stats = new Map<number, { sum: number; n: number }>()
  constructor(private alanLevelDb: number | null) {}

  observe(dz: number, db: number | null) {
    if (db == null) return
    const s = this.stats.get(dz) || { sum: 0, n: 0 }
    s.sum += db; s.n += 1
    this.stats.set(dz, s)
  }

  private avg(dz: number) {
    const s = this.stats.get(dz)
    return s && s.n ? s.sum / s.n : null
  }

  /** Label for one line, given its diarization id and measured loudness. */
  label(dz: number | undefined, db: number | null): Label {
    const lvl = this.alanLevelDb
    const dzAvg = dz !== undefined ? this.avg(dz) : null
    // 1) diarization groups with enough data: loudest group is Alan
    const groups = [...this.stats.entries()].filter(([, s]) => s.n >= 6).map(([id, s]) => ({ id, a: s.sum / s.n }))
    if (dz !== undefined && groups.length >= 2) {
      groups.sort((x, y) => y.a - x.a)
      if (groups[0].a - groups[1].a >= 3) return groups[0].id === dz ? 'A' : 'C'
    }
    // 2) calibrated voice level
    const ref = dzAvg ?? db
    if (lvl != null && ref != null) return ref >= lvl - 7 ? 'A' : 'C'
    // 3) absolute heuristic: close-talk speech at the glasses is loud
    if (ref != null) {
      if (ref > -24) return 'A'
      if (ref < -36) return 'C'
    }
    return '?'
  }
}
