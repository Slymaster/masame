import { describe, expect, it } from 'vitest'
import { cropRect, wrap } from './postcard'
import { en } from './i18n/en'
import { fr } from './i18n/fr'

describe('cropRect', () => {
  it('scales a frame inside the canvas to device pixels', () => {
    expect(cropRect({ x: 10, y: 20, w: 300, h: 200 }, 1280, 860, 2)).toEqual({ x: 20, y: 40, w: 600, h: 400 })
  })
  it('clamps a frame that spills over the canvas', () => {
    expect(cropRect({ x: -30, y: 700, w: 400, h: 400 }, 1280, 860, 2)).toEqual({ x: 0, y: 1400, w: 740, h: 320 })
  })
  it('rounds edges, not sizes, at fractional ratios', () => {
    expect(cropRect({ x: 1, y: 1, w: 3, h: 3 }, 100, 100, 1.5)).toEqual({ x: 2, y: 2, w: 4, h: 4 })
  })
  it('is null when nothing of the frame is on the canvas', () => {
    expect(cropRect({ x: 1300, y: 0, w: 100, h: 100 }, 1280, 860, 2)).toBeNull()
  })
})

describe('postcard file name', () => {
  it('names the size and the move, in each language', () => {
    expect(en.postcardName(19, 123)).toBe('masame-19x19-move-123.png')
    expect(fr.postcardName(9, 0)).toBe('masame-9x9-coup-0.png')
    expect(fr.postcardName(19)).toBe('masame-19x19.png') // a trainer's board
  })
})

describe('wrap', () => {
  const x = { measureText: (s: string) => ({ width: s.length }) as TextMetrics } // one unit per character
  it('breaks between words within the width, a long word alone on its line', () => {
    expect(wrap(x, 'Tu as résolu 7 tsumego.', 12)).toEqual(['Tu as résolu', '7 tsumego.'])
    expect(wrap(x, 'anticonstitutionnellement ok', 10)).toEqual(['anticonstitutionnellement', 'ok'])
    expect(wrap(x, 'court', 40)).toEqual(['court'])
  })
})
