import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

/**
 * `HATUA_EXPR_GENERATED` is how `tools/expression`'s build verifies a freshly
 * generated parser *before* promoting it: the staged output is aliased in, the
 * suite runs against it, and only a green run is written into `src/generated`.
 * Unset — which is every ordinary run — it resolves to the committed output.
 */
const generated = process.env.HATUA_EXPR_GENERATED

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: [/^@hatua\//] },
  },
  plugins: [dts({ rollupTypes: true })],
  resolve: generated
    ? { alias: [{ find: /^#generated\/(.*)$/, replacement: `${generated}/$1` }] }
    : {},
  test: { include: ['src/**/*.test.ts'] },
})
