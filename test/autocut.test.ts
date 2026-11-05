import { describe, expect, it } from 'vitest'
import { chooseCut } from '../src/ui/autocut'
import { DEFAULT_PARAMS, GROUP_BY_PARAMS, updateClusters } from '../src/ui/cluster'
import { EMPTY_STATE } from '../src/types'
import { normalize } from '../src/ui/vec'
import { near, rng } from './helpers'

/** values that share a common component, like real embeddings of short names (cross-similarity ~0.4) */
function valueVec(value: number, dim = 64) {
  const shared = near(0, 999, dim, 0)
  const r = rng(value * 7919 + 1)
  const own = normalize(new Array(dim).fill(0).map(() => r() - 0.5))
  return normalize(shared.map((x, k) => 0.65 * x + 0.76 * own[k]))
}

describe('automatic cut', () => {
  it('crisp: identical values form exactly one group each, even when different values are 0.4 alike', () => {
    const people = [4, 3, 6, 2, 5, 4].map((n, p) => Array.from({ length: n }, () => valueVec(p + 1)))
    const vecs = people.flat()
    const cut = chooseCut(vecs, 2)!
    expect(cut.regime).toBe('crisp')
    expect(cut.groups.map((g) => g.length).sort()).toEqual([2, 3, 4, 4, 5, 6])
    // each group is a single person
    let start = 0
    const owner = people.flatMap((p, k) => p.map(() => k))
    for (const g of cut.groups) expect(new Set(g.map((i) => owner[i])).size).toBe(1)
    void start
  })

  it('fuzzy: finds a human-sized number of themes in noisy data with a low overall similarity', () => {
    // 5 themes in a 64-dim space, each item mostly noise: pairwise similarity stays low, as with real post-its
    const vecs = Array.from({ length: 60 }, (_, i) => near(i % 5, i + 1, 64, 0.9))
    const cut = chooseCut(vecs, 3)!
    expect(cut).not.toBeNull()
    const big = cut.groups.filter((g) => g.length >= 3)
    expect(big.length).toBeGreaterThanOrEqual(3)
    expect(big.length).toBeLessThanOrEqual(12)
  })

  it('returns null when there is too little data to judge', () => {
    expect(chooseCut([near(0, 1), near(1, 2), near(2, 3)], 3)).toBeNull()
  })
})

describe('updateClusters with the automatic cut', () => {
  const items = (n: number, offset = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `i${offset + i}`, vec: near((offset + i) % 4, offset + i + 1, 64, 0.5) }))

  it('remembers the cut and leaves existing themes alone when a few items arrive', () => {
    const first = updateClusters({ prev: EMPTY_STATE, items: items(40), reset: new Set(), params: DEFAULT_PARAMS })
    expect(first.state.tau).toBeGreaterThan(0)
    expect(first.state.clusters.length).toBeGreaterThanOrEqual(3)
    const named = { ...first.state, clusters: first.state.clusters.map((c) => ({ ...c, name: c.id, namedSize: c.members.length })) }
    const second = updateClusters({ prev: named, items: items(43), reset: new Set(), params: DEFAULT_PARAMS })
    expect(second.state.tau).toBe(first.state.tau)
    expect(second.created).toBe(0)
    for (const c of named.clusters) {
      const after = second.state.clusters.find((x) => x.id === c.id)!
      expect(c.members.every((m) => after.members.includes(m))).toBe(true)
    }
  })

  it('gives stragglers a second chance to join a nearby cluster', () => {
    const r = updateClusters({ prev: EMPTY_STATE, items: items(40), reset: new Set(), params: DEFAULT_PARAMS })
    expect(r.state.unsorted.length).toBeLessThanOrEqual(8)
  })

  it('group-by with crisp values keeps each value in its own cluster', () => {
    const vecs = [3, 3, 4, 2].flatMap((n, p) => Array.from({ length: n }, (_, k) => ({ id: `p${p}-${k}`, vec: valueVec(p + 1) })))
    const r = updateClusters({ prev: EMPTY_STATE, items: vecs, reset: new Set(), params: GROUP_BY_PARAMS })
    expect(r.regime).toBe('crisp')
    expect(r.state.clusters).toHaveLength(4)
    for (const c of r.state.clusters) expect(new Set(c.members.map((m) => m.split('-')[0])).size).toBe(1)
  })
})
