// Spoken-name lexicon for USDA boxed beef cuts (IMPS numbers as used in LM_XB403).
// Each entry lists how people actually say the cut on a call.

export interface CutLex {
  imps: string
  label: string // short name for the glasses
  names: string[] // spoken phrases (lowercase)
  primal: 'Rib' | 'Chuck' | 'Round' | 'Loin' | 'Brisket' | 'Plate' | 'Flank'
}

export const CUTS: CutLex[] = [
  { imps: '109E', label: 'Ribeye lip-on bone-in', primal: 'Rib', names: ['lip on', 'lip-on', 'bone in ribeye', 'bone-in ribeye', 'export rib', 'export ribs', 'rib lip on', '109'] },
  { imps: '112A', label: 'Ribeye boneless', primal: 'Rib', names: ['ribeye', 'rib eye', 'ribeyes', 'rib eyes', 'boneless rib', 'boneless ribeye', 'rib roll', 'delmonico', '112'] },
  { imps: '114', label: 'Shoulder clod', primal: 'Chuck', names: ['shoulder clod', 'clod', 'clods'] },
  { imps: '114A', label: 'Clod trimmed', primal: 'Chuck', names: ['trimmed clod', 'clod trimmed'] },
  { imps: '114D', label: 'Top blade', primal: 'Chuck', names: ['top blade', 'top blades', 'flat iron', 'flat irons'] },
  { imps: '114E', label: 'Clod arm roast', primal: 'Chuck', names: ['arm roast', 'clod arm', 'arm roasts'] },
  { imps: '114F', label: 'Clod tender', primal: 'Chuck', names: ['clod tender', 'teres major', 'shoulder tender', 'petite tender'] },
  { imps: '116A', label: 'Chuck roll', primal: 'Chuck', names: ['chuck roll', 'chuck rolls', 'chuck eye roll'] },
  { imps: '116B', label: 'Chuck tender', primal: 'Chuck', names: ['chuck tender', 'mock tender', 'chuck tenders'] },
  { imps: '916A', label: 'Chuck roll retail-ready', primal: 'Chuck', names: ['retail ready chuck', 'retail-ready chuck', 'chuck roll retail', '916'] },
  { imps: '116G', label: 'Chuck flap', primal: 'Chuck', names: ['chuck flap', 'chuck flaps'] },
  { imps: '120', label: 'Brisket deckle-off', primal: 'Brisket', names: ['brisket', 'briskets', 'packer brisket', 'deckle off', 'deckle-off'] },
  { imps: '120A', label: 'Brisket point-off (flat)', primal: 'Brisket', names: ['brisket flat', 'brisket flats', 'point off', 'point-off', 'flat brisket'] },
  { imps: '123A', label: 'Plate short rib', primal: 'Plate', names: ['plate short rib', 'plate short ribs', 'plate ribs', 'dino ribs', 'dino rib'] },
  { imps: '130', label: 'Chuck short rib', primal: 'Chuck', names: ['chuck short rib', 'chuck short ribs', 'short rib', 'short ribs'] },
  { imps: '161', label: 'Round boneless', primal: 'Round', names: ['boneless round', 'round boneless'] },
  { imps: '167A', label: 'Knuckle peeled', primal: 'Round', names: ['knuckle', 'knuckles', 'sirloin tip', 'sirloin tips', 'peeled knuckle'] },
  { imps: '168', label: 'Top inside round', primal: 'Round', names: ['inside round', 'inside rounds', 'top round', 'top rounds', 'top inside'] },
  { imps: '169', label: 'Inside round denuded', primal: 'Round', names: ['denuded inside', 'denuded round', 'inside denuded'] },
  { imps: '169A', label: 'Inside round cap-off', primal: 'Round', names: ['cap off inside', 'cap-off inside', 'inside cap off'] },
  { imps: '170', label: 'Bottom gooseneck', primal: 'Round', names: ['gooseneck', 'goosenecks', 'bottom round'] },
  { imps: '171B', label: 'Outside round (flat)', primal: 'Round', names: ['outside round', 'outside rounds', 'outside flat', 'bottom flat', 'bottom round flat'] },
  { imps: '171C', label: 'Eye of round', primal: 'Round', names: ['eye of round', 'eye round', 'eye rounds', 'eyes of round'] },
  { imps: '174', label: 'Short loin 0x1', primal: 'Loin', names: ['short loin', 'short loins', 'porterhouse', 't-bone', 't bone', 't-bones'] },
  { imps: '175', label: 'Strip loin bone-in', primal: 'Loin', names: ['bone in strip', 'bone-in strip', 'strip 1x1', '175'] },
  { imps: '180', label: 'Strip loin boneless 0x1', primal: 'Loin', names: ['strip loin', 'striploin', 'strip loins', 'striploins', 'strips', 'strip', 'new york strip', 'ny strip', 'new york', 'kansas city strip', 'boneless strip', '0x1'] },
  { imps: '184', label: 'Top butt boneless', primal: 'Loin', names: ['top butt', 'top butts', 'top sirloin', 'sirloin butt', 'top sirloin butt', 'sirloin'] },
  { imps: '184B', label: 'Top butt center-cut', primal: 'Loin', names: ['center cut top butt', 'center-cut top butt', 'cc top butt', 'center cut sirloin', 'center-cut sirloin'] },
  { imps: '185A', label: 'Bottom sirloin flap', primal: 'Loin', names: ['flap meat', 'sirloin flap', 'bavette', 'flap', 'flaps', 'bottom sirloin flap'] },
  { imps: '185B', label: 'Ball tip', primal: 'Loin', names: ['ball tip', 'ball tips', 'ball-tip'] },
  { imps: '185C', label: 'Tri-tip', primal: 'Loin', names: ['tri tip', 'tri-tip', 'tritip', 'tri tips', 'tri-tips'] },
  { imps: '185D', label: 'Tri-tip peeled', primal: 'Loin', names: ['peeled tri tip', 'peeled tri-tip', 'tri tip peeled'] },
  { imps: '189A', label: 'Tenderloin trimmed', primal: 'Loin', names: ['tenderloin', 'tenderloins', 'tender loin', 'psmo', 'filet', 'filets', 'filet mignon', 'fillet', 'tenders'] },
  { imps: '191A', label: 'Butt tender', primal: 'Loin', names: ['butt tender', 'butt tenders', 'butt tenderloin'] },
  { imps: '193', label: 'Flank steak', primal: 'Flank', names: ['flank', 'flanks', 'flank steak', 'flank steaks'] },
]

