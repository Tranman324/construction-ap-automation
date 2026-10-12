/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    testTimeout: 15_000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.apm/archives/**',
      '.apm/worktrees/**',
      'docs/specs/platform/handoff/**',
    ],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
