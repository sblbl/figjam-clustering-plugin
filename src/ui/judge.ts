/** Reads the model's reply to a batch of "does item i match the topic?" questions. Anything missing counts as no match. */
export function parseVerdicts(content: string, count: number): boolean[] {
  const out = new Array<boolean>(count).fill(false)
  let parsed: { items?: { i: number; match: unknown }[] }
  try {
    parsed = JSON.parse(content)
  } catch {
    return out
  }
  for (const it of parsed.items ?? []) {
    if (Number.isInteger(it.i) && it.i >= 0 && it.i < count) out[it.i] = it.match === true
  }
  return out
}

/** Frame title for an extraction: the topic as typed, first line only, shortened. */
export function topicTitle(topic: string): string {
  const t = topic.split('\n')[0].replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '…' : t
}
