#!/usr/bin/env bash
set -euo pipefail

# Create a source archive (zip) for release, excluding build artifacts,
# dependencies, and local-only files.
# Usage: ./scripts/pack.sh

VERSION="$(node -p "require('./package.json').version")"
mkdir -p dist

zip -r "dist/ai-usage-monitor-v${VERSION}.zip" . \
  -x "node_modules/*" \
  -x "dist/*" \
  -x ".git/*" \
  -x ".github/*" \
  -x ".husky/*" \
  -x ".idea/*" \
  -x ".opencode/*" \
  -x ".playwright-mcp/*" \
  -x ".wireit/*" \
  -x "test-results/*" \
  -x ".env*" \
  -x ".secrets" \
  -x ".secrets.*" \
  -x "KANBAN.md" \
  -x "*.zip"

echo "Done: dist/ai-usage-monitor-v${VERSION}.zip"