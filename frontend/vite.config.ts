import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js references Node's `global`, which doesn't
  // exist in browsers (only in jsdom test environments, which is why this
  // wasn't caught by the unit test suite) — aliasing it to globalThis is
  // the standard fix for this well-known Vite + Cognito SDK issue.
  define: {
    global: 'globalThis',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
