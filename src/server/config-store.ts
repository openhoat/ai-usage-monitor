import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ProviderConfig {
  anthropic_api_key: string
  claude_token: string
  gemini_api_key: string
  openai_api_key: string
  ollama_session_cookie: string
  opencode_go_session: string
  opencode_zen_session: string
  openrouter_api_key: string
  refresh_interval_minutes: number
}

const CONFIG_FILE = join(homedir(), '.config', 'ai-usage-monitor', 'config.json')

function loadFromFile(): Partial<ProviderConfig> {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch {
    // Fall through
  }
  return {}
}

/**
 * Load provider credentials from the local config file first, falling back
 * to environment variables. In docker, there is no config file, so env is used.
 * In local dev, the file (updated via Settings UI) takes priority.
 */
export function loadConfig(): ProviderConfig {
  const file = loadFromFile()

  return {
    anthropic_api_key: file.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '',
    claude_token:
      file.claude_token ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      process.env.CLAUDE_SESSION_COOKIE ||
      '',
    gemini_api_key: file.gemini_api_key || process.env.GEMINI_API_KEY || '',
    openai_api_key:
      file.openai_api_key || process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_API_KEY || '',
    ollama_session_cookie: file.ollama_session_cookie || process.env.OLLAMA_SESSION_COOKIE || '',
    opencode_go_session: file.opencode_go_session || process.env.OPENCODE_GO_SESSION || '',
    opencode_zen_session: file.opencode_zen_session || process.env.OPENCODE_ZEN_SESSION || '',
    openrouter_api_key: file.openrouter_api_key || process.env.OPENROUTER_API_KEY || '',
    refresh_interval_minutes:
      file.refresh_interval_minutes ?? parseRefreshInterval(process.env.REFRESH_INTERVAL_MINUTES),
  }
}

function parseRefreshInterval(raw: string | undefined): number {
  if (!raw) return 5
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed < 1) return 5
  return parsed
}

/**
 * Save provider config to the local config file.
 * Only fields with non-empty values are written.
 * In docker, credentials come from env — this is only used for local dev.
 */
export function saveConfig(config: ProviderConfig): void {
  const dir = dirname(CONFIG_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Refresh interval in minutes, configurable via the config file or
 * REFRESH_INTERVAL_MINUTES env var. Defaults to 5 minutes.
 */

export function getConfigForProviders(config: ProviderConfig): Array<{
  provider: string
  credential: string
}> {
  const configured: Array<{ provider: string; credential: string }> = []

  if (config.anthropic_api_key) {
    configured.push({ provider: 'anthropic', credential: config.anthropic_api_key })
  }
  if (config.claude_token) {
    configured.push({ provider: 'claude', credential: config.claude_token })
  }
  if (config.gemini_api_key) {
    configured.push({ provider: 'gemini', credential: config.gemini_api_key })
  }
  if (config.openai_api_key) {
    configured.push({ provider: 'openai', credential: config.openai_api_key })
  }
  if (config.ollama_session_cookie) {
    configured.push({ provider: 'ollama', credential: config.ollama_session_cookie })
  }
  if (config.opencode_zen_session) {
    configured.push({ provider: 'opencode-zen', credential: config.opencode_zen_session })
  }
  if (config.opencode_go_session) {
    configured.push({ provider: 'opencode-go', credential: config.opencode_go_session })
  }
  if (config.openrouter_api_key) {
    configured.push({ provider: 'openrouter', credential: config.openrouter_api_key })
  }

  return configured
}
