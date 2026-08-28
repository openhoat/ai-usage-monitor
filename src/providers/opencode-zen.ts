import { fetchWithRetry } from '../helpers/fetch.js'
import type { Provider, Result, TierUsage, UsageResult } from '../types.js'

const DASHBOARD_URL_PREFIX = 'https://opencode.ai/workspace/'
const DASHBOARD_URL_SUFFIX = ''
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0'

/**
 * Parse the credential string in the format "workspaceId:authCookie".
 * Returns null if the format is invalid.
 */
export function parseCredential(
  credential: string
): { workspaceId: string; authCookie: string } | null {
  const colonIndex = credential.indexOf(':')
  if (colonIndex === -1) return null
  const workspaceId = credential.slice(0, colonIndex).trim()
  const authCookie = credential.slice(colonIndex + 1).trim()
  if (!workspaceId || !authCookie) return null
  return { workspaceId, authCookie }
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/**
 * Parse OpenCode Zen usage page HTML (SolidJS SSR hydration output).
 *
 * OpenCode Zen uses a pay-per-use model with an optional balance and
 * optional monthly spend/limit tracking. We extract:
 *   - balance:<n>          (micro-cents, may be negative = debt)
 *   - monthlyUsage:<n>     (raw USD spent this month)
 *   - monthlyLimit:<n>     (raw USD monthly limit)
 *   - useBalance:(!0|!1)   (whether balance fallback is enabled)
 *
 * Returns null when no usage fields are found.
 */
export function parseOpenCodeZenPage(html: string): UsageResult | null {
  const tiers: TierUsage[] = []

  // Balance (micro-cents -> USD, may be negative = debt)
  const balanceMatch = html.match(/balance:\s*(-?\d+)/)
  if (balanceMatch) {
    const balanceUsd = Number(balanceMatch[1]) / 1_000_000
    const sign = balanceUsd < 0 ? '-' : ''
    tiers.push({
      name: `Balance ${sign}$${Math.abs(balanceUsd).toFixed(2)}`,
      percentage: 0,
    })
  }

  // Monthly usage (raw USD)
  const usageMatch = html.match(/monthlyUsage:\s*(\d+(?:\.\d+)?)/)
  const monthlyUsage = usageMatch ? Number(usageMatch[1]) : null

  // Monthly limit (raw USD)
  const limitMatch = html.match(/monthlyLimit:\s*(\d+(?:\.\d+)?)/)
  const monthlyLimit = limitMatch ? Number(limitMatch[1]) : null

  if (monthlyLimit && monthlyLimit > 0 && monthlyUsage !== null) {
    const percentage = clampPercentage((monthlyUsage / monthlyLimit) * 100)
    tiers.push({
      name: `Monthly Spend $${monthlyUsage.toFixed(2)} / $${monthlyLimit.toFixed(0)}`,
      percentage,
    })
  } else if (monthlyUsage !== null) {
    tiers.push({
      name: `Monthly Spend $${monthlyUsage.toFixed(2)}`,
      percentage: 0,
    })
  }

  if (tiers.length === 0) return null

  const overall =
    monthlyLimit && monthlyLimit > 0 && monthlyUsage !== null
      ? clampPercentage((monthlyUsage / monthlyLimit) * 100)
      : 0

  return {
    status: 'ok',
    provider: 'opencode-zen',
    plan: 'zen',
    tiers,
    overall_percentage: overall,
    reset_date: null,
    reset_in_hours: null,
  }
}

export const opencodeZenProvider: Provider = {
  name: 'opencode-zen',
  async fetchUsage(credential: string): Promise<Result> {
    // Parse credential: "workspaceId:authCookie"
    const parsed = parseCredential(credential)
    if (!parsed) {
      return {
        status: 'error',
        error_code: 'auth_expired',
        message:
          'Invalid credential format. Expected "workspaceId:authCookie" (e.g. wrk_01ABC...:eyJhbGci...).',
      }
    }

    const { workspaceId, authCookie } = parsed
    const url = `${DASHBOARD_URL_PREFIX}${encodeURIComponent(workspaceId)}${DASHBOARD_URL_SUFFIX}`

    let html: string
    try {
      const res = await fetchWithRetry(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html',
          Cookie: `auth=${authCookie}`,
        },
        redirect: 'follow',
      })

      if (res.status === 401 || res.status === 403) {
        return {
          status: 'error',
          error_code: 'auth_expired',
          message: 'Authentication failed. Auth cookie may be expired or invalid.',
        }
      }

      if (!res.ok) {
        return {
          status: 'error',
          error_code: 'network_error',
          message: `Unexpected response: HTTP ${res.status}`,
        }
      }

      html = await res.text()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { status: 'error', error_code: 'timeout', message: `Request timed out: ${message}` }
      }
      return { status: 'error', error_code: 'network_error', message: `Network error: ${message}` }
    }

    // Detect login redirect (auth cookie expired or invalid)
    if (
      html.includes('/github/authorize') ||
      html.includes('/google/authorize') ||
      html.includes('Continue with GitHub') ||
      html.includes('Continue with Google') ||
      html.includes('<title>Sign in</title>') ||
      html.includes('href="/login"') ||
      html.includes('href="/signin"')
    ) {
      return {
        status: 'error',
        error_code: 'auth_expired',
        message: 'Session expired. Please refresh your auth cookie from opencode.ai.',
      }
    }

    // Try to parse usage data from the page
    const result = parseOpenCodeZenPage(html)
    if (result) return result

    // Page loaded and authenticated, but we couldn't parse usage data
    // This can happen if the page structure changes or no usage data exists yet
    return {
      status: 'ok',
      provider: 'opencode-zen',
      plan: 'zen',
      tiers: [
        {
          name: 'No usage data',
          percentage: 0,
        },
      ],
      overall_percentage: 0,
      reset_date: null,
      reset_in_hours: null,
    }
  },
}
