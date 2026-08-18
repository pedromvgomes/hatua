import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Packages resolve to source, so editing @hatua/model hot-reloads here with no
// build step (ADR-0004 — this is why project references would get in the way).
export default defineConfig({
  plugins: [react()],
})
