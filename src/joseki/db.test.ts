import { describe, expect, it } from 'vitest'
import { RANKS } from '../bot'
import { children, nearestProfile, reach, validate, type JosekiDb } from './db'
import fixture from './fixture.json'

const copy = () => structuredClone(fixture) as unknown as JosekiDb

describe('joseki data', () => {
  it('validates the committed fixture', () => {
    const db = validate(copy())
    expect(db.profiles).toEqual(['20k', '15k', '10k', '5k', '1d', '5d', 'pro'])
    expect(db.roots[0]).toMatchObject({ name: '4-4', m: 'pd' })
    const kids = children(db, db.roots[0].node)
    expect(kids.length).toBeGreaterThan(2)
    expect(Math.min(...kids.map(c => c.loss))).toBe(0)
  })
  it('rejects a wrong version, a backward edge or a wrong-length frequency list', () => {
    const bad = (f: (d: JosekiDb) => void) => { const d = copy(); f(d); return () => validate(d) }
    expect(bad(d => { (d as { v: number }).v = 2 })).toThrow('version')
    const at = copy().nodes.findIndex(n => n.e.length > 0 && n.e[0][1] > 0)
    expect(bad(d => { d.nodes[at].e[0][1] = at })).toThrow('forward')
    expect(bad(d => { d.nodes[at].e[0][3].pop() })).toThrow('edge')
    expect(bad(d => { d.roots[0].f.push(0) })).toThrow('root')
    expect(bad(d => { d.nodes[1].k = d.nodes[0].k })).toThrow('duplicate')
    expect(bad(d => { (d.nodes[at].e[0] as unknown[]).push(1, 0) })).toThrow('edge')
  })
  it('keeps the chance of reaching each ply at most 1', () => {
    const db = validate(copy()), r = reach(db)
    // nodes are sorted by ply: walk the plies from the roots
    const ply = db.nodes.map(() => 0)
    for (const root of db.roots) ply[root.node] = 1
    db.nodes.forEach((n, i) => { for (const [, c] of n.e) ply[c] = ply[i] + 1 })
    for (let p = 1; p <= Math.max(...ply); p++)
      for (let q = 0; q < db.profiles.length; q++) expect(r.filter((_, i) => ply[i] === p).reduce((a, x) => a + x[q], 0)).toBeLessThanOrEqual(1)
  })
  it('maps app ranks to the nearest stored profile', () => {
    const p = ['20k', '15k', '10k', '5k', '1d', '5d', 'pro']
    expect(['20k', '18k', '17k', '13k', '8k', '3k', '1k', '2d', '3d', '7d', '8d'].map(r => p[nearestProfile(p, r)]))
      .toEqual(['20k', '20k', '15k', '15k', '10k', '5k', '1d', '1d', '1d', '5d', 'pro'])
    for (const r of RANKS) expect(nearestProfile(p, r)).toBeGreaterThanOrEqual(0)
    expect(p[nearestProfile(p, 'bogus')]).toBe('10k')
  })
})
