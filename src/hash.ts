export function hashStr(s: string): string {
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = (h1 * 33) ^ c
    h2 = (h2 * 33) ^ c
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36)
}

/** Collapses whitespace so cosmetic edits to the prompt don't invalidate cached work. */
export function normalizeGroupBy(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** The metadata line used for grouping: board metadata plus anything learned while processing (e.g. a stamp read off a photo). */
export function fullMeta(meta: string, extra?: string): string {
  return [meta, extra].filter(Boolean).join(' | ')
}

/** Cache key for an item's description along the 'group by' dimension. */
export function facetKey(groupBy: string, itemKey: string, meta = ''): string {
  return `f:${hashStr(groupBy.toLowerCase())}:${itemKey}${meta ? ':' + hashStr(meta) : ''}`
}

/** Cache key for "does this item belong to this topic?" (metadata is included: a topic may concern who or when). */
export function judgeKey(topic: string, itemKey: string, meta = ''): string {
  return `x:${hashStr(topic.toLowerCase())}:${itemKey}${meta ? ':' + hashStr(meta) : ''}`
}
