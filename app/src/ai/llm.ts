// Optional AI. Off by default; the app works fully without it.
// - "openai-compatible": Google Gemini (free tier), Groq (free tier), OpenRouter, etc.
// - "anthropic": Claude API (paid, separate from a Claude subscription)
import type { Settings } from '../types'

export function aiEnabled(s: Settings) {
  return s.aiProvider !== 'none' && !!s.aiKey && !!s.aiModel
}

export async function aiComplete(s: Settings, prompt: string, maxTokens = 1200): Promise<string> {
  if (!aiEnabled(s)) throw new Error('AI is not set up')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000)
  try {
    if (s.aiProvider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': s.aiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: s.aiModel, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error?.message || `AI error ${r.status}`)
      return (j.content || []).map((c: any) => c.text || '').join('').trim()
    }
    const base = s.aiBaseUrl.replace(/\/$/, '')
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.aiKey}` },
      body: JSON.stringify({ model: s.aiModel, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j?.error?.message || `AI error ${r.status}`)
    return String(j.choices?.[0]?.message?.content || '').trim()
  } finally {
    clearTimeout(timer)
  }
}

export const AI_PRESETS: { label: string; provider: Settings['aiProvider']; baseUrl: string; model: string; host: string }[] = [
  { label: 'Google Gemini (free tier)', provider: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', host: 'https://generativelanguage.googleapis.com' },
  { label: 'Groq (free tier)', provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', host: 'https://api.groq.com' },
  { label: 'Claude API (paid)', provider: 'anthropic', baseUrl: '', model: '', host: 'https://api.anthropic.com' },
]
