declare const __OPENAI_API_KEY__: string

const EMBED_MODEL = 'text-embedding-3-small'
const EMBED_DIMS = 256
const CHAT_MODEL = 'gpt-4o-mini'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!__OPENAI_API_KEY__) throw new Error('OPENAI_API_KEY is empty. Put it in .env and run `npm run build` again.')
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${__OPENAI_API_KEY__}` },
      body: JSON.stringify(body),
    })
    if (res.ok) return (await res.json()) as T
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(800 * 2 ** attempt)
      continue
    }
    let detail = ''
    try {
      detail = (await res.json()).error?.message ?? ''
    } catch {}
    throw new Error(`OpenAI ${res.status}: ${detail || res.statusText}`)
  }
}

const round = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4)

export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 2000) || ' ')
    const r = await post<{ data: { index: number; embedding: number[] }[] }>('embeddings', {
      model: EMBED_MODEL,
      dimensions: EMBED_DIMS,
      input: batch,
    })
    r.data.sort((a, b) => a.index - b.index).forEach((d) => out.push(round(d.embedding)))
  }
  return out
}

/** OpenAI has no image-embedding model, so photos are described in words and the description is embedded. */
export async function captionImage(b64png: string): Promise<string> {
  const r = await post<{ choices: { message: { content: string } }[] }>('chat/completions', {
    model: CHAT_MODEL,
    max_tokens: 90,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'This image is an item on a workshop whiteboard. In one or two plain sentences, say what it shows and what topic or theme it relates to, and transcribe any handwritten or caption text. Do NOT put author names or timestamps in that description. If an author name and/or timestamp is visible, add a final line exactly like `STAMP: name, timestamp`; otherwise `STAMP: none`.',
          },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64png}`, detail: 'low' } },
        ],
      },
    ],
  })
  return r.choices[0].message.content.trim()
}

export interface NamingInput {
  id: string
  texts: string[]
}
export interface NamingOutput {
  id: string
  name: string
  notes: string[]
}

export async function nameClusters(clusters: NamingInput[], groupBy = ''): Promise<NamingOutput[]> {
  if (clusters.length === 0) return []
  const listing = clusters
    .map((c) => `CLUSTER ${c.id}\n` + c.texts.slice(0, 14).map((t) => `- ${t.slice(0, 220).replace(/\s+/g, ' ')}`).join('\n'))
    .join('\n\n')
  const r = await post<{ choices: { message: { content: string } }[] }>('chat/completions', {
    model: CHAT_MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You label clusters of items from a workshop whiteboard. Each cluster is a group that emerged from the content; there is no fixed taxonomy. ' +
          (groupBy
            ? `The user grouped the items by: "${groupBy}". Items may show "[…]" after their text: that is how each item was described along that dimension. Name each cluster by what its items share on that dimension. `
            : '') +
          'For every cluster return: "name" — a concrete 2-4 word name that says what is specific about THIS group and would not fit the other clusters (never generic words like "Ideas", "Miscellaneous", "General"); ' +
          '"notes" — one or two very short sticky notes (max 8 words each): a sharp one-line summary of the theme, or an open question the group raises. ' +
          'Write in the language most of the items use. Reply as JSON: {"clusters":[{"id":"…","name":"…","notes":["…"]}]}.',
      },
      { role: 'user', content: listing },
    ],
  })
  const parsed = JSON.parse(r.choices[0].message.content) as { clusters?: NamingOutput[] }
  return (parsed.clusters ?? []).map((c) => ({
    id: String(c.id),
    name: String(c.name ?? '').trim().slice(0, 60),
    notes: (Array.isArray(c.notes) ? c.notes : []).slice(0, 2).map((n) => String(n).trim().split(/\s+/).slice(0, 10).join(' ')),
  }))
}

/**
 * "Group by" support: describe every item along ONE dimension the user typed, in a short phrase. Items that share a
 * value get near-identical phrases, so the phrases (not the original wording) are what gets embedded and clustered.
 * No categories are given in advance — the vocabulary comes from the model reading the actual items.
 */
export async function describeAlong(groupBy: string, items: { text: string; meta: string }[]): Promise<string[]> {
  const out: string[] = new Array(items.length).fill('')
  const BATCH = 40
  for (let start = 0; start < items.length; start += BATCH) {
    const slice = items.slice(start, start + BATCH)
    const listing = slice
      .map((t, i) => `${i}: CONTENT: ${t.text.slice(0, 400).replace(/\s+/g, ' ') || '(none)'}\n   METADATA: ${t.meta}`)
      .join('\n')
    const r = await post<{ choices: { message: { content: string } }[] }>('chat/completions', {
      model: CHAT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            `You prepare workshop-whiteboard items for grouping. The user wants to group them by: "${groupBy}". ` +
            'Each item has CONTENT (what it says or shows) and METADATA (author, time, type, colour, section, page, site). Use whichever of the two the dimension is about: ' +
            'if it concerns who wrote an item, when, what kind of item or colour it is, or where it sits, read it from METADATA; if it concerns meaning, read it from CONTENT. ' +
            'For each numbered item write ONE short phrase (2-8 words) giving its value on exactly that dimension, ignoring everything else about it. ' +
            'Use the exact metadata value when the dimension is a metadata field (e.g. the author name, or the hour for "time of day"). ' +
            'Items that share the same value must get the same or near-identical phrasing, so reuse your own wording across items. ' +
            'Do not use a fixed list of categories: let the values come from the items themselves. ' +
            'If an item says nothing about the dimension, write "unclear". Write in the language most items use. ' +
            'Reply as JSON: {"items":[{"i":0,"v":"…"}]}.',
        },
        { role: 'user', content: listing },
      ],
    })
    const parsed = JSON.parse(r.choices[0].message.content) as { items?: { i: number; v: string }[] }
    for (const it of parsed.items ?? []) if (Number.isInteger(it.i) && it.i >= 0 && it.i < slice.length) out[start + it.i] = String(it.v ?? '').trim()
  }
  return out.map((v) => v || 'unclear')
}
