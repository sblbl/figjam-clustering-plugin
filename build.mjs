// Bundles the plugin. Reads OPENAI_API_KEY from .env and inlines it into the UI bundle
// (a plugin cannot read .env at runtime). NEVER publish a build made this way.
import { build, context } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import dotenv from 'dotenv'

dotenv.config()
const watch = process.argv.includes('--watch')
const key = process.env.OPENAI_API_KEY || ''
if (!key) console.warn('⚠  OPENAI_API_KEY is empty — set it in .env before running the plugin.')

mkdirSync('dist', { recursive: true })

const common = { bundle: true, target: 'es2019', logLevel: 'info' }

async function buildUi() {
  const r = await build({
    ...common,
    entryPoints: ['src/ui/ui.ts'],
    write: false,
    format: 'iife',
    define: { __OPENAI_API_KEY__: JSON.stringify(key) },
  })
  const js = r.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>')
  const html = readFileSync('src/ui/ui.html', 'utf8').replace('/*__SCRIPT__*/', () => js)
  writeFileSync('dist/ui.html', html)
}

const mainOpts = { ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/code.js', format: 'iife' }

await buildUi()
if (watch) {
  const ctx = await context(mainOpts)
  await ctx.watch()
  const { watch: fsWatch } = await import('node:fs')
  fsWatch('src/ui', { recursive: true }, () => buildUi().catch(console.error))
  console.log('watching…')
} else {
  await build(mainOpts)
}
