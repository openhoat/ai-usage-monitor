import { fetchWithRetry } from '../helpers/fetch.js'
import type { Provider, Result, TierUsage, UsageResult } from '../types.js'

const DASHBOARD_URL_PREFIX = 'https://opencode.ai/workspace/'
const DASHBOARD_URL_SUFFIX = '/go'
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
 * Parse a SolidJS SSR hydration object of the form
 *   $R[n]={status:"ok",resetInSec:18000,usagePercent:0}
 * Field order is not guaranteed, so we match each field independently.
 */
function parseUsageObject(
  html: string,
  key: string
): { usagePercent: number; resetInSec: number } | null {
  const pattern = new RegExp(`${key}:\\$R\\[\\d+\\]=\\{([^}]*)\\}`)
  const match = html.match(pattern)
  if (!match) return null
  const body = match[1]
  const percentMatch = body.match(/usagePercent:\s*(\d+)/)
  const resetMatch = body.match(/resetInSec:\s*(\d+)/)
  if (!percentMatch || !resetMatch) return null
  return {
    usagePercent: Number(percentMatch[1]),
    resetInSec: Number(resetMatch[1]),
  }
}

/**
 * Parse OpenCode Go usage page HTML (SolidJS SSR hydration output).
 *
 * OpenCode Go is a subscription with fixed quota limits tracked as
 * rolling (5h), weekly and monthly usage buckets. We extract:
 *   - rollingUsage:$R[n]={status,resetInSec,usagePercent}
 *   - weeklyUsage:$R[n]={status,resetInSec,usagePercent}
 *   - monthlyUsage:$R[n]={status,resetInSec,usagePercent}
 *   - balance:<n>          (micro-cents, may be negative = debt)
 *   - monthlyLimit:<n>     (raw USD)
 *   - useBalance:(!0|!1)   (whether balance fallback is enabled)
 *
 * Returns null when no usage fields are found.
 */
export function parseOpenCodeGoPage(html: string): UsageResult | null {
  const tiers: TierUsage[] = []

  // Rolling (5h) usage
  const rolling = parseUsageObject(html, 'rollingUsage')
  if (rolling) {
    const percentage = clampPercentage(rolling.usagePercent)
    tiers.push({
      name: `Rolling Usage ${percentage}%`,
      percentage,
    })
  }

  // Weekly usage
  const weekly = parseUsageObject(html, 'weeklyUsage')
  if (weekly) {
    const percentage = clampPercentage(weekly.usagePercent)
    tiers.push({
      name: `Weekly Usage ${percentage}%`,
      percentage,
    })
  }

  // Monthly usage
  const monthly = parseUsageObject(html, 'monthlyUsage')
  if (monthly) {
    const percentage = clampPercentage(monthly.usagePercent)
    tiers.push({
      name: `Monthly Usage ${percentage}%`,
      percentage,
    })
  }

  if (tiers.length === 0) return null

  // Overall percentage: monthly usage is the most representative bucket
  const overall = monthly ? clampPercentage(monthly.usagePercent) : 0

  const resetInSec = monthly?.resetInSec ?? null
  const resetInHours = resetInSec === null ? null : Math.round(resetInSec / 3600)
  const resetDate =
    resetInSec === null ? null : new Date(Date.now() + resetInSec * 1000).toISOString()

  return {
    status: 'ok',
    provider: 'opencode-go',
    plan: 'go',
    tiers,
    overall_percentage: overall,
    reset_date: resetDate,
    reset_in_hours: resetInHours,
  }
}

export const opencodeGoProvider: Provider = {
  name: 'opencode-go',
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
    const result = parseOpenCodeGoPage(html)
    if (result) return result

    // Page loaded and authenticated, but we couldn't parse usage data
    // This can happen if the page structure changes or no usage data exists yet
    return {
      status: 'ok',
      provider: 'opencode-go',
      plan: 'go',
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
