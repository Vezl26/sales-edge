import { test, expect } from 'bun:test'
import { Prompter } from '../src/prep/prompter'

const notes = `## Slide 1 - Intro
- Quick weekly market read, about 5 minutes
- Then I want to hear what you're seeing

## Slide 2a - What to know
- Cash cattle: no trade yet, packers well supplied
- Choice $359.84, Select $350.14
- Steers 995 lb, heifers 903 lb

## Slide 4 - Cutout outlook
- About $348 by Dec 9, then flat`
const mk = () => new Prompter({ id: 'p', notes } as any)

test('shows one slide at a time with the current point marked', () => {
  const v = mk().view()
  expect(v.split('\n')[0]).toContain('SLIDE 1 - INTRO')
  expect(v).toContain('▶ Quick weekly market read')
  expect(v).not.toContain('Cash cattle')
  expect(v).toContain('Next: Slide 2a - What to know')
})

test('swipe goes through points in order, across slides', () => {
  const p = mk()
  p.step(1); p.step(1)
  expect(p.view()).toContain('▶ Cash cattle')
  expect(p.view()).toContain('2/3')
  p.step(-1)
  expect(p.view()).toContain("▶ Then I want to hear")
})

test('talking about a later point checks it off without jumping the screen', () => {
  const p = mk()
  p.ingest('steers are 995 lb and heifers 903 lb this week')
  expect(p.view()).toContain('▶ Quick weekly market read')
  expect(p.done).toBe(1)
})
