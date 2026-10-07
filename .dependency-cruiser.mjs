/**
 * Architecture rules for ai-usage-monitor.
 *
 * Layers (a layer may only depend on layers below it):
 *   web        -> React UI (self-contained leaf, built by Vite)
 *   server     -> Hono API + config store (src/server/index.ts is the entry point)
 *   providers  -> provider scrapers (thin adapters over helpers)
 *   helpers    -> shared utilities (fetch wrapper)
 *   root       -> config.ts, types.ts
 *
 * Test files are excluded from the architecture rules.
 */
export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make the code hard to reason about and to test.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Modules that nothing imports are dead code.',
      from: {
        orphan: true,
        pathNot: [
          '\\.test\\.tsx?$',
          '(^|/)index\\.ts$',
          '(^|/)types\\.ts$',
          '(^|/)fetch-usage\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'web-stays-isolated',
      severity: 'error',
      comment:
        'The React UI is self-contained and must not import the server, providers or helpers.',
      from: { path: '^src/web/' },
      to: { path: '^src/', pathNot: '^src/web/' },
    },
    {
      name: 'server-stays-out-of-the-ui',
      severity: 'error',
      comment: 'The server must not import the React UI.',
      from: { path: '^src/server/' },
      to: { path: '^src/web/' },
    },
    {
      name: 'providers-stay-lean',
      severity: 'error',
      comment: 'Provider scrapers must not import the server or the UI.',
      from: { path: '^src/providers/' },
      to: { path: '^src/(server|web)/' },
    },
    {
      name: 'helpers-are-leaves',
      severity: 'error',
      comment: 'Shared helpers may only depend on the root types module.',
      from: { path: '^src/helpers/' },
      to: { path: '^src/', pathNot: '^src/(helpers/|types\\.ts)$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: ['\\.test\\.tsx?$'] },
  },
}
