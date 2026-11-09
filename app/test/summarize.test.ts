// Run: cd app && bun test
import { test, expect } from 'bun:test'
import { autoSummary, isGroup } from '../src/calls/summarize'
import type { Call, Segment } from '../src/types'

const call = (segs: [Segment['spk'], string][], extra: Partial<Call> = {}): Call => ({
  id: 't', startedAt: 0, endedAt: 60000, cards: [], ...extra,
  segments: segs.map(([spk, text], i) => ({ t: i * 1000, spk, text })),
})
const fu = (c: Call) => autoSummary(c, null).followUps.map(f => `${f.owner}: ${f.text}`)

test('describing how they work is not a follow-up', () => {
  const c = call([
    ['C', "you know, sometimes I'll go in and actually look at our inventory and see if it was shorted."],
    ['C', "Where we'll go through and look at the edits."],
    ['A', "I'll kick it off to you."],
  ])
  expect(fu(c)).toEqual([])
})

test('real promises are kept, with the due day', () => {
  const c = call([
    ['A', "I'll send you the testing data on Wednesday."],
    ['C', "I'll get back to you on the lot numbers by Friday."],
  ])
  const s = autoSummary(c, null)
  expect(s.followUps.map(f => f.owner)).toEqual(['Alan', 'Customer'])
  expect(s.followUps[0].due).toBe('Wednesday')
  expect(s.followUps.every(f => f.auto)).toBe(true)
})

test('group meeting: only your own promises count', () => {
  const c = call([
    ['A', "I'll send you the testing data on Wednesday."],
    ['C', "I'll get back to you on the lot numbers by Friday."],
  ], { group: true })
  expect(fu(c)).toEqual(["Alan: I'll send you the testing data on Wednesday."])
  expect(isGroup(c)).toBe(true)
})

test('prices and numbers keep their context', () => {
  const c = call([['C', "I hate to bring this up, but it's $89,000 in ground beef credits over the last three years."]])
  const s = autoSummary(c, null)
  expect(s.prices[0]).toContain('$89,000')
  expect(s.prices[0]).toContain('credits')
  expect(s.keyPoints?.some(k => k.includes('$89,000'))).toBe(true)
})

test('temperatures and decisions become key points', () => {
  const c = call([['C', "We are going to lower the ground beef cooler to 20 degrees during the summer months."]])
  expect(autoSummary(c, null).keyPoints?.[0]).toContain('20 degrees')
})
