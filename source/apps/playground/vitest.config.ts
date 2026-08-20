import { defineConfig } from 'vitest/config'

/**
 * A config of its own, rather than the `test` key on vite.config.ts.
 *
 * That file imports @hatua/sdk to read the manifest fixtures in Node, which
 * only resolves under `--configLoader runner` (see package.json). Vitest loads
 * the config its own way, so pointing it at this file keeps the two concerns
 * apart: the app's config builds pages, this one runs the Host's unit tests.
 */
export default defineConfig({
  // Both extensions: the Host's testable surface includes api.tsx and host.tsx,
  // and a pattern that matched only .ts would skip a future .test.tsx in
  // silence — the suite would report green rather than "no test files found".
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
