import type { ClusterRec, Params, State } from '../types'
import { chooseCut, looseTau } from './autocut'
import type { Regime } from './autocut'
import { addInto, dot, normalize } from './vec'

export const DEFAULT_PARAMS: Params = {
  tauAssign: 0.4, // fixed fallback: min cosine similarity to join an existing cluster
  tauForm: 0.35, // fixed fallback: min average-linkage similarity to form a new cluster from the pool
  minSize: 3, // smallest group that counts as a cluster
  tauMerge: 0.8, // centroid similarity above which two clusters are proposed for merging
  auto: true,
  tauOffset: 0,
}

/** "Group by" mode: values are short and a person with two items is still a group. The cut is chosen from the data. */
export const GROUP_BY_PARAMS: Params = { ...DEFAULT_PARAMS, minSize: 2, tauMerge: 0.92 }

/** Descriptions meaning "this item has no value on the requested dimension". */
export function isUnclear(phrase: string): boolean {
  return /^(unclear|unknown|none|n\/a|na|not specified|unspecified|no (clear )?(value|author|data)|not applicable)\.?$/i.test(phrase.trim())
}

export interface VecItem {
  id: string
  /** L2-normalised embedding */
  vec: number[]
}

export { dot, normalize }

/**
 * Average-linkage agglomerative clustering. Merges the two most similar groups until the best
 * remaining similarity drops below `tau`. O(n^3) worst case — fine for boards of a few hundred items.
 */
export function agglomerate(vecs: number[][], tau: number): number[][] {
  const n = vecs.length
  if (n === 0) return []
  const S = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = dot(vecs[i], vecs[j])
      S[i * n + j] = s
      S[j * n + i] = s
    }
  }
  const groups: number[][] = vecs.map((_, i) => [i])
  const active: boolean[] = new Array(n).fill(true)
  for (;;) {
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
    if (bi < 0 || best < tau) break
    const si = groups[bi].length
    const sj = groups[bj].length
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === bi || k === bj) continue
      const s = (si * S[bi * n + k] + sj * S[bj * n + k]) / (si + sj)
      S[bi * n + k] = s
      S[k * n + bi] = s
    }
    groups[bi] = groups[bi].concat(groups[bj])
    active[bj] = false
  }
  return groups.filter((_, i) => active[i])
}

export interface UpdateInput {
  prev: State
  items: VecItem[]
  /** ids whose content changed since last run — treated as brand new */
  reset: Set<string>
  /** ids that have no value on the grouping dimension: always go to Unsorted, never form a cluster */
  forceUnsorted?: Set<string>
  params: Params
}

export interface UpdateResult {
  state: State
  /** cluster ids that are new, or whose membership moved enough to deserve a fresh name */
  needsNaming: string[]
  assigned: number
  created: number
  /** how the cut was chosen this run */
  regime: Regime | 'reused' | 'fixed'
}

/**
 * Incremental update. Existing members never move (so themes stay stable between runs); only items
 * that are new, edited, previously unsorted, or from dissolved clusters are (re)placed.
 */
