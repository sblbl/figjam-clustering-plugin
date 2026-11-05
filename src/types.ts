export type ItemKind = 'sticky' | 'text' | 'shape' | 'link' | 'image'

/** What the main thread reads off the board. Author and timestamps are deliberately dropped. */
export interface BoardItem {
  id: string
  kind: ItemKind
  /** Text to embed (sticky text, link title+description, …). Empty for images until captioned. */
  text: string
  /** Cache key: changes when the content changes. */
  key: string
  w: number
  h: number
  /**
   * Everything the board knows about the item besides its content (author, time, type, colour, section, page…),
   * as one line. NOT part of plain clustering; only given to the model when a 'group by' prompt is set.
   */
  meta: string
  /** Only present for images whose key is not cached yet. */
  imageB64?: string
}

export interface ClusterRec {
  id: string
  name: string | null
  members: string[]
  /** member count when last named; used to decide when to rename */
  namedSize: number
  notes: string[]
}

export interface State {
  clusters: ClusterRec[]
  unsorted: string[]
  nextId: number
  /** item id -> cache key at last run; detects edited items */
  keys: Record<string, string>
  /** which source page(s) these clusters were built from: 'all' or a page id */
  /** similarity level the current clusters were formed at; reused by later runs so themes stay stable */
  tau?: number
  scope?: string
  /** the 'group by' prompt these clusters were built with ('' = plain themes) */
  groupBy?: string
}

export const EMPTY_STATE: State = { clusters: [], unsorted: [], nextId: 1, keys: {} }

export interface CacheEntry {
  /** the text that was embedded (the caption for images) */
  t: string
  e: number[]
  /** extra metadata found while processing (e.g. the author stamp read off a photo card) */
  m?: string
}
export type Cache = Record<string, CacheEntry>

export interface Params {
  /** fixed thresholds: used when `auto` is off, or as a fallback when there is too little data to choose a cut */
  tauAssign: number
  tauForm: number
  minSize: number
  tauMerge: number
  /** choose the cut from the data (see autocut.ts) instead of using the fixed thresholds */
  auto: boolean
  /** the "Tightness" slider: shifts an automatically chosen cut (fuzzy data only) */
  tauOffset: number
}

export interface Placed {
  cluster: string
  x: number
  y: number
}

export interface PlanFrame {
  id: string
  name: string
  notes: string[]
  notesChanged: boolean
  items: { id: string; x: number; y: number }[]
  width: number
  height: number
}

export interface Plan {
  state: State
  newCache: Cache
  frames: PlanFrame[]
  merges: { a: string; b: string; sim: number; aName: string; bName: string }[]
  stats: { items: number; embedded: number; captioned: number; cached: number; named: number; faceted: number }
}

// main <-> ui messages
export type ToUi =
  | { type: 'work'; items: BoardItem[]; cache: Cache; state: State; placed: Record<string, Placed>; merges: [string, string][]; groupBy: string }
  | { type: 'applied'; ok: true; summary: string }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string }
  | { type: 'pages'; pages: { id: string; name: string }[]; selected: string; settings?: Settings }

export type ToMain =
  | { type: 'ready' }
  | { type: 'run'; scope: string; boardName: string; groupBy: string; merges?: [string, string][] }
  | { type: 'plan'; plan: Plan }
  | { type: 'reset'; boardName: string }
  | { type: 'close' }

export interface Settings {
  boardName: string
  groupBy: string
}

export const NOTE_SIZE = 240
export const PAD = 80
export const GAP = 40
