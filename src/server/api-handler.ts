import { getProvider } from '../providers/index.js'
import type { ProviderConfig } from './config-store.js'
import { getConfigForProviders, loadConfig, saveConfig } from './config-store.js'

interface StatusResult {
  providers: Record<
    string,
    {
      status: 'ok' | 'error'
      data?: {
        provider: string
        plan: string
        tiers: Array<{ name: string; percentage: number }>
        overall_percentage: number
        reset_date: string | null
        reset_in_hours: number | null
      }
      error?: {
        code: string
        message: string
      }
    }
  >
  last_refresh: string | null
}

let cachedResults: StatusResult | null = null
let lastRefreshTime: string | null = null
let refreshInProgress = false
let currentIntervalMinutes: number = loadConfig().refresh_interval_minutes

export async function handleStatus(): Promise<StatusResult> {
  if (cachedResults && lastRefreshTime) {
    const intervalMs = currentIntervalMinutes * 60_000
    const ageMs = Date.now() - new Date(lastRefreshTime).getTime()
    if (ageMs < intervalMs) {
      return { ...cachedResults, last_refresh: lastRefreshTime }
    }
  }
  return refreshAll()
}

export async function refreshAll(): Promise<StatusResult> {
  if (refreshInProgress) {
    if (cachedResults) {
      return { ...cachedResults, last_refresh: lastRefreshTime }
    }
    // Wait for the in-progress refresh to complete
    return new Promise(resolve => {
      const interval = setInterval(() => {
        if (!refreshInProgress && cachedResults) {
          clearInterval(interval)
          resolve({ ...cachedResults, last_refresh: lastRefreshTime })
        }
      }, 100)
      // Timeout after 60 seconds
      setTimeout(() => {
        clearInterval(interval)
        resolve(cachedResults || { providers: {}, last_refresh: null })
      }, 60_000)
    })
  }

  refreshInProgress = true

  try {
    const config = loadConfig()
    const configured = getConfigForProviders(config)
    const results: StatusResult['providers'] = {}

    const promises = configured.map(async ({ provider, credential }) => {
      const providerImpl = getProvider(provider)
      if (!providerImpl) {
        results[provider] = {
          status: 'error',
          error: { code: 'unknown_provider', message: `Unknown provider: ${provider}` },
        }
        return
      }

      try {
        const result = await providerImpl.fetchUsage(credential)
        if (result.status === 'ok') {
          results[provider] = {
            status: 'ok',
            data: {
              provider: result.provider,
              plan: result.plan,
              tiers: result.tiers,
              overall_percentage: result.overall_percentage,
              reset_date: result.reset_date,
              reset_in_hours: result.reset_in_hours,
            },
          }
        } else {
          results[provider] = {
            status: 'error',
            error: { code: result.error_code, message: result.message },
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results[provider] = {
          status: 'error',
          error: { code: 'network_error', message },
        }
      }
    })

    await Promise.all(promises)

    cachedResults = { providers: results, last_refresh: null }
    lastRefreshTime = new Date().toISOString()

    return { ...cachedResults, last_refresh: lastRefreshTime }
  } finally {
    refreshInProgress = false
  }
}

export function handleGetConfig(): {
  providers: Record<string, { value: string; isDefault: boolean }>
  refresh_interval_minutes: number
} {
  const config = loadConfig()
  const result: Record<string, { value: string; isDefault: boolean }> = {}

  const fields: [string, keyof ProviderConfig][] = [
    ['anthropic', 'anthropic_api_key'],
    ['claude', 'claude_token'],
    ['gemini', 'gemini_api_key'],
    ['openai', 'openai_api_key'],
    ['ollama', 'ollama_session_cookie'],
    ['opencode', 'opencode_session'],
    ['openrouter', 'openrouter_api_key'],
  ]

  for (const [name, key] of fields) {
    const value = config[key]
    const envKey = key.replaceAll('_', '').toUpperCase()
    const envValue = process.env[envKey] || ''
    result[name] = {
      value: typeof value === 'string' ? value : '',
      isDefault: !value && !!envValue,
    }
  }

  return { providers: result, refresh_interval_minutes: currentIntervalMinutes }
}

export function handleSaveConfig(body: ProviderConfig): { success: boolean; message: string } {
  const existing = loadConfig()
  const merged = { ...existing }

  if (body.anthropic_api_key) merged.anthropic_api_key = body.anthropic_api_key
  if (body.claude_token) merged.claude_token = body.claude_token
  if (body.gemini_api_key) merged.gemini_api_key = body.gemini_api_key
  if (body.openai_api_key) merged.openai_api_key = body.openai_api_key
  if (body.ollama_session_cookie) merged.ollama_session_cookie = body.ollama_session_cookie
  if (body.opencode_session) merged.opencode_session = body.opencode_session
  if (body.openrouter_api_key) merged.openrouter_api_key = body.openrouter_api_key
  if (body.refresh_interval_minutes >= 1) {
    merged.refresh_interval_minutes = body.refresh_interval_minutes
  }

  saveConfig(merged)

  // Update the in-memory interval immediately
  currentIntervalMinutes = merged.refresh_interval_minutes

  // Clear cache so next status call will re-fetch
  cachedResults = null
  lastRefreshTime = null

  return { success: true, message: 'Configuration saved' }
}
