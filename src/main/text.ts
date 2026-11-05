const STAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2})?$/

export interface Stamp {
  author: string | null
  time: string
}

/**
 * Splits "Name\n2026-11-03 10:41" author stamps off the content. The content (stamps removed) is what plain
 * clustering embeds, so people's names and times never influence it; the stamps are returned separately so a
 * "group by" prompt can still use them.
 */
export function splitStamps(text: string): { text: string; stamps: Stamp[] } {
  const lines = text.split('\n').map((l) => l.trim())
  const drop = lines.map(() => false)
  const stamps: Stamp[] = []
  lines.forEach((l, i) => {
    if (!STAMP.test(l)) return
    drop[i] = true
    let author: string | null = null
    let j = i - 1
    while (j >= 0 && lines[j] === '') j--
    if (j >= 0 && !drop[j] && lines[j].split(/\s+/).length <= 3 && lines[j].length <= 40) {
      drop[j] = true
      author = lines[j]
    }
    stamps.push({ author, time: l })
  })
  const clean = lines
    .filter((_, i) => !drop[i])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: clean, stamps }
}

export function stripStamps(text: string): string {
  return splitStamps(text).text
}

const COLORS: [string, [number, number, number]][] = [
  ['yellow', [255, 224, 102]], ['orange', [250, 200, 140]], ['red', [240, 110, 100]], ['pink', [245, 190, 215]],
  ['purple', [190, 170, 240]], ['blue', [165, 190, 250]], ['light blue', [175, 235, 250]], ['green', [160, 225, 150]],
  ['teal', [130, 215, 200]], ['gray', [200, 200, 200]], ['white', [255, 255, 255]], ['black', [40, 40, 40]],
]

/** Human name for an RGB colour (0-1 floats), so colour-coded stickies can be grouped by "colour". */
export function colorName(r: number, g: number, b: number): string {
  let best = COLORS[0][0]
  let bd = Infinity
  for (const [n, [cr, cg, cb]] of COLORS) {
    const d = (cr - r * 255) ** 2 + (cg - g * 255) ** 2 + (cb - b * 255) ** 2
    if (d < bd) {
      bd = d
      best = n
    }
  }
  return best
}

/**
 * Who wrote an item. Names stamped in the text win: items created by another plugin carry the stamp of the real
 * author, while FigJam's own author field just says who ran that plugin. FigJam's field is only a fallback.
 */
export function pickAuthors(fromText: string[], native: string[]): string[] {
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))]
  const t = uniq(fromText)
  return t.length ? t : uniq(native)
}
