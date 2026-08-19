import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: [/^@hatua\//, 'react', 'react-dom', 'react/jsx-runtime'] },
  },
  plugins: [react(), dts({ rollupTypes: true })],
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
})
