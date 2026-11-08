# Clusterry

FigJam plugin that reads a board's post-its, text, shapes, link cards and images and clusters them by
**themes that emerge from the content** (no predefined labels), onto a `[clusters]` page.

## Setup
1. Put your key in `.env` (see `.env.example`): `OPENAI_API_KEY=sk-...`
2. `npm install && npm run build` (re-run after changing `.env`; `npm run watch` rebuilds on save)
3. Figma desktop → open a FigJam board → Plugins → Development → **Import plugin from manifest…** → `manifest.json`
4. Run **Clusterry** → *Cluster board*

`FIGMA_API_KEY` is not used: a plugin reads the open board directly.
**The build inlines `OPENAI_API_KEY` into `dist/ui.html`. Never publish or share `dist/`.**

## The panel
- **Mode** — *Cluster* (below) or *Extract topic*.
- **Topic** (extract mode) — type a topic and only the items that are **about it** are copied to the board, in one frame titled with the topic,
  placed by similarity. The model judges every item (content, plus metadata if the topic is about who/when/what kind); it is deliberately strict:
  items that only share a word with the topic, or are vaguely related, are left out. Verdicts are cached per topic, so re-running only judges new
  items; items that stop matching (or are deleted) are removed from the board, and the ones already placed don't move.
- **New board name** — the page the clusters are written to. Same name = update that board; a new name = a new page, so you can keep several
  groupings side by side. Each board remembers its own clusters. (A page that isn't a Clusterry board is never written to.)
- **Group by** — optional free text, e.g. *"what each person is asking for"*, *"emotional tone"*, *"which stage of the experience it concerns"*.
  The model describes every item along that one dimension in a short phrase (no categories given in advance), and those phrases are what get
  embedded and clustered, so groups still emerge from the data. Empty = plain themes from the content.
  Changing the text rebuilds that board (cached item embeddings are reused; only the new descriptions cost API calls).
- **Page to read** — which page's items to cluster, or all pages.

## What it does
- Reads the page chosen in the panel's **Page to cluster** dropdown (or *All pages*), never `[clusters]`. Ignores authors and timestamps.
  Changing the page or the grouping rebuilds that board (embeddings stay cached).
- Text → embedding (`text-embedding-3-small`, 256 dims). Link cards → title + description + provider.
  Images → described by `gpt-4o-mini`, then the description is embedded (OpenAI has no image embeddings).
- Each item is embedded **once** (cache in `figma.clientStorage`, keyed by content). Re-runs only send new/edited items.
- Clusters are incremental and stable: existing members never move; new items join the nearest cluster if
  close enough, otherwise wait in a pool until three similar ones form a new theme. Leftovers go to **Unsorted**.
- A cluster is renamed only when its size changed by >30%. Near-duplicate clusters are *proposed* for merging, never merged silently.
- Output page (default `[clusters]`): one Section per cluster (FigJam's frame), copies of the items placed by similarity,
  and 1–2 short grey `✦` notes written by the model. Original items are never touched.

## How clusters are cut
No fixed similarity threshold: `src/ui/autocut.ts` chooses where to cut the similarity tree from the data, because what suits
sentences doesn't suit names (measured: post-it text pairs have a median similarity of 0.24, different first names reach 0.44,
synonyms 0.7+). If the data has crisp structure (identical values, e.g. authors) it takes the best cut as is; otherwise it takes the best
cut among a human-sized number of themes that also leaves few items unsorted. Stragglers may join a nearby cluster at a looser similarity.
The cut is stored and reused on later runs, so a few new items never reshuffle existing themes.
The *Tightness* slider shifts the cut for fuzzy data (higher = more, smaller clusters).

## Dev
`npm test` (logic), `npm run typecheck`. Layout: `src/main` touches the board, `src/ui` does network + clustering.