export function updateClusters({ prev, items, reset, params, forceUnsorted }: UpdateInput): UpdateResult {
  const force = forceUnsorted ?? new Set<string>()
  const byId = new Map(items.map((i) => [i.id, i]))
  let nextId = prev.nextId
  const clusters: ClusterRec[] = []
  const sums = new Map<string, number[]>()
  const pool = new Set<string>()

  for (const c of prev.clusters) {
    const members = c.members.filter((id) => byId.has(id) && !reset.has(id) && !force.has(id))
    if (members.length < 2) {
      members.forEach((id) => pool.add(id)) // too small to be a theme any more
      continue
    }
    clusters.push({ ...c, members })
    const sum = new Array(byId.get(members[0])!.vec.length).fill(0)
    for (const id of members) addInto(sum, byId.get(id)!.vec)
    sums.set(c.id, sum)
  }

  const placed = new Set(clusters.flatMap((c) => c.members))
  for (const it of items) if (!placed.has(it.id) && !force.has(it.id)) pool.add(it.id)

  // 1) join the nearest existing cluster if close enough
  const assignTau = params.auto ? looseTau(prev.tau ?? params.tauForm) : params.tauAssign
  let assigned = 0
  const leftover: string[] = []
  for (const id of [...pool].sort()) {
    const v = byId.get(id)!.vec
    let best = -Infinity
    let bestC: ClusterRec | null = null
    for (const c of clusters) {
      const s = dot(v, normalize(sums.get(c.id)!))
      if (s > best) {
        best = s
        bestC = c
      }
    }
    if (bestC && best >= assignTau) {
      bestC.members.push(id)
      addInto(sums.get(bestC.id)!, v)
      assigned++
    } else leftover.push(id)
  }

  // 2) group the leftovers; big enough groups become new clusters
  const leftVecs = leftover.map((id) => byId.get(id)!.vec)
  let groups: number[][]
  let tau = prev.tau
  let regime: UpdateResult['regime'] = 'fixed'
  // choose a fresh cut when there is enough new material to judge from (first run, or a big new batch);
  // otherwise reuse the earlier cut, so a handful of new items never reshuffles the themes
  const enough = leftover.length >= 12 || prev.tau === undefined || clusters.length === 0
  const cut = params.auto && enough ? chooseCut(leftVecs, params.minSize, params.tauOffset) : null
  if (cut) {
    groups = cut.groups
    tau = cut.tau
    regime = cut.regime
  } else {
    const t = params.auto ? prev.tau ?? params.tauForm : params.tauForm
    groups = agglomerate(leftVecs, t)
    if (params.auto) {
      tau = t
      regime = prev.tau !== undefined ? 'reused' : 'fixed'
    }
  }
  let unsorted: string[] = []
  let created = 0
  for (const g of groups) {
    const ids = g.map((i) => leftover[i])
    if (ids.length >= params.minSize) {
      const id = `c${nextId++}`
      clusters.push({ id, name: null, members: ids, namedSize: 0, notes: [] })
      sums.set(id, ids.reduce((s, x) => (addInto(s, byId.get(x)!.vec), s), new Array<number>(leftVecs[0].length).fill(0)))
      created++
    } else unsorted.push(...ids)
  }
  // stragglers get a second chance to join the nearest cluster at a looser similarity
  if (params.auto && tau !== undefined && clusters.length) {
    const rest: string[] = []
    for (const id of unsorted) {
      const v = byId.get(id)!.vec
      let best = -Infinity
      let bestC: ClusterRec | null = null
      for (const c of clusters) {
        const s = dot(v, normalize(sums.get(c.id)!))
        if (s > best) {
          best = s
          bestC = c
        }
      }
      if (bestC && best >= looseTau(tau)) {
        bestC.members.push(id)
        addInto(sums.get(bestC.id)!, v)
        assigned++
      } else rest.push(id)
    }
    unsorted = rest
  }

  const needsNaming = clusters
    .filter((c) => c.name === null || Math.abs(c.members.length - c.namedSize) / Math.max(c.namedSize, 1) > 0.3)
    .map((c) => c.id)

  const keys: Record<string, string> = {}
  for (const it of items) if (prev.keys[it.id] !== undefined) keys[it.id] = prev.keys[it.id]

  return {
    state: { clusters, unsorted: [...unsorted, ...items.filter((i) => force.has(i.id)).map((i) => i.id)].sort(), nextId, keys, tau },
    needsNaming,
    assigned,
    created,
    regime,
  }
}

export function centroid(members: string[], vecOf: (id: string) => number[]): number[] {
  const first = vecOf(members[0])
  const sum = new Array(first.length).fill(0)
  for (const id of members) addInto(sum, vecOf(id))
  return normalize(sum)
}

/** Pairs of clusters whose centroids are nearly the same theme. Never applied automatically. */
export function proposeMerges(state: State, vecOf: (id: string) => number[], params: Params) {
  const cents = state.clusters.map((c) => ({ c, v: centroid(c.members, vecOf) }))
  const out: { a: string; b: string; sim: number }[] = []
  for (let i = 0; i < cents.length; i++) {
    for (let j = i + 1; j < cents.length; j++) {
      const sim = dot(cents[i].v, cents[j].v)
      if (sim >= params.tauMerge) out.push({ a: cents[i].c.id, b: cents[j].c.id, sim })
    }
  }
  return out.sort((x, y) => y.sim - x.sim)
}

/** Fold cluster `b` into `a`; `a` keeps its identity and gets renamed on the next naming pass. */
export function applyMerge(state: State, a: string, b: string): State {
  const A = state.clusters.find((c) => c.id === a)
  const B = state.clusters.find((c) => c.id === b)
  if (!A || !B || a === b) return state
  return {
    ...state,
    clusters: state.clusters
      .filter((c) => c.id !== b)
      .map((c) => (c.id === a ? { ...c, members: [...A.members, ...B.members], name: null, namedSize: 0 } : c)),
  }
}
