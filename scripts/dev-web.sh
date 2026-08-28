#!/usr/bin/env bash
set -euo pipefail

# Launch both the Hono API server and the Vite dev server.
# Vite proxies /api requests to the Hono server.

echo "🌐 AI Usage Monitor — Dev mode"
echo ""
echo "   Frontend: http://localhost:5173"
echo "   API:      http://localhost:3000"
echo "   (Vite proxies /api → :3000)"
echo ""

npx concurrently -k --names "API,WEB" --prefix-colors "blue,green" \
  "tsx watch src/server/index.ts" \
  "vite dev"