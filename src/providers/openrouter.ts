import { fetchWithRetry } from '../helpers/fetch.js'
import type { Provider, Result, TierUsage } from '../types.js'

interface OpenRouterKeyData {
  label?: string
  limit: number | null
  limit_remaining: number | null
  usage: number
  usage_monthly: number
  is_free_tier: boolean
  expires_at: string | null
}

interface OpenRouterKeyResponse {
  data: OpenRouterKeyData
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function buildTiers(key: OpenRouterKeyData): TierUsage[] {
  if (key.limit && key.limit > 0) {
    const used = key.limit_remaining !== null ? key.limit - key.limit_remaining : key.usage
    return [
      {
        name: `Monthly ($${used.toFixed(2)}/$${key.limit.toFixed(0)})`,
        percentage: Math.round((used / key.limit) * 10000) / 100,
      },
    ]
  }
  return [{ name: `Monthly Spend ($${key.usage_monthly.toFixed(2)})`, percentage: 0 }]
}

export const openrouterProvider: Provider = {
  name: 'openrouter',
  async fetchUsage(apiKey: string): Promise<Result> {
    try {
      const res = await fetchWithRetry('https://openrouter.ai/api/v1/auth/key', {
        headers: buildHeaders(apiKey),
        redirect: 'follow',
      })

      if (res.status === 401 || res.status === 403) {
        return {
          status: 'error',
          error_code: 'auth_expired',
          message: 'Authentication failed. OpenRouter API key may be invalid or expired.',
        }
      }

      if (!res.ok) {
        return {
          status: 'error',
          error_code: 'network_error',
          message: `Unexpected response: HTTP ${res.status}`,
        }
      }

      const data = (await res.json()) as OpenRouterKeyResponse
      const tiers = buildTiers(data.data)

      return {
        status: 'ok',
        provider: 'openrouter',
        plan: 'api',
        tiers,
        overall_percentage: tiers[0]?.percentage ?? 0,
        reset_date: null,
        reset_in_hours: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { status: 'error', error_code: 'timeout', message: `Request timed out: ${message}` }
      }
      return { status: 'error', error_code: 'network_error', message: `Network error: ${message}` }
    }
  },
}
