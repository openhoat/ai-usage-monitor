import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/web/**', 'node_modules'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text', 'text-summary'],
      reportsDirectory: 'dist/coverage',
      include: ['src/**/*.ts'],
      // The React UI (src/web) is exercised by Playwright e2e, not unit tests;
      // entry points (CLI, server bootstrap, provider registry) are excluded.
      exclude: [
        'src/**/*.test.ts',
        'src/web/**',
        'src/fetch-usage.ts',
        'src/server/index.ts',
        'src/providers/index.ts',
      ],
      thresholds: {
        // Ratchet baselines: set just below the current coverage so the gate
        // blocks regressions. Target is the MCP-style 75/60/65/75 (see the
        // `#test-coverage` item in KANBAN.md); raise these as tests land.
        lines: 60,
        functions: 60,
        branches: 45,
        statements: 55,
      },
    },
  },
})
