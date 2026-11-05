import type { Cache, Settings, State } from '../types'

const CACHE_KEY = 'clusterry:cache:v1'
const SETTINGS_KEY = 'clusterry:settings'
const STATE_KEY = 'clusterry:state'
const CHUNK = 80_000 // plugin data values are limited to 100 KB

export async function loadCache(): Promise<Cache> {
  return ((await figma.clientStorage.getAsync(CACHE_KEY)) as Cache | undefined) ?? {}
}

/** Merge new entries and drop any that nothing on the board uses any more, so the cache stays small. */
export async function saveCache(cache: Cache, added: Cache, liveKeys: Set<string>) {
  const next: Cache = {}
  for (const [k, v] of Object.entries({ ...cache, ...added })) if (liveKeys.has(k)) next[k] = v
  await figma.clientStorage.setAsync(CACHE_KEY, next)
}

export async function loadSettings(): Promise<Settings | undefined> {
  return (await figma.clientStorage.getAsync(SETTINGS_KEY)) as Settings | undefined
}
export async function saveSettings(s: Settings) {
  await figma.clientStorage.setAsync(SETTINGS_KEY, s)
}

/** Each output page carries its own clusters, so several boards (several groupings) can live side by side. */
export function loadState(page: PageNode): State | null {
  const n = Number(page.getPluginData(STATE_KEY + ':n') || 0)
  if (!n) return null
  let s = ''
  for (let i = 0; i < n; i++) s += page.getPluginData(`${STATE_KEY}:${i}`)
  try {
    return JSON.parse(s) as State
  } catch {
    return null
  }
}

export function saveState(page: PageNode, state: State) {
  clearState(page)
  const s = JSON.stringify(state)
  const n = Math.ceil(s.length / CHUNK)
  for (let i = 0; i < n; i++) page.setPluginData(`${STATE_KEY}:${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK))
  page.setPluginData(STATE_KEY + ':n', String(n))
}

export function clearState(page: PageNode) {
  const n = Number(page.getPluginData(STATE_KEY + ':n') || 0)
  for (let i = 0; i < n; i++) page.setPluginData(`${STATE_KEY}:${i}`, '')
  page.setPluginData(STATE_KEY + ':n', '')
}
