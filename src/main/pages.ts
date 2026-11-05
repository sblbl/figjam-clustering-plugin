export const DEFAULT_BOARD_NAME = '[clusters]'
const MARK = 'clusterry:output'

/** An output board is a page this plugin created (or the legacy "[clusters]" page). Never read as source. */
export function isOutputPage(page: PageNode): boolean {
  return page.getPluginData(MARK) === '1' || page.name === DEFAULT_BOARD_NAME
}

export function findPage(name: string): PageNode | undefined {
  return figma.root.children.find((p) => p.name === name)
}

/** Throws if the name belongs to a page that is not one of ours (we never write into your source pages). */
export function assertBoardNameFree(name: string): void {
  const p = findPage(name)
  if (p && !isOutputPage(p)) {
    throw new Error(`A page called "${name}" already exists and isn't a Clusterry board. Choose another name.`)
  }
}

export async function ensureBoardPage(name: string): Promise<PageNode> {
  assertBoardNameFree(name)
  let page = findPage(name)
  if (!page) {
    page = figma.createPage()
    page.name = name
  }
  page.setPluginData(MARK, '1')
  await page.loadAsync()
  return page
}
