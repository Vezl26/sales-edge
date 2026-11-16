import { test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { tickerText } from '../src/intel/ticker'

const beef = JSON.parse(readFileSync(new URL('../public/data/beef.json', import.meta.url), 'utf8'))

test('cutout on top, then cuts by how often they came up', () => {
  const m = new Map([
    ['114', { n: 1, last: 3 }],   // clod, once
    ['112A', { n: 3, last: 1 }],  // ribeye, three times
    ['168', { n: 1, last: 5 }],   // top round, once but most recent
  ])
  const lines = tickerText(m, beef, 'Choice').split('\n')
  expect(lines[0]).toStartWith('Choice')
  expect(lines[1]).toStartWith('Ribeye')
  expect(lines[2]).toStartWith('TopRnd')
  expect(lines[3]).toStartWith('Clod')
})

test('keeps only the top cuts when many are mentioned', () => {
  const ids = ['112A', '114', '168', '180', '189A', '120', '167A', '184', '185C', '116A']
  const m = new Map(ids.map((id, i) => [id, { n: i === 9 ? 5 : 1, last: i }]))
  const lines = tickerText(m, beef, 'Choice', 7).split('\n')
  expect(lines.length).toBe(7)
  expect(lines[1]).toStartWith('ChkRoll')
})
