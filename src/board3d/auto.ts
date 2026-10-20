// "Auto" décor: the room that suits the season and the hour, and the ready-made décor + stones couples (ambiances).
// Pure, no three.js, no network. Covered by auto.test.ts.

import type { Decor } from './decors'
import { readySets, type StoneSet } from './stoneSets'
import { readyDecors, sunOn } from './logic'
import { isReadyShape, type GobanShape } from './gobans'

// only what is ready: a listed id whose files have not landed yet is never chosen
const isDecor = (d: string): d is Decor => (readyDecors() as readonly string[]).includes(d)
const isStones = (s: string): s is StoneSet => (readySets() as readonly string[]).includes(s)

/**
 * The décor "Auto" picks, by the sun's hour (sunOn: noon at 12, sunrise 12 − halfDay, sunset 12 + halfDay):
 * a classic → Honinbo; Dec–Feb from sunset to 6 h → snow night; 20 March–April by day → hanami; ±1 h of sunrise → above
 * the clouds; June–August afternoon → bamboo; else the Atelier. A rule whose décor doesn't exist yet gives way to the next.
 */
export function autoDecor(date: Date, hour = sunOn(date).hour, ctx: { classic?: boolean } = {}): Decor {
  const { halfDay: D } = sunOn(date), m = date.getMonth(), rise = 12 - D, set = 12 + D
  const rules: [boolean, string][] = [
    [!!ctx.classic, 'honinbo'],
    [(m === 11 || m <= 1) && (hour >= set || hour < 6), 'neige'],
    [(m === 3 || (m === 2 && date.getDate() >= 20)) && hour >= rise && hour < set, 'hanami'],
    [Math.abs(hour - rise) <= 1, 'nuages'],
    [m >= 5 && m <= 7 && hour >= 12 && hour < set, 'bambous'],
  ]
  return (rules.find(([on, d]) => on && isDecor(d))?.[1] as Decor | undefined) ?? 'atelier'
}

/** Ready-made couples: one click sets the décor and the stones (the two existing settings). The first stone set that
 *  exists is used: Nuit blanche takes the moon stones once they land, the Japanese ones until then. One entry per line. */
export const AMBIANCES = [
  { id: 'jardin', decor: 'bambous', stones: ['jade'] },
  { id: 'nuitBlanche', decor: 'neige', stones: ['lune', 'japonaise'] },
  { id: 'hanok', decor: 'hanok', stones: ['coreennes'] },
  { id: 'pavillon', decor: 'pavillon', stones: ['yunzi'] },
  { id: 'edo', decor: 'honinbo', stones: ['japonaise'], goban: 'ashi' },
] as const
export type AmbianceId = typeof AMBIANCES[number]['id']

/** The ambiances whose décor and stones both exist, resolved. */
export function ambiances(locked: ReadonlySet<string> = new Set()): { id: AmbianceId; decor: Decor; stones: StoneSet; goban?: GobanShape }[] {
  return AMBIANCES.flatMap(a => {
    const goban = 'goban' in a && isReadyShape(a.goban) ? a.goban : undefined // a mood may stand its board too (Edo: the legged goban)
    const stones = (a.stones as readonly string[]).find((s): s is StoneSet => isStones(s) && !locked.has(s)) // an earned set not earned yet gives way
    return isDecor(a.decor) && stones ? [{ id: a.id, decor: a.decor, stones, ...(goban && { goban }) }] : []
  })
}
