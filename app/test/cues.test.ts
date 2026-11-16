import { test, expect } from 'bun:test'
;(globalThis as any).window ??= globalThis
import { CallSession } from '../src/calls/session'
import { Prompter } from '../src/prep/prompter'
import { DEFAULT_SETTINGS } from '../src/types'

const store: any = { get: async (_k: string, d: any) => d, set: async () => {}, del: async () => {} }
const engine: any = { reset() {}, ingest: () => [], customerCard: () => null, onCustomer: null }
const mk = () => new CallSession(store, { ...DEFAULT_SETTINGS, sttProvider: 'none' }, engine, null, [])
const card = (k: string) => ({ kind: 'price', key: k, title: k, glass: k, phone: k, at: 0 }) as any

test('a new cue opens on its own and closes with a tap', () => {
  const s = mk()
  s.addCard(card('strip'))
  expect(s.cueOpen).toBe(true)
  expect(s.tap()).toBe(true)
  expect(s.cueOpen).toBe(false)
  expect(s.tap()).toBe(false) // nothing open and no prep: the app pauses instead
})

test('with auto pop-up off, the cue waits for a tap', () => {
  const s = mk(); s.autoPopup = false
  s.addCard(card('brisket'))
  expect(s.cueOpen).toBe(false)
  expect(s.cuePending).toBe(true)
  s.tap()
  expect(s.cueOpen).toBe(true)
})

test('tap shows the notes, swipe walks the prep; without notes, swipe flips back through cues', () => {
  const s = mk()
  s.prompter = new Prompter({ id: 'p', notes: '## Slide 1\n- one point here\n- two point here' } as any)
  s.tap()
  expect(s.notesOpen).toBe(true)
  s.swipe(1)
  expect(s.prompter.idx).toBe(1)
  s.tap()
  s.addCard(card('a')); s.addCard(card('b')); s.tap()
  s.swipe(-1)
  expect(s.cue?.key).toBe('b')
  s.swipe(-1)
  expect(s.cue?.key).toBe('a')
})
