import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
