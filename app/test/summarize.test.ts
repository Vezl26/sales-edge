// Run: cd app && bun test
import { test, expect, describe } from 'bun:test'
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

describe('internal calls and loose keywords', () => {
  const mk = (lines: [string, string][], extra: any = {}) => ({
    id: 'i', startedAt: 0, endedAt: 600000, cards: [], ...extra,
    segments: lines.map(([spk, text], i) => ({ t: i * 5000, spk: spk as 'A' | 'C', text })),
  }) as any

  test('a catch-up with the boss is internal, with no customer needs and no "Address:" filler', () => {
    const call = mk([
      ['C', 'Let me know what you need and we should catch up soon.'],
      ['A', 'I congratulated her on the new role because she is our boss.'],
      ['C', 'In this role you will have some slow days, that is normal and you get better at it.'],
      ['C', 'You can get more aggressive on costing because you can take cost out of the contract.'],
      ['C', 'Remember that case ready formulas are a USDA driver plus a spread over the market.'],
    ])
    const s = autoSummary(call)
    expect(s.headline).toContain('Internal call')
    expect(s.customerNeeds).toEqual([])
    expect(s.talkingPointsNext.some(x => x.startsWith('Address'))).toBe(false)
    expect(s.keyPoints!.join(' ')).toContain('costing')
  })

  test('meta talk is not a customer need, and one stray word is not a topic', () => {
    const call = mk([
      ['C', 'I want to give you an update on what we need to talk about later.'],
      ['A', 'Sounds good, I had a long weekend and the ham sandwich was great.'],
      ['C', 'We need 2,000 lb of 80/20 chubs by Thursday or we will run short on grind.'],
    ], { customerName: 'Test Co' })
    const s = autoSummary(call)
    expect(s.customerNeeds.join(' ')).toContain('2,000')
    expect(s.customerNeeds.join(' ')).not.toContain('talk about')
    expect(s.topics).not.toContain('Deli')
    expect(s.topics).not.toContain('Promotions & features')
  })

  test('picking internal by hand wins over the guess', () => {
    const call = mk([['A', 'Quote them $4.10 a pound for the chubs tomorrow morning please.']], { customerName: 'X', internal: false })
    expect(autoSummary(call).headline).not.toContain('Internal')
  })
})
