import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    baseURL: 'http://localhost:3999',
  },
  webServer: {
    command: 'PORT=3999 node dist/server/index.js',
    port: 3999,
    reuseExistingServer: true,
    timeout: 30000,
  },
})
