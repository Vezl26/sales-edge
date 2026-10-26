// Persistent storage. Inside the Even app, the bridge key-value store is the only
// storage that survives restarts (browser localStorage is wiped). Large values are
// split into chunks. Outside the Even app (desktop browser testing) it falls back
// to localStorage.

export interface KV {
  get(key: string): Promise<string>
  set(key: string, value: string): Promise<boolean>
}

const CHUNK = 60_000
const PREFIX = 'se1:'

export class Store {
  private cache = new Map<string, string>()
  constructor(private kv: KV) {}

  async getRaw(key: string): Promise<string> {
    if (this.cache.has(key)) return this.cache.get(key)!
    const k = PREFIX + key
    const head = await this.kv.get(k)
    let value = ''
    const m = head.match(/^@chunks:(\d+)$/)
    if (m) {
      const n = Number(m[1])
      const parts = await Promise.all(Array.from({ length: n }, (_, i) => this.kv.get(`${k}#${i}`)))
      value = parts.join('')
    } else {
      value = head
    }
    this.cache.set(key, value)
    return value
  }

  async setRaw(key: string, value: string): Promise<void> {
    this.cache.set(key, value)
    const k = PREFIX + key
    if (value.length <= CHUNK) {
      await this.kv.set(k, value)
      return
    }
    const n = Math.ceil(value.length / CHUNK)
    for (let i = 0; i < n; i++) await this.kv.set(`${k}#${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK))
    await this.kv.set(k, `@chunks:${n}`)
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.getRaw(key)
    if (!raw) return fallback
    try { return JSON.parse(raw) as T } catch { return fallback }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.setRaw(key, JSON.stringify(value))
  }

  async del(key: string): Promise<void> {
    await this.setRaw(key, '')
  }
}

export function localKV(): KV {
  return {
    async get(key) { try { return localStorage.getItem(key) ?? '' } catch { return '' } },
    async set(key, value) { try { localStorage.setItem(key, value); return true } catch { return false } },
  }
}
