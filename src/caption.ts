/** The vision model is asked to put any visible author/time stamp on a final `STAMP:` line, apart from the description. */
export function parseCaption(raw: string): { text: string; stamp: string } {
  const m = raw.match(/^\s*STAMP:\s*(.*)$/im)
  const stamp = m ? m[1].trim() : ''
  const text = raw.replace(/^\s*STAMP:.*$/gim, '').trim()
  return { text, stamp: /^(none|n\/a|-)?$/i.test(stamp) ? '' : stamp }
}
