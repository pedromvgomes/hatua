import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: [/^@hatua\//, 'zod', 'yaml'] },
  },
  plugins: [dts({ rollupTypes: true })],
  test: { include: ['src/**/*.test.ts'] },
})
