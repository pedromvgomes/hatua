/** biome-ignore-all lint/correctness/noNodejsModules: a Vite config runs in Node, not in the app it configures. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadManifests } from '@hatua/sdk'
import react from '@vitejs/plugin-react-swc'
import { defineConfig, type Plugin } from 'vite'

/**
 * The conformance manifest fixtures, parsed here rather than in the browser.
 *
 * The playground serves `conformance/manifest/*.yaml` so its ManifestSource
 * hands the Library the same catalogue both SDKs are held to — a hand-written
 * copy would drift from the corpus, and the corpus gains a third reader. But
 * `loadManifests()` brings a YAML parser and zod with it, and importing it from
 * a page would put 170 kB of parser into the chunk both entries share. That is
 * the one thing this app exists to measure, so the parse happens at build time
 * and the pages import data.
 *
 * It is also what a real Host does. A Host validates its manifests where it
 * publishes them and serves the result; nothing about `ManifestSource` implies
 * a parser in the browser.
 *
 * Validating here has a second effect worth having: a fixture that stops
 * parsing fails the build rather than rendering an empty Library.
 */
const MANIFEST_FIXTURES = 'virtual:hatua/manifests'

const manifestFixtures = (): Plugin => {
  const resolved = `\0${MANIFEST_FIXTURES}`
  const fixture = (name: string) =>
    fileURLToPath(new URL(`../../conformance/manifest/${name}.yaml`, import.meta.url))

  return {
    name: 'hatua:manifest-fixtures',
    resolveId: (id) => (id === MANIFEST_FIXTURES ? resolved : null),
    load(id) {
      if (id !== resolved) return null
      const read = (name: string) => {
        const path = fixture(name)
        // Watched, so editing the corpus hot-reloads the playground the same
        // way editing a package does (ADR-0004).
        this.addWatchFile(path)
        return loadManifests(readFileSync(path, 'utf8'))
      }
      return [
        `export const CATALOGUE = ${JSON.stringify(read('catalogue'))}`,
        `export const EMPTY = ${JSON.stringify(read('empty-catalogue'))}`,
      ].join('\n')
    },
  }
}

/**
 * Neither entry imports a stylesheet, and neither built page links one.
 *
 * Vite still extracts one, because @hatua/react resolves to source here
 * (ADR-0004) and every primitive imports its CSS Module twice — once as
 * `?inline` for the text it renders itself, once bare for the class-name map.
 * The second import is what produces the asset. A Host installing the package
 * gets dist/index.js, which has no such file; leaving it in the playground's
 * output would mean this harness paints correctly whether or not ADR-0003's
 * mechanism works, which is the one thing it must not do.
 *
 * With the asset dropped AND the <link> stripped, everything either page paints
 * arrived through a component's own <style href precedence>. Break that and the
 * playground renders unstyled — which is the point.
 *
 * The library build carries the first half of this; see
 * packages/react/vite.config.ts for why the hook has to be ordered post.
 */
const noStylesheet = (): Plugin => ({
  name: 'hatua:no-stylesheet',
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (bundle[fileName]?.type === 'asset' && fileName.endsWith('.css')) delete bundle[fileName]
      }
    },
  },
  transformIndexHtml: {
    order: 'post',
    handler: (html) => html.replace(/\s*<link rel="stylesheet"[^>]*>/g, ''),
  },
})

// Packages resolve to source, so editing @hatua/model hot-reloads here with no
// build step (ADR-0004 — this is why project references would get in the way).
//
// Two entries, not two routes. A route shares one bundle with everything else
// the app can reach, which would put <Hatua> into the Host-authored page's
// JavaScript whether or not that page uses it. Separate entries give separate
// bundles, so `ls dist/assets` answers what each way of embedding costs — the
// claim ADR-0003 makes about paying only for what you render.
export default defineConfig({
  plugins: [react(), manifestFixtures(), noStylesheet()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        host: fileURLToPath(new URL('host.html', import.meta.url)),
      },
    },
  },
})
