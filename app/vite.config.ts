/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the project under /e-Sentinel/; local dev serves at /.
// React Router reads import.meta.env.BASE_URL so its basename stays in sync.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/e-Sentinel/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}))
