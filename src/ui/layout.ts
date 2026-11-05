/**
 * Organic placement inside one cluster frame: items are projected to 2D with PCA so that similar
 * items land near each other, then nudged apart until nothing overlaps. Items that already have a
 * position (from an earlier run) stay exactly where they are.
 */
export interface LayoutItem {
  id: string
  vec: number[]
  w: number
  h: number
  fixed?: { x: number; y: number }
}

export interface LayoutOptions {
  pad: number
  gap: number
  /** y where items may start (leaves room for the agent notes row) */
  top: number
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>
  width: number
  height: number
}

/** Top-2 principal components via power iteration; deterministic. Returns 2D coords per row. */
export function pca2(vecs: number[][]): [number, number][] {
  const n = vecs.length
  if (n === 0) return []
  const d = vecs[0].length
  const mean = new Array(d).fill(0)
  for (const v of vecs) for (let k = 0; k < d; k++) mean[k] += v[k] / n
  const X = vecs.map((v) => v.map((x, k) => x - mean[k]))

  const component = (data: number[][], seed: number): number[] => {
    let w = Array.from({ length: d }, (_, k) => Math.sin((k + 1) * (seed + 1)))
    for (let it = 0; it < 40; it++) {
      const next = new Array(d).fill(0)
      for (const row of data) {
        let p = 0
        for (let k = 0; k < d; k++) p += row[k] * w[k]
        for (let k = 0; k < d; k++) next[k] += p * row[k]
      }
      const norm = Math.sqrt(next.reduce((s, x) => s + x * x, 0))
      if (norm < 1e-12) return w.map(() => 0)
      w = next.map((x) => x / norm)
    }
    return w
  }
  const p1 = component(X, 1)
  const proj1 = X.map((row) => row.reduce((s, x, k) => s + x * p1[k], 0))
  const deflated = X.map((row, i) => row.map((x, k) => x - proj1[i] * p1[k]))
  const p2 = component(deflated, 2)
  return X.map((row, i) => [proj1[i], row.reduce((s, x, k) => s + x * p2[k], 0)])
}

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
  fixed: boolean
}

function overlap(a: Box, b: Box, gap: number): { dx: number; dy: number } | null {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap
  if (ox <= 0 || oy <= 0) return null
  return { dx: ox, dy: oy }
}

export function layoutCluster(items: LayoutItem[], opts: LayoutOptions): LayoutResult {
  const { pad, gap, top } = opts
  if (items.length === 0) return { positions: {}, width: pad * 2, height: top + pad }

  const xy = pca2(items.map((i) => i.vec))
  const xs = xy.map((p) => p[0])
  const ys = xy.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const area = items.reduce((s, i) => s + (i.w + gap) * (i.h + gap), 0)
  const maxW = Math.max(...items.map((i) => i.w))
  const maxH = Math.max(...items.map((i) => i.h))
  const side = Math.sqrt(area * 2.2)
  const W = Math.max(side * 1.25, maxW * 2 + gap)
  const H = Math.max(side * 0.9, maxH * 1.5 + gap)

  const boxes: Box[] = items.map((it, i) => {
    if (it.fixed) return { id: it.id, x: it.fixed.x, y: it.fixed.y, w: it.w, h: it.h, fixed: true }
    const u = maxX > minX ? (xs[i] - minX) / (maxX - minX) : 0.5
    const v = maxY > minY ? (ys[i] - minY) / (maxY - minY) : 0.5
    const jx = (hash01(it.id + 'x') - 0.5) * gap
    const jy = (hash01(it.id + 'y') - 0.5) * gap
    return {
      id: it.id,
      x: Math.max(pad, pad + u * Math.max(W - it.w, 0) + jx),
      y: Math.max(top, top + v * Math.max(H - it.h, 0) + jy),
      w: it.w,
      h: it.h,
      fixed: false,
    }
  })

  // push overlapping free items apart along the axis of least penetration
  for (let iter = 0; iter < 120; iter++) {
    let moved = false
    for (const a of boxes) {
      if (a.fixed) continue
      for (const b of boxes) {
        if (a === b) continue
        const o = overlap(a, b, gap)
        if (!o) continue
        const share = b.fixed ? 1 : 0.5
        if (o.dx < o.dy) a.x += (a.x + a.w / 2 < b.x + b.w / 2 ? -o.dx : o.dx) * share
        else a.y += (a.y + a.h / 2 < b.y + b.h / 2 ? -o.dy : o.dy) * share
        a.x = Math.max(pad, a.x)
        a.y = Math.max(top, a.y)
        moved = true
      }
    }
    if (!moved) break
  }

  // guarantee: anything still colliding goes on a fresh row below everything else
  const bottom = () => Math.max(...boxes.map((b) => b.y + b.h))
  for (const a of boxes) {
    if (a.fixed) continue
    if (boxes.some((b) => b !== a && overlap(a, b, gap - 1))) {
      a.x = pad
      a.y = bottom() + gap
    }
  }

  const positions: LayoutResult['positions'] = {}
  for (const b of boxes) positions[b.id] = { x: Math.round(b.x), y: Math.round(b.y) }
  return {
    positions,
    width: Math.round(Math.max(...boxes.map((b) => b.x + b.w)) + pad),
    height: Math.round(bottom() + pad),
  }
}
