import { normalize } from '../src/ui/cluster'

/** deterministic pseudo-random */
export function rng(seed: number) {
  let s = seed
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

/** a unit vector near basis direction `topic` (dim 12) with a little noise */
export function near(topic: number, seed: number, dim = 12, noise = 0.25) {
  const r = rng(seed)
  const v = new Array(dim).fill(0).map(() => (r() - 0.5) * noise)
  v[topic] += 1
  return normalize(v)
}
