// Built-in reference points for common meeting topics. General USDA/FSIS guidance only:
// Alan's own company specs and documents (Data tab) always come first in prep.
export interface Reference { id: string; keys: RegExp; title: string; points: string[]; source: string }

export const REFERENCES: Reference[] = [
  {
    id: 'ground-beef-handling',
    keys: /\b(ground beef|grind|chubs?|patties|hamburger|burger|81\/19|80\/20|93\/7|73\/27)\b/i,
    title: 'Ground beef: handling & color (USDA FSIS)',
    points: [
      'Hold refrigerated at 40°F or below; keep frozen at 0°F.',
      'FSIS consumer guidance: use fresh ground beef within 1–2 days or freeze it.',
      'Danger zone 40–140°F: no more than 2 hours out (1 hour above 90°F).',
      'Red surface = oxymyoglobin (air). Gray/brown inside a package is normal (no oxygen), not spoilage by itself.',
      'Brown throughout after long or warm storage (metmyoglobin) is a temperature/age flag, so check the cold chain and dates.',
      'Spoilage signs: sour odor, sticky or tacky surface, not color alone.',
      'Cook to 160°F internal (thermometer); color is not a doneness indicator.',
      'Thaw in the refrigerator, cold water, or microwave, never on the counter.',
    ],
    source: 'USDA FSIS ground beef and food safety guidance',
  },
  {
    id: 'cold-chain',
    keys: /\b(temp(erature)?|cold chain|warm|reefer|truck|delivery|receiving|shrink|purge|leak(er|ing)?|claim|credit|complaint|recall|quality issue)\b/i,
    title: 'Cold chain & quality-claim checklist',
    points: [
      'Get the facts: product, lot/pack date, PO, delivery date, how many cases.',
      'Receiving temp logged? Reefer temp at delivery? Product temp now?',
      'Where it was held (walk-in temp), how long before it was opened or displayed.',
      'Photos of the product, labels and case codes before anything is thrown out.',
      'Agree on next steps and owners: credit, replacement, root cause, follow-up date.',
    ],
    source: 'General sales practice (not a regulation)',
  },
]

export function referencesFor(text: string): Reference[] {
  return REFERENCES.filter(r => r.keys.test(text))
}
