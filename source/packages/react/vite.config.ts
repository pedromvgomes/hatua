import react from '@vitejs/plugin-react-swc'
import { defineConfig, type Plugin } from 'vite'
import dts from 'vite-plugin-dts'
import { coverageConfigDefaults } from 'vitest/config'

/**
 * ADR-0003: a Host imports nothing. Every component renders its own CSS through
 * React 19's <style href precedence>, and the text it renders comes from the
 * `?inline` import — so the CSS is already inside the JS chunk.
 *
 * Each component also imports the same file without the query, for its
 * class-name map, and that import is what makes Vite extract a stylesheet
 * alongside the bundle. Nothing imports that file, and shipping it would
 * advertise exactly the escape hatch the ADR defers: "the lib build inlines
 * that CSS into the JS by design — so exporting the path today would resolve to
 * a file the build never emits." Dropping it here is what makes that true.
 *
 * `order: 'post'` is load-bearing — the CSS asset is added to the bundle by a
 * plugin that runs after the default position, so an unordered hook sees a
 * bundle that does not contain it yet. The playground carries the same plugin
 * plus a matching one for the <link> tag; see apps/playground/vite.config.ts.
 *
 * It runs for the library build only. Storybook's builder reads this same file
 * and then does its own per-story code splitting, emitting chunks that preload
 * their CSS by name — delete those assets and every story fails on a 404. The
 * library build is the one whose output a Host installs, and it is the one the
 * ADR is about.
 */
const dropExtractedStylesheet = (): Plugin => {
  let isLibraryBuild = false
  return {
    name: 'hatua:no-stylesheet',
    configResolved(config) {
      isLibraryBuild = Boolean(config.build.lib)
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (!isLibraryBuild) return
        for (const fileName of Object.keys(bundle)) {
          if (bundle[fileName]?.type === 'asset' && fileName.endsWith('.css')) {
            delete bundle[fileName]
          }
        }
      },
    },
  }
}

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: [/^@hatua\//, 'react', 'react-dom', 'react/jsx-runtime'] },
  },
  plugins: [
    react(),
    // Stories, tests and the vitest setup file are inside src so they sit
    // beside what they cover; none of them belongs in a consumer's types.
    dts({
      rollupTypes: true,
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.stories.tsx', 'src/setupTests.ts'],
    }),
    dropExtractedStylesheet(),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/setupTests.ts'],
    coverage: {
      // Spread the defaults rather than replacing them — a bare `exclude` drops
      // node_modules and dist from the list and coverage starts measuring the
      // dependency tree.
      //
      // Stories are excluded because they are not the library: they document it,
      // they ship to the Storybook rather than to a Host, and counting them
      // reported this package at 49% while every component in it was at 100%.
      // A coverage gate that can be satisfied by testing the stories is worse
      // than no gate.
      //
      // `storybook-static/` is the same mistake with the opposite sign, and it
      // bites harder. The defaults drop `dist/` and `node_modules/` but know
      // nothing about Storybook's output directory, so anyone who had run
      // `storybook:build` before measuring added ~100k lines of bundled,
      // minified JS to the denominator and reported this package at 1% — with
      // every component in it still at 100%. It is gitignored, so it never
      // shows up in a diff; the only sign is a coverage number that collapses
      // for no reason anyone can point at in the source.
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/**/*.stories.tsx',
        'src/setupTests.ts',
        'storybook-static/**',
      ],
    },
  },
})
