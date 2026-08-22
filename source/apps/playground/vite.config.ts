/** biome-ignore-all lint/correctness/noNodejsModules: a Vite config runs in Node, not in the app it configures. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadManifests, loadRunContext } from '@hatua/sdk'
import react from '@vitejs/plugin-react-swc'
import type { Connect } from 'vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * The conformance manifest fixtures, read here rather than in the browser.
 *
 * The playground serves `conformance/manifest/*.yaml` so its ManifestSources
 * hand the Library the same catalogue both SDKs are held to — a hand-written
 * copy would drift from the corpus, and the corpus gains a third reader. But
 * `loadManifests()` brings a YAML parser and zod with it, and importing it from
 * a page would put 170 kB of parser into a chunk the pages share. That is the
 * one thing this app exists to measure, so the parse happens in Node.
 *
 * It is also what a real Host does. A Host validates its manifests where it
 * publishes them and serves the result; nothing about `ManifestSource` implies
 * a parser in the browser.
 *
 * Validating here has a second effect worth having: a fixture that stops
 * parsing fails the build rather than rendering an empty Library.
 */
const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../conformance/manifest/${name}.yaml`, import.meta.url))

const readFixture = (name: string) => loadManifests(readFileSync(fixturePath(name), 'utf8'))

/**
 * The Run Context declaration, appended to the same flat array.
 *
 * A separate fixture and a separate loader — `kind: context` is its own file,
 * with keys instead of fields and outputs — concatenated here because
 * `ManifestSource` returns one array whose entries carry `kind`. A Host doing
 * this for real is doing exactly this: two documents it publishes, one response
 * it serves.
 */
const readContext = () => [loadRunContext(readFileSync(fixturePath('run-context'), 'utf8'))]

const readCatalogue = (name: string) => [...readFixture(name), ...readContext()]

/**
 * Fixtures as data, baked into the bundle at build time. `index.html` and
 * `host.html` take this path: their catalogue is a constant, and the Library
 * renders on the first frame with no request behind it.
 */
const MANIFEST_FIXTURES = 'virtual:hatua/manifests'

const manifestFixtures = (): Plugin => {
  const resolved = `\0${MANIFEST_FIXTURES}`

  return {
    name: 'hatua:manifest-fixtures',
    resolveId: (id) => (id === MANIFEST_FIXTURES ? resolved : null),
    load(id) {
      if (id !== resolved) return null
      const read = (name: string) => {
        // Watched, so editing the corpus hot-reloads the playground the same
        // way editing a package does (ADR-0004).
        this.addWatchFile(fixturePath(name))
        this.addWatchFile(fixturePath('run-context'))
        return readCatalogue(name)
      }
      return [
        `export const CATALOGUE = ${JSON.stringify(read('catalogue'))}`,
        // Declared nothing, not even a Run Context — which is what a fresh Host
        // looks like, and is why the empty state has to be a legitimate answer
        // rather than a failure.
        `export const EMPTY = ${JSON.stringify(readFixture('empty-catalogue'))}`,
      ].join('\n')
    },
  }
}

/**
 * The same fixtures as an endpoint, for `api.html`.
 *
 * That page is the third embedding this harness demonstrates, and the axis it
 * varies is *when* the catalogue arrives, not how the designer is assembled: a
 * real Host does not compile its Component Manifests into its front-end bundle.
 * It serves them, and the manifest set changes when the Host deploys a new
 * component rather than when the Host rebuilds its UI.
 *
 * This is a stand-in and says so. There is no backend here, so the endpoint is
 * a dev-server middleware and, for a built playground, a static file emitted
 * next to the pages. What it faithfully reproduces is the only part Hatua can
 * see: the manifests are not in the page's JavaScript, and the page has to ask.
 * `grep` the built chunks for `component.email.send` — main and host have it, api does
 * not.
 *
 * Deliberately NOT part of `ManifestSource`: fetching is the Host's, all of it.
 * Hatua has no server, no base URL, no auth and no opinion about transport, so
 * a port that took a URL would be Hatua guessing at an HTTP client every Host
 * already has. See src/api-source.ts for the fifteen lines this costs a Host.
 */
const MANIFEST_ENDPOINT = '/api/manifests.json'

/**
 * Claims the whole /api/ namespace, not just the one path, so anything else
 * under it answers 404 instead of falling through to Vite's HTML page. An API
 * that returns 200-and-a-web-page for a URL it does not have is what turns "the
 * endpoint is missing" into "Unexpected token <" three frames later, and
 * /api.html has a checkbox pointing at exactly such a URL.
 *
 * Matched by hand rather than mounted with `use('/api', …)`: connect treats a
 * dot as a path boundary, so that route would also swallow /api.html — the page
 * itself.
 */
const apiMiddleware = (): Connect.NextHandleFunction => (request, response, next) => {
  const path = (request.url ?? '').split('?')[0]
  if (!path?.startsWith('/api/')) return next()

  response.setHeader('content-type', 'application/json')
  if (path !== MANIFEST_ENDPOINT) {
    response.statusCode = 404
    response.end(JSON.stringify({ error: `No such endpoint: ${path}` }))
    return
  }
  // Re-read per request rather than closed over, so editing the corpus shows up
  // on the next load without restarting the dev server.
  response.end(JSON.stringify(readCatalogue('catalogue')))
}

const manifestApi = (): Plugin => ({
  name: 'hatua:manifest-api',
  configureServer: (server) => {
    server.middlewares.use(apiMiddleware())
  },
  /*
   * Preview needs the same middleware, and needs it for the same reason.
   * `configureServer` is a dev-only hook, so without this the built harness —
   * the one README.md calls "the built output, endpoint included" — served
   * dist/api/manifests.json correctly and answered every OTHER /api/ path with
   * 200 and index.html. The checkbox on /api.html then exercised the
   * did-not-return-JSON branch instead of the status-code branch, which is the
   * precise failure the comment above says this plugin exists to prevent.
   */
  configurePreviewServer: (server) => {
    server.middlewares.use(apiMiddleware())
  },
  generateBundle() {
    // The built playground has no dev server, so the endpoint becomes a file at
    // the same path — one URL that works under `vite dev` and `vite preview`
    // alike. A Host reading this should read it as "your backend", not as a
    // pattern worth copying.
    this.emitFile({
      type: 'asset',
      fileName: MANIFEST_ENDPOINT.replace(/^\//, ''),
      source: JSON.stringify(readCatalogue('catalogue')),
    })
  },
})

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
// Four entries, not four routes. A route shares one bundle with everything
// else the app can reach, which would put <Hatua> into the Host-authored page's
// JavaScript whether or not that page uses it. Separate entries give separate
// bundles, so `ls dist/assets` answers what each way of embedding costs — the
// claim ADR-0003 makes about paying only for what you render.
//
// api.html varies a different axis from the rest: every other page bakes the
// catalogue in at build time, and it fetches at run time. Keeping them side by
// side means the difference is visible in the output rather than asserted in a
// comment — the chunk holding the fixture data is loaded by index, host and
// theme, and by api never.
export default defineConfig({
  plugins: [react(), manifestFixtures(), manifestApi(), noStylesheet()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        host: fileURLToPath(new URL('host.html', import.meta.url)),
        api: fileURLToPath(new URL('api.html', import.meta.url)),
        theme: fileURLToPath(new URL('theme.html', import.meta.url)),
      },
    },
  },
})
