import { facetKey, fullMeta, judgeKey, normalizeGroupBy } from '../hash'
import type { BoardItem, Cache, Mode, Plan, ToMain, ToUi } from '../types'
import { applyPlan, clearBoard, collectPlaced } from './clusters-page'
import { assertBoardNameFree, DEFAULT_BOARD_NAME, ensureBoardPage, findPage, isOutputPage } from './pages'
import { readBoard } from './read-board'
import { clearState, loadCache, loadSettings, loadState, saveCache, saveSettings, saveState } from './storage'

figma.showUI(__html__, { width: 340, height: 560, themeColors: true })

const post = (m: ToUi) => figma.ui.postMessage(m)
let lastItems: BoardItem[] = []
let lastCache: Cache = {}
let lastScope = 'all'
let lastGroupBy = ''
let lastMode: Mode = 'cluster'
let lastTopic = ''
let lastPage: PageNode | null = null

/** Cache entries worth keeping/sending: raw ones for items on the board now, plus the current grouping's descriptions or topic verdicts. */
function liveKeys(fresh: Cache = {}): Set<string> {
  const live = new Set<string>()
  for (const i of lastItems) {
    live.add(i.key)
    const meta = fullMeta(i.meta, (fresh[i.key] ?? lastCache[i.key])?.m)
    if (lastGroupBy) live.add(facetKey(lastGroupBy, i.key, meta))
    if (lastTopic) live.add(judgeKey(lastTopic, i.key, meta))
  }
  return live
}

async function postPages(selected?: string) {
  const pages = figma.root.children.filter((p) => !isOutputPage(p)).map((p) => ({ id: p.id, name: p.name }))
  const fallback = pages.some((p) => p.id === figma.currentPage.id) ? figma.currentPage.id : 'all'
  post({
    type: 'pages',
    pages,
    selected: selected && (selected === 'all' || pages.some((p) => p.id === selected)) ? selected : fallback,
    settings: (await loadSettings()) ?? { boardName: DEFAULT_BOARD_NAME, groupBy: '', mode: 'cluster', topic: '' },
  })
}

figma.ui.onmessage = async (msg: ToMain) => {
  try {
    if (msg.type === 'ready') {
      await postPages()
    } else if (msg.type === 'run') {
      const boardName = msg.boardName.trim().slice(0, 60)
      const mode: Mode = msg.mode === 'extract' ? 'extract' : 'cluster'
      const groupBy = mode === 'cluster' ? normalizeGroupBy(msg.groupBy) : ''
      const topic = mode === 'extract' ? normalizeGroupBy(msg.topic) : ''
      if (!boardName) return post({ type: 'error', message: 'Give the new board a name.' })
      if (mode === 'extract' && !topic) return post({ type: 'error', message: 'Type the topic to extract.' })
      assertBoardNameFree(boardName)
      if (msg.scope !== 'all' && !figma.root.children.some((p) => p.id === msg.scope)) {
        await postPages()
        return post({ type: 'error', message: 'That page no longer exists. Pick another one.' })
      }
      await saveSettings({ boardName, groupBy: msg.groupBy, mode, topic: msg.topic })

      lastCache = await loadCache()
      lastItems = await readBoard(lastCache, (message) => post({ type: 'status', message }), msg.scope)
      if (lastItems.length === 0) return post({ type: 'error', message: 'No post-its, text, links or images found on the selected page.' })

      const page = await ensureBoardPage(boardName)
      lastPage = page
      lastScope = msg.scope
      lastGroupBy = groupBy
      lastMode = mode
      lastTopic = topic
      let state = loadState(page)
      if (
        !state ||
        (state.scope ?? 'all') !== msg.scope ||
        (state.mode ?? 'cluster') !== mode ||
        (state.groupBy ?? '') !== groupBy ||
        (state.topic ?? '') !== topic
      ) {
        // new board, or a different page / grouping / topic than this board was built with: start it afresh
        // (embeddings stay cached, so this costs little)
        await clearBoard(page)
        clearState(page)
        state = { clusters: [], unsorted: [], nextId: 1, keys: {} }
        if (page.children.length) post({ type: 'status', message: 'Settings changed — rebuilding this board…' })
      }
      const live = liveKeys()
      const cache: Cache = {}
      for (const [k, v] of Object.entries(lastCache)) if (live.has(k)) cache[k] = v
      post({ type: 'work', items: lastItems, cache, state, placed: await collectPlaced(page), merges: msg.merges ?? [], groupBy, mode, topic })
    } else if (msg.type === 'plan') {
      const plan: Plan = msg.plan
      const page = lastPage!
      const summary = await applyPlan(plan, lastItems, page, lastMode, lastTopic)
      saveState(page, { ...plan.state, scope: lastScope, groupBy: lastGroupBy, mode: lastMode, topic: lastTopic })
      await saveCache(lastCache, plan.newCache, liveKeys(plan.newCache))
      post({ type: 'applied', ok: true, summary: `Board “${page.name}”: ${summary}` })
      await postPages(lastScope)
    } else if (msg.type === 'reset') {
      const page = findPage(msg.boardName.trim())
      if (!page || !isOutputPage(page)) return post({ type: 'error', message: `There is no Clusterry board called “${msg.boardName}”.` })
      await clearBoard(page)
      clearState(page)
      post({ type: 'applied', ok: true, summary: `Reset “${page.name}”. Original items were never touched.` })
    } else if (msg.type === 'close') {
      figma.closePlugin()
    }
  } catch (e) {
    post({ type: 'error', message: String((e as Error).message ?? e) })
  }
}
