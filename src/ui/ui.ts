import { applyMerge, DEFAULT_PARAMS, GROUP_BY_PARAMS, isUnclear, normalize, proposeMerges, updateClusters } from './cluster'
import { layoutCluster } from './layout'
import { parseCaption } from '../caption'
import { facetKey, fullMeta } from '../hash'
import { captionImage, describeAlong, embed, nameClusters } from './openai'
import { GAP, NOTE_SIZE, PAD } from '../types'
import type { BoardItem, Cache, Params, Placed, Plan, PlanFrame, State, ToMain, ToUi } from '../types'

const $ = (id: string) => document.getElementById(id)!
const logEl = $('log')
const runBtn = $('run') as HTMLButtonElement
const tight = $('tight') as HTMLInputElement
const pageSel = $('page') as HTMLSelectElement
const boardEl = $('board') as HTMLInputElement
const groupEl = $('group') as HTMLTextAreaElement
let settingsLoaded = false
const send = (m: ToMain) => parent.postMessage({ pluginMessage: m }, '*')
const log = (s: string, err = false) => {
  logEl.textContent = s
  logEl.className = 'log' + (err ? ' err' : '')
}

tight.oninput = () => (($('tv').textContent = Number(tight.value).toFixed(2)))
runBtn.onclick = () => start([])
send({ type: 'ready' })
let armed: ReturnType<typeof setTimeout> | null = null
const resetBtn = $('reset') as HTMLButtonElement
resetBtn.onclick = () => {
  // confirm() is blocked inside plugin iframes, so ask with a second click
  if (armed === null) {
    resetBtn.textContent = 'Click again to confirm'
    armed = setTimeout(() => {
      armed = null
      resetBtn.textContent = 'Reset'
    }, 4000)
    return
  }
  clearTimeout(armed)
  armed = null
  resetBtn.textContent = 'Reset'
  send({ type: 'reset', boardName: boardEl.value })
}

function start(merges: [string, string][]) {
  runBtn.disabled = true
  $('merges').innerHTML = ''
  log('Reading board…')
  send({ type: 'run', scope: pageSel.value, boardName: boardEl.value, groupBy: groupEl.value, merges })
}

function paramsFromSlider(groupBy: boolean): Params {
  const t = Number(tight.value)
  // higher tightness → a stricter cut → more, smaller clusters (only shifts fuzzy data; crisp values like names stay exact)
  const bump = (t - 1) * 0.25
  const base = groupBy ? GROUP_BY_PARAMS : DEFAULT_PARAMS
  return { ...base, tauOffset: bump, tauAssign: base.tauAssign + bump, tauForm: base.tauForm + bump }
}

async function pool<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++
        out[i] = await fn(xs[i])
      }
    }),
  )
  return out
}

