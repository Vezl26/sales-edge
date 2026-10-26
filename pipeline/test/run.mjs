import { readFileSync } from 'node:fs'
import { parseBoxedBeefText, parseSlaughterText, boxedBeefLooksValid } from '../parse-usda.mjs'
const b = parseBoxedBeefText(readFileSync(new URL('./fixture_2453.txt', import.meta.url), 'utf8'))
console.log(JSON.stringify({ d: b.reportDate, cutout: b.cutout, primals: b.primals.length, hist: b.cutoutHistory, vol: b.volume }, null, 0))
console.table(b.cuts); console.table(b.ground); console.table(b.trim)
console.log('valid', boxedBeefLooksValid(b))
const s = parseSlaughterText(`Report for September 23, 2025 - Final\n Prev Week Last Year\nCattle      121,000   121,000  127,448   231,000   231,000   245,607  21,318,398  22,939,246   -7.1%\nCalves        1,000     1,000    2,121     2,000     2,000     3,868     238,000     298,001   -20.1%`)
console.log(JSON.stringify(s))
