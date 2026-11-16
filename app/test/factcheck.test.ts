import { test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { factCheck, attachAnswers, recallAnswer, learnAnswers } from '../src/calls/factcheck'
import { isQuestion } from '../src/intel/replies'

const beef = JSON.parse(readFileSync(new URL('../public/data/beef.json', import.meta.url), 'utf8'))
const m: any = { beef, market: null, news: null, loadedAt: 0, from: '' }
const call = (segs: [string, number, string][], qa: any[] = []) => ({ id: 'c', startedAt: 0, cards: [], qa, segments: segs.map(([spk, t, text]) => ({ spk, t, text })) }) as any

test('a wrong strip price gets corrected, a right one does not', () => {
  const c = call([['A', 0, 'Strips are running about $9.80 a pound right now.'], ['A', 5000, 'Strip loins are around $8.50 a pound.']])
  const out = factCheck(c, m, 'Choice')
  expect(out.length).toBe(1)
  expect(out[0]).toContain('$9.80')
  expect(out[0]).toContain('$8.46/lb')
})

test('per-cwt prices are understood, and the cutout is checked', () => {
  const c = call([['A', 0, 'Strips are at $844 this week.'], ['A', 3000, 'Choice cutout is sitting around 375 right now.']])
  const out = factCheck(c, m, 'Choice')
  expect(out.some(x => x.includes('cutout 375'))).toBe(true)
  expect(out.some(x => x.includes('$844'))).toBe(false)
})

test('your answer after a question is captured and recalled next time', () => {
  const c = call([['C', 1000, 'Are strips going lower for December?'], ['A', 4000, 'I think they ease another few cents into the first week of December.']],
    [{ t: 1000, q: 'Are strips going lower for December?', a: 'Strip ~$8.46/lb', src: 'data' }])
  const qa = attachAnswers(c)
  expect(qa[0].alan).toContain('ease another few cents')
  const learned = learnAnswers([], qa)
  expect(recallAnswer(learned, 'what about strips in December, lower?')?.alan).toContain('ease')
  expect(recallAnswer(learned, 'how is your weekend going')).toBeNull()
})

test('questions are spotted', () => {
  expect(isQuestion('Are strips going lower')).toBe(true)
  expect(isQuestion('We moved the feature to the 10th.')).toBe(false)
})
