import { coverageConfigDefaults, defineConfig } from 'vitest/config'

/**
 * A config of its own, rather than the `test` key on vite.config.ts.
 *
 * That file imports @hatua/sdk to read the manifest fixtures in Node, which
 * only resolves under `--configLoader runner` (see package.json). Vitest loads
 * the config its own way, so pointing it at this file keeps the two concerns
 * apart: the app's config builds pages, this one runs the Host's unit tests.
 */
export default defineConfig({
  test: {
    // Both extensions: the Host's testable surface includes api.tsx and
    // host.tsx, and a pattern that matched only .ts would skip a future
    // .test.tsx in silence — the suite would report green rather than "no test
    // files found".
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      // Spread the defaults rather than replacing them, or node_modules and
      // dist join the measurement.
      //
      // What is excluded here cannot be loaded by a test at all, which is why
      // this is not a gate being quietly widened:
      //
      //  * the four entry modules call createRoot() at import time. Importing
      //    one mounts an application; there is no unit of them to cover.
      //  * catalogue.ts imports `virtual:hatua/manifests`, which exists only
      //    while the app's Vite plugin is loaded — and it is deliberately not
      //    loaded here (see above). Instrumenting it fails to resolve.
      //
      // What is left is api-source.ts: the Host's ManifestSource, the one piece
      // of this harness with logic rather than wiring, and the one its tests are
      // about.
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/main.tsx',
        'src/host.tsx',
        'src/api.tsx',
        'src/theme.tsx',
        'src/catalogue.ts',
      ],
    },
  },
})
