import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { handleGetConfig, handleSaveConfig, handleStatus, refreshAll } from './api-handler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = new Hono()

// API routes
app.get('/api/status', async c => {
  const result = await handleStatus()
  return c.json(result)
})

app.post('/api/refresh', async c => {
  const result = await refreshAll()
  return c.json(result)
})

app.get('/api/config', c => {
  const result = handleGetConfig()
  return c.json(result)
})

app.put('/api/config', async c => {
  const body = await c.req.json<Record<string, unknown>>()
  const result = handleSaveConfig({
    anthropic_api_key: typeof body.anthropic_api_key === 'string' ? body.anthropic_api_key : '',
    claude_token: typeof body.claude_token === 'string' ? body.claude_token : '',
    gemini_api_key: typeof body.gemini_api_key === 'string' ? body.gemini_api_key : '',
    openai_api_key: typeof body.openai_api_key === 'string' ? body.openai_api_key : '',
    ollama_session_cookie:
      typeof body.ollama_session_cookie === 'string' ? body.ollama_session_cookie : '',
    opencode_session: typeof body.opencode_session === 'string' ? body.opencode_session : '',
    openrouter_api_key: typeof body.openrouter_api_key === 'string' ? body.openrouter_api_key : '',
    refresh_interval_minutes:
      typeof body.refresh_interval_minutes === 'number' ? body.refresh_interval_minutes : 0,
  })
  return c.json(result)
})

// 404 for unknown /api/* routes
app.all('/api/*', c => c.json({ error: 'Not found' }, 404))

// Serve the built web app (SPA) in production
const webDist = join(__dirname, '..', 'web')
app.use('*', serveStatic({ root: webDist }))
app.get('*', c => {
  try {
    const html = readFileSync(join(webDist, 'index.html'), 'utf-8')
    return c.html(html)
  } catch {
    return c.text('Web build not found. Run `npm run build:web`.', 404)
  }
})

export function startServer(port?: number): void {
  const serverPort = port || Number.parseInt(process.env.PORT || '3000', 10)
  const server = serve({ fetch: app.fetch, port: serverPort })
  process.stdout.write(`🚀 API backend running at http://localhost:${serverPort}\n`)
  process.stdout.write('   Press Ctrl+C to stop\n')
  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })
}

// Auto-start when run directly
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMainModule) {
  startServer()
}
