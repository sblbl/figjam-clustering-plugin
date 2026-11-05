import { describe, expect, it } from 'vitest'
import { agglomerate, applyMerge, DEFAULT_PARAMS, proposeMerges, updateClusters } from '../src/ui/cluster'
import type { Params } from '../src/types'

const FIXED: Params = { ...DEFAULT_PARAMS, auto: false }
import { EMPTY_STATE } from '../src/types'
import { near } from './helpers'

const mk = (topic: number, n: number, prefix: string, seed0 = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, vec: near(topic, seed0 + i) }))

describe('agglomerate', () => {
  it('splits well-separated topics', () => {
    const vecs = [...mk(0, 4, 'a'), ...mk(1, 4, 'b')].map((x) => x.vec)
    const groups = agglomerate(vecs, 0.35).map((g) => g.sort())
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.length).sort()).toEqual([4, 4])
  })
})

describe('updateClusters', () => {
  const run = (prev = EMPTY_STATE, items = [...mk(0, 4, 'a'), ...mk(1, 4, 'b'), ...mk(2, 4, 'c')], reset = new Set<string>()) =>
    updateClusters({ prev, items, reset, params: FIXED })

  it('forms one cluster per emergent theme on first run', () => {
    const r = run()
    expect(r.state.clusters).toHaveLength(3)
    expect(r.state.unsorted).toEqual([])
    expect(r.needsNaming).toHaveLength(3)
    for (const c of r.state.clusters) expect(new Set(c.members.map((m) => m[0])).size).toBe(1)
  })

  it('keeps cluster ids and members stable when nothing changes', () => {
    const first = run()
    const named = { ...first.state, clusters: first.state.clusters.map((c) => ({ ...c, name: c.id, namedSize: c.members.length })) }
    const second = run(named)
    expect(second.state.clusters.map((c) => [c.id, [...c.members].sort()])).toEqual(
      named.clusters.map((c) => [c.id, [...c.members].sort()]),
    )
    expect(second.created).toBe(0)
    expect(second.needsNaming).toEqual([])
  })

  it('assigns a new item to the nearest existing cluster without renaming it', () => {
    const first = run()
    const named = { ...first.state, clusters: first.state.clusters.map((c) => ({ ...c, name: c.id, namedSize: c.members.length })) }
    const extra = { id: 'b-new', vec: near(1, 99) }
    const items = [...mk(0, 4, 'a'), ...mk(1, 4, 'b'), ...mk(2, 4, 'c'), extra]
    const r = run(named, items)
    const home = r.state.clusters.find((c) => c.members.includes('b-new'))!
    expect(home.members.filter((m) => m.startsWith('b'))).toHaveLength(5)
    expect(r.assigned).toBe(1)
    expect(r.created).toBe(0)
    expect(r.needsNaming).toEqual([]) // 4 -> 5 members is < 30% growth
  })

  it('lets a new theme emerge from the pool over successive runs', () => {
    const base = run(EMPTY_STATE, [...mk(0, 4, 'a'), ...mk(1, 4, 'b')])
    // two items of a brand-new theme: not enough for a cluster
    const two = [...mk(0, 4, 'a'), ...mk(1, 4, 'b'), ...mk(5, 2, 'z')]
    const r2 = run(base.state, two)
    expect(r2.state.clusters).toHaveLength(2)
    expect(r2.state.unsorted.sort()).toEqual(['z0', 'z1'])
    // a third arrives: theme crystallises, existing clusters untouched
    const three = [...mk(0, 4, 'a'), ...mk(1, 4, 'b'), ...mk(5, 3, 'z')]
    const r3 = run(r2.state, three)
    expect(r3.state.clusters).toHaveLength(3)
    expect(r3.state.unsorted).toEqual([])
    expect(r3.state.clusters.slice(0, 2).map((c) => c.id)).toEqual(base.state.clusters.map((c) => c.id))
  })

  it('drops deleted items and dissolves clusters that shrink below 2', () => {
    const first = run()
    const items = [...mk(0, 4, 'a'), ...mk(1, 4, 'b'), ...mk(2, 1, 'c')]
    const r = run(first.state, items)
    expect(r.state.clusters.some((c) => c.members.includes('c1'))).toBe(false)
    expect(r.state.clusters).toHaveLength(2)
  })

  it('treats edited items as new', () => {
    const first = run()
    const items = [...mk(0, 4, 'a'), ...mk(1, 4, 'b'), ...mk(2, 3, 'c'), { id: 'c3', vec: near(0, 77) }]
    const r = run(first.state, items, new Set(['c3']))
    const home = r.state.clusters.find((c) => c.members.includes('c3'))!
    expect(home.members.some((m) => m.startsWith('a'))).toBe(true)
  })
})

describe('merges', () => {
  it('proposes near-identical clusters and applies on request only', () => {
    const items = [...mk(0, 3, 'a', 1), ...mk(0, 3, 'x', 50)]
    const state = {
      ...EMPTY_STATE,
      clusters: [
        { id: 'c1', name: 'A', members: ['a0', 'a1', 'a2'], namedSize: 3, notes: [] },
        { id: 'c2', name: 'X', members: ['x0', 'x1', 'x2'], namedSize: 3, notes: [] },
      ],
    }
    const vecOf = (id: string) => items.find((i) => i.id === id)!.vec
    const p = proposeMerges(state, vecOf, FIXED)
    expect(p).toHaveLength(1)
    const merged = applyMerge(state, 'c1', 'c2')
    expect(merged.clusters).toHaveLength(1)
    expect(merged.clusters[0].members).toHaveLength(6)
    expect(merged.clusters[0].name).toBeNull()
  })
})

import { GROUP_BY_PARAMS, isUnclear } from '../src/ui/cluster'

describe('group-by mode', () => {
  it('sends "unclear" items to Unsorted only, never into a cluster of their own', () => {
    const a = Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, vec: near(0, 1, 12, 0.02) }))
    const b = Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, vec: near(1, 1, 12, 0.02) }))
    const u = Array.from({ length: 4 }, (_, i) => ({ id: `u${i}`, vec: near(2, 5, 12, 0.02) }))
    const r = updateClusters({
      prev: EMPTY_STATE,
      items: [...a, ...b, ...u],
      reset: new Set(),
      params: GROUP_BY_PARAMS,
      forceUnsorted: new Set(u.map((x) => x.id)),
    })
    expect(r.state.clusters).toHaveLength(2)
    expect(r.state.unsorted).toEqual(['u0', 'u1', 'u2', 'u3'])
  })
  it('allows 2-item groups and recognises "no value" phrases', () => {
    const items = [{ id: 'x0', vec: near(0, 1) }, { id: 'x1', vec: near(0, 2) }]
    const r = updateClusters({ prev: EMPTY_STATE, items, reset: new Set(), params: { ...GROUP_BY_PARAMS, auto: false } })
    expect(r.state.clusters).toHaveLength(1)
    for (const p of ['unclear', 'Unclear.', 'n/a', 'None', 'not specified']) expect(isUnclear(p)).toBe(true)
    expect(isUnclear('Amanda')).toBe(false)
  })
})
