# AI Usage Monitor

<p align="center">
  <strong>Monitor your AI provider usage in a web dashboard</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white" alt="TypeScript 5.7">
  <img src="https://img.shields.io/badge/Node.js-≥24-green?logo=node.js&logoColor=white" alt="Node.js ≥24">
  <img src="https://img.shields.io/badge/Hono-4.13-purple" alt="Hono 4.13">
  <img src="https://img.shields.io/badge/React-19-blue?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/Vitest-4.0-yellow?logo=vitest&logoColor=white" alt="Vitest 4.0">
  <img src="https://img.shields.io/badge/Playwright-1.62-green?logo=playwright&logoColor=white" alt="Playwright 1.62">
</p>

---

## Supported Providers

| Provider               | Authentication                  | Data                                                         |
| ---------------------- | ------------------------------- | ------------------------------------------------------------ |
| **Anthropic** (API)    | API key                         | Monthly spend, model breakdown                               |
| **Claude** (claude.ai) | Session cookie (+ routing hint) | Tier usage (Standard 5h, Extended 7d)                        |
| **Gemini** (Google AI) | API key                         | Available models                                             |
| **OpenAI** (ChatGPT)   | Admin API key                   | Monthly costs by model                                       |
| **Ollama** (cloud)     | Session cookie                  | Usage percentage                                             |
| **OpenCode**           | workspaceId:sessionCookie       | Balance, 24h / 30d spend, Go plan meters (5h / week / month) |
| **OpenRouter**         | API key                         | Monthly spend, limit                                         |

## Features

- **Multi-provider dashboard** — Monitor all your AI services in one place
- **Status indicators** — Green/red dots per provider + global status
- **Detailed view** — Provider cards show tiers, percentages and reset times directly
- **Configurable auto-refresh** — Refresh interval set in Settings, drives both the frontend polling and the backend cache TTL
- **Persistent settings** — Credentials and refresh interval persist across restarts (config volume)
- **Docker deployable** — Ready to deploy behind Traefik + SSO

## Architecture

```text
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

### Debug a single provider (CLI)

```bash
npm run build
npm run start -- anthropic sk-ant-api03-...   # JSON result for one provider
```

`npm run start` runs the legacy CLI (`dist/fetch-usage.js`) that queries a single
provider with a credential and prints a JSON result — handy to validate a scraper
without opening the dashboard.

## Docker

The image is built and pushed to the private registry via `npm run build:push`
(uses `docker build` + `skopeo copy` with the credentials from `~/.docker/config.json`):

```bash
npm run build:push          # build + push registry.op3n.cloud/ai-usage-monitor:<version>
npm run build:push 1.2.0    # explicit version
```

### Run with environment variables

```bash
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e OPENROUTER_API_KEY=sk-or-... \
  -e REFRESH_INTERVAL_MINUTES=5 \
  -v ai-usage-monitor-config:/home/node/.config/ai-usage-monitor \
  registry.op3n.cloud/ai-usage-monitor:1.2.0
```

Mounting a volume on `/home/node/.config/ai-usage-monitor` makes settings saved
from the dashboard UI (credentials, refresh interval) persist across restarts.

## Configuration

Credentials are loaded from the local config file
`~/.config/ai-usage-monitor/config.json` (created by the Settings UI) or from
**environment variables** (docker). File values take priority over env vars.

### Environment variables

| Variable                              | Provider                                    |
| ------------------------------------- | ------------------------------------------- |
| `ANTHROPIC_API_KEY`                   | Anthropic API                               |
| `CLAUDE_CODE_OAUTH_TOKEN`             | Claude (OAuth token)                        |
| `CLAUDE_SESSION_COOKIE`               | Claude (session cookie)                     |
| `GEMINI_API_KEY`                      | Gemini                                      |
| `OPENAI_ADMIN_KEY` / `OPENAI_API_KEY` | OpenAI                                      |
| `OLLAMA_SESSION_COOKIE`               | Ollama                                      |
| `OPENCODE_SESSION`                    | OpenCode (workspaceId:sessionCookie)        |
| `OPENROUTER_API_KEY`                  | OpenRouter                                  |
| `REFRESH_INTERVAL_MINUTES`            | Default auto-refresh interval (default `5`) |

The refresh interval can be changed at runtime from the **Settings** UI. It is
persisted in the config file and overrides the `REFRESH_INTERVAL_MINUTES` env var.
It drives both the frontend polling interval and the backend cache TTL:
the server re-fetches provider usage from external APIs only when a status
request arrives after the cache has expired (lazy re-fetch — no background traffic).

### Claude credential format

Claude requires a `sessionKey:routingHint` format. The `routingHint` (JWT `sk-ant-rh-...`) is necessary to pass Cloudflare's TLS fingerprint check when calling from Node.js.

### OpenCode credential format

OpenCode uses the console session cookie, in the `workspaceId:sessionCookie` format
(the workspace ID can be omitted — it is then resolved automatically):

1. Sign in at `https://opencode.ai/console`
2. Open DevTools (F12) → Application → Cookies → copy the `__Host-console_session` value (`st_...`)
3. Copy the workspace ID (`wrk_...`) from the console URL
4. Combine: `wrk_01...:st_...`

The provider reads the billing status (balance), the rolling usage windows
(24h / 30d spend) and the Go subscription meters (5h / week / month) from the
console JSON API.

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
# Full gate: lint (biome + markdownlint + prettier), architecture
# (dependency-cruiser), typecheck, unit tests with coverage, build
npm run validate

# Individual checks
npm run typecheck      # tsc --noEmit
npm run test:coverage  # vitest + coverage (dist/coverage)
npm run sonar          # push the analysis to SonarQube (needs SONAR_TOKEN)
```

## License

[MIT](LICENSE.txt)

## Author

Olivier Penhoat — [openhoat@gmail.com](mailto:openhoat@gmail.com)
