import { dot, normalize } from './vec'

/**
 * Picks where to cut the similarity tree from the data itself, so no fixed threshold has to fit every board
 * (what suits sentences does not suit names, and vice versa). Measured with text-embedding-3-small/256:
 * sticky-note text pairs have a median similarity of 0.24, different first names reach 0.44, synonyms 0.7+.
 *
 * Two regimes, told apart by how clean the best cut is:
 *  - crisp  (silhouette >= 0.5, e.g. identical values like author names): take the best cut, however many groups.
 *  - fuzzy  (themes, topics): best cut among a human-sized number of groups that also leaves few items unsorted.
 */
export const CRISP_SILHOUETTE = 0.5
export const MIN_COVERAGE = 0.85
/** Beyond this the O(n^3) tree is too slow for a plugin iframe; callers fall back to a fixed threshold. */
export const MAX_AUTO_ITEMS = 900

export interface Dendrogram {
  n: number
  /** pairwise cosine similarity, n*n */
  sim: Float32Array
  /** average-linkage merges in order; `level` never increases */
  merges: { i: number; j: number; level: number }[]
}

export function buildDendrogram(vecs: number[][]): Dendrogram {
  const n = vecs.length
  const sim = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    sim[i * n + i] = 1
    for (let j = i + 1; j < n; j++) {
      const s = dot(vecs[i], vecs[j])
      sim[i * n + j] = s
      sim[j * n + i] = s
    }
  }
  const S = sim.slice()
  const size = new Array<number>(n).fill(1)
  const active = new Array<boolean>(n).fill(true)
  const merges: Dendrogram['merges'] = []
  for (let step = 0; step < n - 1; step++) {
    let bi = -1
    let bj = -1
    let best = -Infinity
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue
      for (let j = i + 1; j < n; j++) {
        if (active[j] && S[i * n + j] > best) {
          best = S[i * n + j]
          bi = i
          bj = j
        }
      }
    }
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === bi || k === bj) continue
      const s = (size[bi] * S[bi * n + k] + size[bj] * S[bj * n + k]) / (size[bi] + size[bj])
      S[bi * n + k] = s
      S[k * n + bi] = s
    }
    size[bi] += size[bj]
    active[bj] = false
    merges.push({ i: bi, j: bj, level: best })
  }
  return { n, sim, merges }
}

/** Groups after applying every merge whose similarity level is >= tau (small tolerance for float32 at 1.0). */
export function partitionAt(d: Dendrogram, tau: number): number[][] {
  const parent = Array.from({ length: d.n }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (const m of d.merges) {
    if (m.level < tau - 1e-4) break
    parent[find(m.j)] = find(m.i)
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < d.n; i++) {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(i)
    else groups.set(r, [i])
  }
  return [...groups.values()]
}

/** Mean silhouette over all items (singletons count as 0), using 1 - similarity as distance. */
export function silhouette(d: Dendrogram, groups: number[][]): number {
  const { n, sim } = d
  const label = new Array<number>(n)
  groups.forEach((g, k) => g.forEach((i) => (label[i] = k)))
  let total = 0
  for (let i = 0; i < n; i++) {
    const own = groups[label[i]]
    if (own.length < 2) continue
    let a = 0
    for (const j of own) if (j !== i) a += 1 - sim[i * n + j]
    a /= own.length - 1
    let b = Infinity
    groups.forEach((g, k) => {
      if (k === label[i]) return
      let s = 0
      for (const j of g) s += 1 - sim[i * n + j]
      b = Math.min(b, s / g.length)
    })
    if (b === Infinity) continue
    total += (b - a) / Math.max(a, b, 1e-9)
  }
  return total / n
}

/** Lets items left out of every group join the nearest group if they are close enough to its centroid. */
export function assignLeftovers(vecs: number[][], groups: number[][], minSize: number, margin: number) {
  const big = groups.filter((g) => g.length >= minSize)
  const cents = big.map((g) => {
    const c = new Array<number>(vecs[0].length).fill(0)
    for (const i of g) for (let k = 0; k < c.length; k++) c[k] += vecs[i][k]
    return normalize(c)
  })
  const out = big.map((g) => [...g])
  const rest: number[] = []
  for (const i of groups.filter((g) => g.length < minSize).flat()) {
    let best = -1
    let bs = -Infinity
    cents.forEach((c, k) => {
      const s = dot(vecs[i], c)
      if (s > bs) {
        bs = s
        best = k
      }
    })
    if (best >= 0 && bs >= margin) out[best].push(i)
    else rest.push(i)
  }
  return { groups: out, rest }
}

export type Regime = 'crisp' | 'fuzzy'

export interface Cut {
  /** groups at the chosen cut (before leftovers are given a second chance) */
  groups: number[][]
  tau: number
  regime: Regime
}

/** The looser similarity at which a leftover may still join a group formed at `tau`. */
export const looseTau = (tau: number) => Math.max(0.2, tau - 0.08)

export function chooseCut(vecs: number[][], minSize: number, fuzzyOffset = 0): Cut | null {
  const n = vecs.length
  if (n < 2 * minSize || n > MAX_AUTO_ITEMS) return null
  const d = buildDendrogram(vecs)
  const levels = [...new Set(d.merges.map((m) => Math.round(m.level * 1000) / 1000))].sort((a, b) => b - a)
  const step = Math.max(1, Math.floor(levels.length / 40))
  const cands: { tau: number; score: number; big: number }[] = []
  for (let k = 0; k < levels.length; k += step) {
    const g = partitionAt(d, levels[k])
    const big = g.filter((x) => x.length >= minSize).length
    if (big < 2) continue
    if (Math.max(...g.map((x) => x.length)) > 0.6 * n) continue // one dominant blob is not a grouping
    cands.push({ tau: levels[k], score: silhouette(d, g), big })
  }
  if (!cands.length) return null

  const top = Math.max(...cands.map((c) => c.score))
  if (top >= CRISP_SILHOUETTE) {
    const c = cands.find((x) => x.score === top)!
    return { groups: partitionAt(d, c.tau), tau: c.tau, regime: 'crisp' }
  }
  const cap = Math.max(4, Math.round(1.5 * Math.sqrt(n)))
  const inRange = cands.filter((c) => c.big >= 3 && c.big <= cap)
  const covering = inRange.filter((c) => {
    const r = assignLeftovers(vecs, partitionAt(d, c.tau), minSize, looseTau(c.tau))
    return 1 - r.rest.length / n >= MIN_COVERAGE
  })
  const pool = covering.length ? covering : inRange.length ? inRange : cands
  const best = Math.max(...pool.map((c) => c.score))
  const pick = pool.find((c) => c.score === best)!
  const tau = pick.tau + fuzzyOffset
  return { groups: partitionAt(d, tau), tau, regime: 'fuzzy' }
}
