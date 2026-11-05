import { describe, expect, it } from 'vitest'
import { layoutCluster, pca2 } from '../src/ui/layout'
import { near } from './helpers'

const opts = { pad: 80, gap: 40, top: 80 }
const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, vec: near(i % 3, i + 1), w: 240, h: 240 }))

function overlaps(res: ReturnType<typeof layoutCluster>, list: { id: string; w: number; h: number }[]) {
  const ids = Object.keys(res.positions)
  for (let a = 0; a < ids.length; a++)
    for (let b = a + 1; b < ids.length; b++) {
      const A = res.positions[ids[a]], B = res.positions[ids[b]]
      const wa = list.find((i) => i.id === ids[a])!, wb = list.find((i) => i.id === ids[b])!
      const ox = Math.min(A.x + wa.w, B.x + wb.w) - Math.max(A.x, B.x)
      const oy = Math.min(A.y + wa.h, B.y + wb.h) - Math.max(A.y, B.y)
      if (ox > 0 && oy > 0) return true
    }
  return false
}

describe('layoutCluster', () => {
  it('never overlaps items and keeps them inside the frame', () => {
    for (const n of [1, 2, 7, 25, 60]) {
      const list = items(n)
      const res = layoutCluster(list, opts)
      expect(overlaps(res, list)).toBe(false)
      for (const it of list) {
        const p = res.positions[it.id]
        expect(p.x).toBeGreaterThanOrEqual(opts.pad)
        expect(p.y).toBeGreaterThanOrEqual(opts.top)
        expect(p.x + it.w).toBeLessThanOrEqual(res.width)
        expect(p.y + it.h).toBeLessThanOrEqual(res.height)
      }
    }
  })

  it('is deterministic', () => {
    expect(layoutCluster(items(12), opts)).toEqual(layoutCluster(items(12), opts))
  })

  it('keeps fixed items exactly where they were and places new ones around them', () => {
    const list = items(8).map((it, i) => (i < 5 ? { ...it, fixed: { x: 80 + i * 300, y: 200 } } : it))
    const res = layoutCluster(list, opts)
    for (let i = 0; i < 5; i++) expect(res.positions[`i${i}`]).toEqual({ x: 80 + i * 300, y: 200 })
    expect(overlaps(res, list)).toBe(false)
  })

  it('reserves room for the notes row', () => {
    const res = layoutCluster(items(6), { ...opts, top: 400 })
    for (const p of Object.values(res.positions)) expect(p.y).toBeGreaterThanOrEqual(400)
  })

  it('puts similar items closer together than dissimilar ones', () => {
    const list = [0, 1, 2].flatMap((t) => Array.from({ length: 4 }, (_, i) => ({ id: `t${t}-${i}`, vec: near(t, t * 10 + i), w: 120, h: 120 })))
    const res = layoutCluster(list, { pad: 40, gap: 20, top: 40 })
    const d = (a: string, b: string) => Math.hypot(res.positions[a].x - res.positions[b].x, res.positions[a].y - res.positions[b].y)
    let within = 0, across = 0, nw = 0, na = 0
    for (const a of list) for (const b of list) {
      if (a.id >= b.id) continue
      if (a.id[1] === b.id[1]) { within += d(a.id, b.id); nw++ } else { across += d(a.id, b.id); na++ }
    }
    expect(within / nw).toBeLessThan(across / na)
  })
})

describe('pca2', () => {
  it('returns one 2D point per vector', () => {
    expect(pca2(items(5).map((i) => i.vec))).toHaveLength(5)
  })
})
