/** biome-ignore-all lint/correctness/noNodejsModules: a Vite config runs in Node, not in the app it configures. */
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react-swc'
import { defineConfig, type Plugin } from 'vite'

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
  plugins: [react(), noStylesheet()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        host: fileURLToPath(new URL('host.html', import.meta.url)),
      },
    },
  },
})