async function work(msg: Extract<ToUi, { type: 'work' }>) {
  const { items, cache, placed } = msg
  let state: State = msg.state
  const params = paramsFromSlider(!!msg.groupBy)
  for (const [a, b] of msg.merges) state = applyMerge(state, a, b)

  // 1) caption new images, then embed anything not cached — embeddings are computed once per item+content
  const todo = items.filter((i) => !cache[i.key])
  const imgs = todo.filter((i) => i.kind === 'image' && i.imageB64)
  let done = 0
  const captions = await pool(imgs, 4, async (i) => {
    const c = await captionImage(i.imageB64!)
    log(`Describing images… ${++done}/${imgs.length}`)
    return c
  })
  const stamps = new Map<string, string>()
  imgs.forEach((i, n) => {
    const c = parseCaption(captions[n])
    i.text = [i.text, c.text].filter(Boolean).join(' — ')
    if (c.stamp) stamps.set(i.key, `stamp on image: ${c.stamp}`)
  })
  const embeddable = todo.filter((i) => i.text.trim())
  log(`Embedding ${embeddable.length} new items (${items.length - todo.length} cached)…`)
  const vectors = await embed(embeddable.map((i) => i.text))
  const newCache: Cache = {}
  embeddable.forEach((i, n) => (newCache[i.key] = { t: i.text, e: vectors[n], ...(stamps.has(i.key) ? { m: stamps.get(i.key) } : {}) }))
  const entry = (i: BoardItem) => newCache[i.key] ?? cache[i.key]

  const usable = items.filter((i) => entry(i))
  const byId = new Map(usable.map((i) => [i.id, i]))

  // 2) "group by": describe each item along the requested dimension, then cluster those descriptions instead
  const groupBy = msg.groupBy
  let faceted = 0
  const metaOf = (i: BoardItem) => fullMeta(i.meta, entry(i).m)
  const fKey = (i: BoardItem) => facetKey(groupBy, i.key, metaOf(i))
  if (groupBy) {
    const need = usable.filter((i) => !newCache[fKey(i)] && !cache[fKey(i)])
    if (need.length) {
      log(`Describing ${need.length} items by “${groupBy}”…`)
      const phrases = await describeAlong(groupBy, need.map((i) => ({ text: entry(i).t, meta: metaOf(i) })))
      log(`Embedding ${need.length} descriptions…`)
      const fv = await embed(phrases)
      need.forEach((i, n) => (newCache[fKey(i)] = { t: phrases[n], e: fv[n] }))
      faceted = need.length
    }
  }
  const clusterEntry = (id: string) => {
    const i = byId.get(id)!
    return groupBy ? newCache[fKey(i)] ?? cache[fKey(i)] : entry(i)
  }
  const vecOf = (id: string) => normalize(clusterEntry(id).e)
  const textOf = (id: string) => {
    const i = byId.get(id)!
    return groupBy ? `${entry(i).t} [${clusterEntry(id).t}]` : entry(i).t
  }

  // 3) incremental clustering
  log('Clustering…')
  const stateKey = (i: BoardItem) => (groupBy ? fKey(i) : i.key)
  const reset = new Set(usable.filter((i) => state.keys[i.id] !== undefined && state.keys[i.id] !== stateKey(i)).map((i) => i.id))
  const forceUnsorted = new Set(groupBy ? usable.filter((i) => isUnclear(clusterEntry(i.id).t)).map((i) => i.id) : [])
  const upd = updateClusters({ prev: state, items: usable.map((i) => ({ id: i.id, vec: vecOf(i.id) })), reset, params, forceUnsorted })
  state = upd.state
  console.log(`clustering: ${upd.regime}, cut ${state.tau?.toFixed(3) ?? 'n/a'}, ${upd.created} new clusters, ${upd.assigned} items joined existing ones`)
  state.keys = Object.fromEntries(usable.map((i) => [i.id, stateKey(i)]))

  // 4) name only new / substantially changed clusters
  const toName = state.clusters.filter((c) => upd.needsNaming.includes(c.id))
  if (toName.length) log(`Naming ${toName.length} cluster${toName.length > 1 ? 's' : ''}…`)
  const names = await nameClusters(toName.map((c) => ({ id: c.id, texts: c.members.map(textOf) })), groupBy)
  const renamed = new Set<string>()
  for (const c of state.clusters) {
    const n = names.find((x) => x.id === c.id)
    if (n && n.name) {
      c.name = n.name
      c.notes = n.notes.filter(Boolean)
      c.namedSize = c.members.length
      renamed.add(c.id)
    } else if (c.name === null) c.name = 'Untitled'
  }

  // 5) layout (existing positions stay)
  const frames: PlanFrame[] = []
  const groups: { id: string; name: string; members: string[]; notes: string[] }[] = [
    ...state.clusters.map((c) => ({ id: c.id, name: c.name!, members: c.members, notes: c.notes })),
    ...(state.unsorted.length ? [{ id: 'unsorted', name: 'Unsorted', members: state.unsorted, notes: [] as string[] }] : []),
  ]
  for (const g of groups) {
    const top = g.notes.length ? PAD + NOTE_SIZE + GAP : PAD
    const res = layoutCluster(
      g.members.map((id) => {
        const it = byId.get(id)!
        const p: Placed | undefined = placed[id]
        return { id, vec: vecOf(id), w: it.w, h: it.h, fixed: p && p.cluster === g.id ? { x: p.x, y: p.y } : undefined }
      }),
      { pad: PAD, gap: GAP, top },
    )
    frames.push({
      id: g.id,
      name: g.name,
      notes: g.notes,
      notesChanged: renamed.has(g.id),
      items: g.members.map((id) => ({ id, ...res.positions[id] })),
      width: Math.max(res.width, g.notes.length * (NOTE_SIZE + GAP) + PAD * 2 - GAP),
      height: res.height,
    })
  }

  const merges = proposeMerges(state, vecOf, params).map((m) => ({
    ...m,
    aName: state.clusters.find((c) => c.id === m.a)!.name ?? m.a,
    bName: state.clusters.find((c) => c.id === m.b)!.name ?? m.b,
  }))

  const plan: Plan = {
    state,
    newCache,
    frames,
    merges,
    stats: { items: usable.length, embedded: embeddable.length, captioned: imgs.length, cached: items.length - todo.length, named: toName.length, faceted },
  }
  lastPlan = plan
  send({ type: 'plan', plan })
  log('Writing to the [clusters] page…')
}

let lastPlan: Plan | null = null

onmessage = async (ev) => {
  const msg = ev.data.pluginMessage as ToUi
  if (!msg) return
  try {
    if (msg.type === 'work') await work(msg)
    else if (msg.type === 'pages') {
      pageSel.innerHTML = ''
      for (const p of [{ id: 'all', name: 'All pages' }, ...msg.pages]) {
        const o = document.createElement('option')
        o.value = p.id
        o.textContent = p.name
        pageSel.appendChild(o)
      }
      pageSel.value = msg.selected
      if (msg.settings && !settingsLoaded) {
        boardEl.value = msg.settings.boardName
        groupEl.value = msg.settings.groupBy
      }
      settingsLoaded = true
    } else if (msg.type === 'status') log(msg.message)
    else if (msg.type === 'error') {
      log(msg.message, true)
      runBtn.disabled = false
    } else if (msg.type === 'applied') {
      runBtn.disabled = false
      const s = lastPlan?.stats
      log(
        msg.summary +
          (s ? `\n\nAPI work this run: ${s.embedded} embedded, ${s.captioned} images described, ${s.faceted ? s.faceted + ' described by your grouping, ' : ''}${s.named} clusters named; ${s.cached} items reused from cache.` : ''),
      )
      const box = $('merges')
      box.innerHTML = ''
      for (const m of lastPlan?.merges ?? []) {
        const row = document.createElement('div')
        row.className = 'merge'
        row.innerHTML = `<span>“${m.aName}” ≈ “${m.bName}” (${m.sim.toFixed(2)})</span>`
        const b = document.createElement('button')
        b.className = 'secondary'
        b.textContent = 'Merge'
        b.onclick = () => start([[m.a, m.b]])
        row.appendChild(b)
        box.appendChild(row)
      }
    }
  } catch (e) {
    log(String((e as Error).message || e), true)
    runBtn.disabled = false
  }
}