const ONES: Record<string, number> = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** "one eighty nine a" -> "189a", "nine sixteen a" -> "916a". Leaves other text alone. */
export function spokenNumbersToDigits(text: string): string {
  const words = text.toLowerCase().replace(/-/g, ' ').split(/\s+/)
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^a-z0-9]/g, '')
    if ((w === 'one' || w === 'nine') && i + 1 < words.length) {
      const lead = ONES[w]
      const n1 = words[i + 1].replace(/[^a-z]/g, '')
      let two: number | null = null
      let used = 1
      if (TEENS[n1] !== undefined) two = TEENS[n1]
      else if (TENS[n1] !== undefined) {
        two = TENS[n1]
        const n2 = (words[i + 2] || '').replace(/[^a-z]/g, '')
        if (ONES[n2] !== undefined && ONES[n2] > 0 && n2 !== 'o' && n2 !== 'oh') { two += ONES[n2]; used = 2 }
      } else if ((n1 === 'oh' || n1 === 'o') && ONES[(words[i + 2] || '').replace(/[^a-z]/g, '')] !== undefined) {
        two = ONES[(words[i + 2] || '').replace(/[^a-z]/g, '')]; used = 2
      }
      if (two !== null) {
        let code = `${lead}${String(two).padStart(2, '0')}`
        const suf = (words[i + 1 + used] || '').replace(/[^a-z]/g, '')
        if (/^[a-g]$/.test(suf) && CUTS.some(c => c.imps === `${code}${suf.toUpperCase()}`)) {
          code += suf; used += 1
        }
        out.push(code)
        i += used
        continue
      }
    }
    out.push(words[i])
  }
  return out.join(' ')
}

export interface CutHit { imps: string; phrase: string; index: number }

const UNIT_AFTER = /^\s*(cases?|lbs?|pounds?|loads?|boxes?|pallets?|dollars?|bucks|cents?|percent|%|head|units?)\b/i

let compiled: { re: RegExp; imps: string; phrase: string; len: number }[] | null = null
function compile() {
  if (compiled) return compiled
  compiled = []
  for (const c of CUTS) {
    for (const n of c.names) {
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+')
      compiled.push({ re: new RegExp(`(^|[^a-z0-9])(${esc})(?=$|[^a-z0-9])`, 'gi'), imps: c.imps, phrase: n, len: n.length })
    }
  }
  compiled.sort((a, b) => b.len - a.len) // prefer longest phrase
  return compiled
}

/** Find beef cuts mentioned in a chunk of transcript. */
export function findCuts(rawText: string): CutHit[] {
  const text = spokenNumbersToDigits(rawText)
  const hits: CutHit[] = []
  const taken: [number, number][] = []
  for (const { re, imps, phrase } of compile()) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length
      const end = start + m[2].length
      if (taken.some(([a, b]) => start < b && end > a)) continue
      // bare IMPS numbers: ignore "180 cases" / "112 pounds"
      if (/^\d/.test(phrase) && UNIT_AFTER.test(text.slice(end))) continue
      taken.push([start, end])
      hits.push({ imps, phrase: m[2], index: start })
    }
  }
  // bare codes like "189a" / "180" that are not in the names list
  for (const m of text.matchAll(/(^|[^0-9.$])(1(?:09|12|14|16|20|23|30|61|67|68|69|70|71|74|75|80|84|85|89|91|93)[a-g]?|916a?)(?=$|[^0-9a-z])/gi)) {
    const start = (m.index ?? 0) + m[1].length
    const end = start + m[2].length
    if (taken.some(([a, b]) => start < b && end > a)) continue
    if (UNIT_AFTER.test(text.slice(end))) continue
    const code = m[2].toUpperCase()
    const lex = CUTS.find(c => c.imps === code) || CUTS.find(c => c.imps.startsWith(code.replace(/[A-G]$/, '')) && code.length === 3)
    if (!lex) continue
    taken.push([start, end])
    hits.push({ imps: lex.imps, phrase: m[2], index: start })
  }
  return hits.sort((a, b) => a.index - b.index)
}

export const lexFor = (imps: string) => CUTS.find(c => c.imps === imps)

/** Phrases worth biasing the speech recognizer toward. */
export function recognizerKeyterms(extra: string[] = []): string[] {
  const base = ['strip loin', 'striploin', 'ribeye', 'tenderloin', 'chuck roll', 'brisket', 'top butt', 'tri-tip',
    'ball tip', 'flap meat', 'knuckle', 'inside round', 'outside round', 'eye of round', 'gooseneck', 'clod',
    'top blade', 'chuck tender', 'short rib', 'flank steak', 'cutout', 'Choice', 'Select', 'Prime', 'USDA',
    'boxed beef', 'fed cattle', 'slaughter', 'carcass', 'deli', 'chubs', 'trim', '81/19', 'Cargill', 'CAB', 'Angus']
  return [...new Set([...base, ...extra.filter(Boolean)])].slice(0, 90)
}
