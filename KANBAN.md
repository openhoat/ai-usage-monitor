# Kanban Board

**Priority Legend:**
- 🔴 **P1** = High Priority (critical, security, blocking issues)
- 🟡 **P2** = Medium Priority (important improvements)
- 🟢 **P3** = Low Priority (nice to have, enhancements)

**Category Icons (for Ideas):**
- 🔒 **[SECURITY]**: Security improvements
- ✅ **[TEST]**: Testing improvements
- 🚀 **[PERFORMANCE]**: Performance optimizations
- 🏗️ **[ARCHITECTURE]**: Code architecture improvements
- 🎨 **[UX]**: User experience improvements
- 🔧 **[DEVOPS]**: DevOps improvements
- 🌍 **[I18N]**: Internationalization improvements
- 📦 **[DEPENDENCIES]**: Dependency updates
- ⚙️ **[CONFIG]**: Configuration improvements

## 📝 Backlog

- [ ] **#test-coverage-raise [07/10/2026 19:05:00] 🟡 P2 ✅ [TEST]** Raise the vitest coverage thresholds toward the MCP target (75/60/65/75) — current ratchet is lines 60 / functions 60 / branches 45 / statements 55
- [ ] **#test-server [07/10/2026 19:05:00] 🟡 P2 ✅ [TEST]** Add unit tests for src/server (api-handler, config-store) — currently 0% unit coverage (integration-covered by Playwright only)

## 🚧 In Progress

## ✅ Done

- [x] **#esm-migration [25/02/2026 09:40:00] 🔴 P1 🏗️ [ARCHITECTURE]** Switch project to ESM and remove require usage for GNOME extension compatibility
- [x] **#devops-sonar [07/10/2026 19:05:00] 🔴 P1 🔧 [DEVOPS]** Integrate SonarQube (sonar-project.properties, sonarqube-scanner, `npm run sonar`, scripts/sonar-strict-profile.sh) against sonar.op3n.cloud
- [x] **#devops-arch [07/10/2026 19:05:00] 🟡 P2 🏗️ [ARCHITECTURE]** Add dependency-cruiser layer rules and fix the App.tsx ↔ main.tsx import cycle (extracted src/web/refresh-interval.ts)
- [x] **#test-coverage [23/02/2026 17:00:00] 🟡 P2 ✅ [TEST]** Configure vitest coverage (@vitest/coverage-v8, lcov → dist/coverage, ratchet thresholds)
- [x] **#devops-lint [07/10/2026 19:05:00] 🟡 P2 🔧 [DEVOPS]** Add markdownlint and prettier checks for Markdown (`qa:markdown`, `qa:prettier`)
- [x] **#devops-typecheck [07/10/2026 19:05:00] 🟡 P2 🔧 [DEVOPS]** Add a dedicated typecheck task (tsconfig.typecheck.json, `npm run typecheck`)
- [x] **#devops-depbot [07/10/2026 19:05:00] 🟢 P3 📦 [DEPENDENCIES]** Add Dependabot config (npm + github-actions) and .npmrc (engine-strict, save-exact, tag-version-prefix)
- [x] **#devops-workflows [07/10/2026 19:05:00] 🟢 P3 🔧 [DEVOPS]** Split CI/CD (ci + release + docker workflows), least-privilege permissions, wireit caching, align runtime on Node 24
- [x] **#devops-templates [24/02/2026 09:43:14] 🟢 P3 🔧 [DEVOPS]** Add GitHub issue templates (bug report, feature request) and PR template
- [x] **#doc-contributing [24/02/2026 09:43:14] 🟡 P2 🏗️ [ARCHITECTURE]** Add CONTRIBUTING.md with development workflow, commit conventions, and PR guidelines (+ SECURITY.md, GLOSSARY.md)
- [x] **#doc-dev [23/02/2026 15:00:00] 🟢 P3 🏗️ [ARCHITECTURE]** Add developer documentation in README (dev setup, running tests, architecture details)
