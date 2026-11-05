import { GAP, NOTE_SIZE, PAD } from '../types'
import type { BoardItem, Placed, Plan } from '../types'
function ownSections(page: PageNode): SectionNode[] {
  return page.children.filter((n): n is SectionNode => n.type === 'SECTION' && !!n.getPluginData('clusterId'))
}

/** Where each source item's copy currently sits, so re-runs never move what is already placed. */
export async function collectPlaced(page: PageNode): Promise<Record<string, Placed>> {
  const out: Record<string, Placed> = {}
  await page.loadAsync()
  for (const s of ownSections(page)) {
    for (const c of s.children) {
      const id = c.getPluginData('sourceId')
      if (id) out[id] = { cluster: s.getPluginData('clusterId'), x: c.x, y: c.y }
    }
  }
  return out
}

function pageOf(node: BaseNode): PageNode | null {
  let n: BaseNode | null = node
  while (n && n.type !== 'PAGE') n = n.parent
  return n as PageNode | null
}

async function makeNote(text: string): Promise<StickyNode> {
  const s = figma.createSticky()
  await figma.loadFontAsync(s.text.fontName as FontName)
  s.text.characters = '✦ ' + text
  s.fills = [{ type: 'SOLID', color: { r: 0.86, g: 0.86, b: 0.9 } }]
  s.setPluginData('agent', '1')
  return s
}

async function copyOf(src: SceneNode, text: string): Promise<SceneNode> {
  try {
    return (src as SceneNode & { clone(): SceneNode }).clone()
  } catch {
    // some card types may refuse to clone: leave a sticky that carries what we know
    const s = figma.createSticky()
    await figma.loadFontAsync(s.text.fontName as FontName)
    s.text.characters = text.slice(0, 300)
    return s
  }
}

export async function applyPlan(plan: Plan, items: BoardItem[], page: PageNode): Promise<string> {
  const itemById = new Map(items.map((i) => [i.id, i]))
  const sections = new Map(ownSections(page).map((s) => [s.getPluginData('clusterId'), s]))
  const copies = new Map<string, SceneNode>()
  for (const s of ownSections(page)) for (const c of s.children) {
    const id = c.getPluginData('sourceId')
    if (id) copies.set(id, c)
  }

  let created = 0
  let rebuilt = 0
  let moved = 0

  for (const f of plan.frames) {
    let section = sections.get(f.id)
    if (!section) {
      section = figma.createSection()
      page.appendChild(section)
      section.setPluginData('clusterId', f.id)
      sections.set(f.id, section)
    }
    section.name = f.name

    // agent notes: refreshed only when the cluster was (re)named
    const existingNotes = section.children.filter((c) => c.getPluginData('agent'))
    if (f.notesChanged || existingNotes.length !== f.notes.length) {
      existingNotes.forEach((n) => n.remove())
      for (let i = 0; i < f.notes.length; i++) {
        const note = await makeNote(f.notes[i])
        section.appendChild(note)
        note.x = PAD + i * (NOTE_SIZE + GAP)
        note.y = PAD
      }
    }

    for (const p of f.items) {
      const item = itemById.get(p.id)
      const src = (await figma.getNodeByIdAsync(p.id)) as SceneNode | null
      if (!item || !src) continue
      let copy = copies.get(p.id)
      if (copy && copy.getPluginData('key') !== item.key) {
        copy.remove() // source was edited: rebuild the copy
        copy = undefined
        rebuilt++
      }
      if (!copy) {
        // clone from the item's own page: media on a page that isn't open may not be loaded by the client
        const srcPage = pageOf(src)
        if (srcPage && figma.currentPage.id !== srcPage.id) await figma.setCurrentPageAsync(srcPage)
        copy = await copyOf(src, item.text)
        copy.setPluginData('sourceId', p.id)
        copy.setPluginData('key', item.key)
        copies.set(p.id, copy)
        created++
      } else if (copy.parent !== section) moved++
      if (copy.parent !== section) section.appendChild(copy)
      copy.x = p.x
      copy.y = p.y
    }
    section.resizeWithoutConstraints(Math.max(f.width, 200), Math.max(f.height, 200))
  }

  // clean up: dissolved clusters, and copies whose source item is gone
  const liveFrames = new Set(plan.frames.map((f) => f.id))
  for (const [id, s] of sections) if (!liveFrames.has(id)) s.remove()
  const liveItems = new Set(plan.frames.flatMap((f) => f.items.map((i) => i.id)))
  let removed = 0
  for (const [id, c] of copies) {
    if (!liveItems.has(id) && !c.removed) {
      c.remove()
      removed++
    }
  }

  // arrange frames side by side
  let x = 0
  let y = 0
  let rowH = 0
  for (const f of plan.frames) {
    const s = sections.get(f.id)!
    if (x > 0 && x + s.width > 7000) {
      x = 0
      y += rowH + 200
      rowH = 0
    }
    s.x = x
    s.y = y
    x += s.width + 200
    rowH = Math.max(rowH, s.height)
  }

  await figma.setCurrentPageAsync(page)
  figma.viewport.scrollAndZoomIntoView(page.children)

  const clusters = plan.frames.filter((f) => f.id !== 'unsorted').length
  const unsorted = plan.frames.find((f) => f.id === 'unsorted')?.items.length ?? 0
  return (
    `${clusters} clusters, ${unsorted} unsorted. ` +
    `${created} items copied${rebuilt ? ` (${rebuilt} rebuilt after edits)` : ''}` +
    `${moved ? `, ${moved} moved between clusters` : ''}${removed ? `, ${removed} removed` : ''}.`
  )
}

/** Empties one output board (only what this plugin put there). Original items are never touched. */
export async function clearBoard(page: PageNode) {
  await page.loadAsync()
  ownSections(page).forEach((s) => s.remove())
}
