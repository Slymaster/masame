// Named presets understood by the bundled KataGo. SGF RU is free text; keep the original
// label on the game even when the engine has to use Masame's default.
import type { Dict } from './i18n'

const presets = {
  japanese: 'japanese', korean: 'korean', chinese: 'chinese',
  chineseogs: 'chinese-ogs', chinesekgs: 'chinese-ogs',
  aga: 'aga', bga: 'aga', french: 'aga', agabutton: 'aga-button',
  nz: 'nz', newzealand: 'nz', ing: 'ing', goe: 'ing', tromptaylor: 'tromp-taylor',
  stonescoring: 'stone-scoring', ancientarea: 'stone-scoring', ancientterritory: 'ancient-territory',
} as const

function preset(raw?: string) {
  const key = raw?.trim().toLowerCase().replace(/\s+rules$/, '').replace(/[ _-]/g, '') ?? ''
  return Object.hasOwn(presets, key) ? presets[key as keyof typeof presets] : undefined
}

export const analysisRules = (raw?: string) => preset(raw) ?? 'japanese'

// The local adjudicator counts territory and prisoners. Other presets can still be reviewed by KataGo.
export function canCountLocally(raw?: string): boolean {
  if (!raw?.trim()) return true
  const rules = preset(raw)
  return rules === 'japanese' || rules === 'korean'
}

/** Preserve the keys of positions already analysed under Japanese rules in previous versions. */
export function rulesKey(raw?: string): string {
  const rules = analysisRules(raw)
  return rules === 'japanese' ? '' : `|rules=${rules}`
}

export function analysisRulesLabel(raw: string | undefined, d: Dict): string {
  const name = preset(raw)
  return raw?.trim() && !name ? d.rulesFallback(raw) : d.rules[name ?? 'japanese']
}
