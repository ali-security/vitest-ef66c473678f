import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { instances, provider } from '../../settings'

export default defineConfig({
  optimizeDeps: {
    include: ['@vitest/cjs-lib'],
    needsInterop: ['@vitest/cjs-lib'],
  },
  cacheDir: fileURLToPath(new URL("./node_modules/.vite", import.meta.url)),
  test: {
    browser: {
      enabled: true,
      provider,
      instances,
      headless: true,
      // The hosted Windows runner regularly needs more than the default 60s to
      // attach to the Firefox session, which surfaces as an unhandled
      // "Failed to connect to the browser session [firefox] within the timeout"
      // and fails specs/mocking.test.ts. Waiting longer changes no assertion.
      connectTimeout: 180_000,
    },
  },
})
