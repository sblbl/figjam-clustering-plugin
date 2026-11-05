import { expect, it } from 'vitest'
import { DEFAULT_PARAMS, updateClusters } from '../src/ui/cluster'
import { layoutCluster } from '../src/ui/layout'
import { EMPTY_STATE } from '../src/types'
import { near } from './helpers'

it('handles a 600-item, 256-dim board quickly', () => {
  const items = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, vec: near(i % 10, i + 1, 256, 0.1) }))
  const t0 = performance.now()
  const r = updateClusters({ prev: EMPTY_STATE, items, reset: new Set(), params: DEFAULT_PARAMS })
  const t1 = performance.now()
  const lay = layoutCluster(r.state.clusters[0].members.map((id) => ({ id, vec: items.find((x) => x.id === id)!.vec, w: 240, h: 240 })), { pad: 80, gap: 40, top: 80 })
  const t2 = performance.now()
  console.log(`clusters=${r.state.clusters.length} unsorted=${r.state.unsorted.length} cluster ${Math.round(t1 - t0)}ms layout(${r.state.clusters[0].members.length}) ${Math.round(t2 - t1)}ms`)
  expect(Object.keys(lay.positions).length).toBe(r.state.clusters[0].members.length)
}, 30000)
