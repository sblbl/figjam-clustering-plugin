import type { BoardItem, Cache } from '../types'
import { hashStr } from '../hash'
import { isOutputPage } from './pages'
import { colorName, pickAuthors, splitStamps } from './text'
import type { Stamp } from './text'

type Described = { kind: BoardItem['kind']; text: string; key: string; meta: string }

interface Leaf {
  text: string
  stamps: Stamp[]
  author?: string
}

/** Text a single leaf node contributes (author/time stamps split off into `stamps`). */
function leaf(node: SceneNode): Leaf {
  switch (node.type) {
    case 'STICKY': {
      const r = splitStamps(node.text.characters)
      let author: string | undefined
      try {
        author = node.authorName || undefined
      } catch {}
      return { ...r, author }
    }
    case 'SHAPE_WITH_TEXT':
      return splitStamps(node.text.characters)
    case 'TEXT':
      return splitStamps(node.characters)
    case 'LINK_UNFURL': {
      const d = node.linkUnfurlData
      return { text: [d.title, d.description, d.provider, d.url].filter(Boolean).join(' — '), stamps: [] }
    }
    case 'EMBED': {
      const d = node.embedData
      return { text: [d.title, d.description, d.provider, d.canonicalUrl ?? d.srcUrl].filter(Boolean).join(' — '), stamps: [] }
    }
    default:
      return { text: '', stamps: [] }
  }
}

const leafText = (n: SceneNode) => leaf(n).text

function domainOf(node: SceneNode): string | null {
  const url = node.type === 'LINK_UNFURL' ? node.linkUnfurlData.url : node.type === 'EMBED' ? node.embedData.canonicalUrl ?? node.embedData.srcUrl : null
  const m = url?.match(/^https?:\/\/([^/]+)/)
  return m ? m[1].replace(/^www\./, '') : null
}

function colorOf(node: SceneNode): string | null {
  if (node.type !== 'STICKY') return null
  const f = node.fills
  if (f === figma.mixed || !f[0] || f[0].type !== 'SOLID') return null
  return colorName(f[0].color.r, f[0].color.g, f[0].color.b)
}

/** One-line description of everything about an item except its content. */
function metaOf(node: SceneNode, kind: string, leaves: Leaf[], nodes: SceneNode[]): string {
  const stamped: string[] = []
  const native: string[] = []
  const times: string[] = []
  for (const l of leaves) {
    if (l.author) native.push(l.author)
    for (const st of l.stamps) {
      if (st.author) stamped.push(st.author)
      times.push(st.time)
    }
  }
  const authors = pickAuthors(stamped, native)
  const parts: string[] = []
  if (authors.length) parts.push(`author: ${authors.join(', ')}`)
  if (times.length) parts.push(`time: ${times.sort()[0]}`)
  parts.push(`type: ${kind}`)
  const colors = [...new Set(nodes.map(colorOf).filter(Boolean))]
  if (colors.length) parts.push(`color: ${colors.join(', ')}`)
  const domains = [...new Set(nodes.map(domainOf).filter(Boolean))]
  if (domains.length) parts.push(`site: ${domains.join(', ')}`)
  const sections: string[] = []
  let page = ''
  for (let n: BaseNode | null = node.parent; n; n = n.parent) {
    if (n.type === 'SECTION' && n.name) sections.unshift(n.name)
    if (n.type === 'PAGE') page = n.name
  }
  if (sections.length) parts.push(`section: ${sections.join(' > ')}`)
  if (page) parts.push(`page: ${page}`)
  return parts.join(' | ')
}

function describeLeaf(node: SceneNode): Described | null {
  if (node.type === 'MEDIA') return { kind: 'image', text: '', key: 'm:' + node.mediaData.hash, meta: metaOf(node, 'image', [], [node]) }
  const l = leaf(node)
  const t = l.text
  if (node.type === 'TEXT' && t.length < 2) return null
  if (!t) return null
  const kind = node.type === 'STICKY' ? 'sticky' : node.type === 'SHAPE_WITH_TEXT' ? 'shape' : node.type === 'TEXT' ? 'text' : 'link'
  return { kind, text: t, key: (kind === 'link' ? 'l:' : 't:') + hashStr(t), meta: metaOf(node, kind, [l], [node]) }
}

const PRIMARY = new Set(['STICKY', 'SHAPE_WITH_TEXT', 'LINK_UNFURL', 'EMBED', 'MEDIA'])
const CONTAINERS = new Set(['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'INSTANCE'])
type Container = SceneNode & ChildrenMixin

/**
 * A container (card, group, frame) holding at most ONE primary item — e.g. a photo card made of an image,
 * an author stamp and a handwritten caption — is a single item and is never taken apart.
 * A container holding two or more primary items is just an organiser (like a section of post-its): we look inside.
 */
function describeComposite(c: Container, descendants: SceneNode[]): Described | null {
  const leaves = descendants.map(leaf)
  const text = leaves.map((l) => l.text).filter(Boolean).join('\n')
  const media = descendants.filter((n) => n.type === 'MEDIA') as MediaNode[]
  if (media.length) {
    return {
      kind: 'image',
      text,
      key: 'c:' + hashStr(text + '|' + media.map((m) => m.mediaData.hash).join(',')),
      meta: metaOf(c, 'image card', leaves, descendants),
    }
  }
  if (!text) return null
  return { kind: 'shape', text, key: 't:' + hashStr(text), meta: metaOf(c, 'group', leaves, descendants) }
}

/** The selected page(s), never [clusters]. Author names and timestamps are never read into the text. */
export async function readBoard(cache: Cache, onStatus: (s: string) => void, scope = 'all'): Promise<BoardItem[]> {
  const items: BoardItem[] = []
  let exported = 0

  const push = async (node: SceneNode, d: Described) => {
    const item: BoardItem = { id: node.id, kind: d.kind, text: d.text, key: d.key, meta: d.meta, w: node.width, h: node.height }
    if (d.kind === 'image' && !cache[d.key]) {
      onStatus(`Exporting image ${++exported}…`)
      try {
        const bytes = await (node as FrameNode).exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 512 } })
        item.imageB64 = figma.base64Encode(bytes)
      } catch {
        if (!item.text) return // cannot read this image and nothing else describes it: skip rather than fail the run
        item.kind = 'shape'
      }
    }
    items.push(item)
  }

  const walk = async (parent: ChildrenMixin) => {
    for (const child of parent.children) {
      if (child.visible === false || child.getPluginData('agent') || child.getPluginData('sourceId')) continue
      if (CONTAINERS.has(child.type)) {
        const c = child as Container
        const descendants = c.findAll((n) => n.visible !== false)
        const primaries = descendants.filter((n) => PRIMARY.has(n.type)).length
        if (primaries >= 2) await walk(c)
        else if (primaries === 0 && c.type === 'SECTION') continue // a heading-only section is not content
        else {
          const d = describeComposite(c, descendants)
          if (d) await push(c, d)
        }
        continue
      }
      const d = describeLeaf(child)
      if (d) await push(child, d)
    }
  }

  for (const page of figma.root.children) {
    if (isOutputPage(page)) continue
    if (scope !== 'all' && page.id !== scope) continue
    await page.loadAsync()
    await walk(page)
  }
  return items
}
