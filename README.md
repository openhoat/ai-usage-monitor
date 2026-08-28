# AI Usage Monitor

<p align="center">
  <strong>Monitor your AI provider usage in a web dashboard</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white" alt="TypeScript 5.7">
  <img src="https://img.shields.io/badge/Node.js-≥22-green?logo=node.js&logoColor=white" alt="Node.js ≥22">
  <img src="https://img.shields.io/badge/Hono-4.13-purple" alt="Hono 4.13">
  <img src="https://img.shields.io/badge/React-19-blue?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/Vitest-4.0-yellow?logo=vitest&logoColor=white" alt="Vitest 4.0">
  <img src="https://img.shields.io/badge/Playwright-1.62-green?logo=playwright&logoColor=white" alt="Playwright 1.62">
</p>

---

## Supported Providers

| Provider | Authentication | Data |
|----------|---------------|------|
| **Anthropic** (API) | API key | Monthly spend, model breakdown |
| **Claude** (claude.ai) | Session cookie (+ routing hint) | Tier usage (Standard 5h, Extended 7d) |
| **Gemini** (Google AI) | API key | Available models |
| **OpenAI** (ChatGPT) | Admin API key | Monthly costs by model |
| **Ollama** (cloud) | Session cookie | Usage percentage |
| **OpenCode Go** | workspaceId:authCookie | Rolling, weekly, monthly usage |
| **OpenCode Zen** | workspaceId:authCookie | Balance, monthly spend |
| **OpenRouter** | API key | Monthly spend, limit |

## Features

- **Multi-provider dashboard** — Monitor all your AI services in one place
- **Status indicators** — Green/red dots per provider + global status
- **Detailed view** — Expand each provider card to see tiers, percentages, reset times
- **Auto-refresh** — Every 5 minutes (configurable via TanStack Query)
- **Docker deployable** — Ready to deploy behind Traefik + SSO

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React)                │
│              src/web/ (Vite + Tailwind)          │
├─────────────────────────────────────────────────┤
│                  API (Hono)                      │
│              src/server/ (Node.js)               │
├─────────────────────────────────────────────────┤
│              Provider scrapers                   │
│              src/providers/                      │
└─────────────────────────────────────────────────┘
```

- **Hono** — Lightweight API framework replacing the original `http` server
- **React 19** — SPA dashboard with TanStack Query for data fetching
- **Tailwind CSS** — Utility-first styling
- **Playwright** — E2E tests for the dashboard

## Installation

### Development

```bash
npm install
npm run dev:web
```

This starts two servers:
- **Vite dev server** at `http://localhost:5173` (hot-reload)
- **Hono API backend** at `http://localhost:3000`

Vite proxies `/api` requests to the API server.

### Production build

```bash
npm run build
npm run start:web
```

The server serves the built SPA from `dist/web/` and the API from `dist/server/`.

### Docker

```bash
# Build the image
docker build -t ai-usage-monitor .

# Run with environment variables for credentials
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e OPENROUTER_API_KEY=sk-or-... \
  ai-usage-monitor
```

## Configuration

Credentials are loaded from **environment variables** (docker) or the local config file at `~/.config/ai-usage-monitor/config.json` (dev).

### Environment variables

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude (OAuth token) |
| `CLAUDE_SESSION_COOKIE` | Claude (session cookie) |
| `GEMINI_API_KEY` | Gemini |
| `OPENAI_ADMIN_KEY` / `OPENAI_API_KEY` | OpenAI |
| `OLLAMA_SESSION_COOKIE` | Ollama |
| `OPENCODE_GO_SESSION` | OpenCode Go (workspaceId:authCookie) |
| `OPENCODE_ZEN_SESSION` | OpenCode Zen (workspaceId:authCookie) |
| `OPENROUTER_API_KEY` | OpenRouter |

### Claude credential format

Claude requires a `sessionKey:routingHint` format. The `routingHint` (JWT `sk-ant-rh-...`) is necessary to pass Cloudflare's TLS fingerprint check when calling from Node.js.

## Development

### Test

```bash
# Unit tests (vitest)
npm test

# E2E tests (Playwright)
npm run test:e2e
```

### Code quality

```bash
npm run validate
```

## License

[MIT](LICENSE.txt)

## Author

Olivier Penhoat — [openhoat@gmail.com](mailto:openhoat@gmail.com)