import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// base: './' keeps every asset path relative so the built app can be opened
// from disk and embedded in a webview (SPEC §0, §11).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
