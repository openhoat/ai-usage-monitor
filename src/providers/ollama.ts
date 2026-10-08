import { getUserAgent } from '../config.js'
import { fetchWithRetry } from '../helpers/fetch.js'
import type { Provider, Result, TierUsage, UsageResult } from '../types.js'

function buildHeaders(sessionCookie: string): Record<string, string> {
  // Format cookie if needed (add prefix if not present)
  const cookieValue = sessionCookie.startsWith('__Secure-session=')
    ? sessionCookie
    : `__Secure-session=${sessionCookie}`

  return {
    Cookie: cookieValue,
    'User-Agent': getUserAgent(),
    Accept: 'text/html',
  }
}

/** Plan badge patterns, tried in order (first capture group = plan name). */
const PLAN_PATTERNS: RegExp[] = [
  />Included usage<[\s\S]{0,300}?>(\w+)<\/span\s*>/i,
  />Usage credits<[\s\S]{0,300}?>(\w+)<\/span\s*>/i,
  />Cloud usage<[\s\S]{0,500}?>(\w+)</,
  /Cloud usage[\s\S]{0,200}?badge[^>]*>(\w+)<\//,
  /data-testid="plan-badge"[^>]*>(\w+)</,
]

// Monthly usage block: <span>Name</span><span>value</span>.
const BLOCK_RE =
  /class="flex justify-between[^>]*>\s*<span[^>]*>(\w[\w\s]*?)<\/span>\s*<span[^>]*>([^<]*)</g
const DOLLAR_RE = /\$([\d.,]+)\s*of\s*\$([\d.,]+)\s*used/i
const PCT_RE = /^(\d+(?:\.\d+)?)\s*%\s*used/i
const METER_RE = /data-usage-meter[\s\S]{0,800}?style="width:\s*([\d.]+)%/
// Current (2026-10) structure: the block only shows the amount used ($300) while
// the total lives in the meter aria-label ("Monthly credits used: $300 of $300").
const MONTHLY_RE = /Monthly credits used:\s*\$([\d.,]+)\s*of\s*\$([\d.,]+)/i
// Balance patterns, tried in order (first capture group = dollar amount).
const BALANCE_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /id="usage-credits-balance"[^>]*>\$([\d.,]+)</, name: 'Usage credits' },
  {
    re: />Balance remaining<[\s\S]{0,200}?class="text-2xl[^"]*"[^>]*>\$([\d.,]+)</,
    name: 'Balance remaining',
  },
]
const RESET_RE = /class="[^"]*\blocal-time\b[^"]*"[^>]*?data-time="([^"]+)"/i
// Current (2026-10) structure: reset is plain text ("Refills to $300 in 3 days.").
const REFILL_RE = /Refills to\s*\$[\d.,]+\s*in\s*(\d+)\s*days?/i

/** Return the first capture group of the first matching pattern, or null. */
function firstCapture(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match) return match[1]
  }
  return null
}

/** Extract the plan from the "Included usage" badge (defaults to "free"). */
function extractPlan(html: string): string {
  const plan = firstCapture(html, PLAN_PATTERNS)
  return plan ? plan.trim().toLowerCase() : 'free'
}

/**
 * Parse the value text of a usage block into a percentage.
 * Returns null when the text matches neither the "$X of $Y used" nor the legacy
 * "N% used" format (the block is then ignored).
 */
function parseBlockPercentage(valueText: string): number | null {
  const dollarMatch = DOLLAR_RE.exec(valueText)
  if (dollarMatch) {
    const spent = Number.parseFloat(dollarMatch[1].replaceAll(',', ''))
    const total = Number.parseFloat(dollarMatch[2].replaceAll(',', ''))
    return total > 0 ? (spent / total) * 100 : 0
  }
  const pctMatch = PCT_RE.exec(valueText)
  if (pctMatch) return Number.parseFloat(pctMatch[1])
  return null
}

/** Extract the monthly usage tiers and the highest percentage seen. */
function extractMonthlyTiers(html: string): { tiers: TierUsage[]; overall: number } {
  const tiers: TierUsage[] = []
  let overall = 0

  // Current (2026-10) structure: used/total from the monthly meter aria-label.
  const monthly = MONTHLY_RE.exec(html)
  if (monthly) {
    const used = Number.parseFloat(monthly[1].replaceAll(',', ''))
    const total = Number.parseFloat(monthly[2].replaceAll(',', ''))
    const percentage = total > 0 ? (used / total) * 100 : 0
    tiers.push({ name: 'Monthly usage', percentage })
    overall = percentage
  }

  // Legacy structure: "<span>Name</span><span>$X of $Y used</span>" blocks.
  for (const match of html.matchAll(BLOCK_RE)) {
    const name = match[1].trim()
    const percentage = parseBlockPercentage(match[2].trim())
    if (percentage === null) continue

    tiers.push({ name, percentage })
    if (percentage > overall) overall = percentage
  }

  // Fallback: read the percentage from the meter width style (e.g. width: 7.2%;).
  if (tiers.length === 0) {
    const meterMatch = METER_RE.exec(html)
    if (meterMatch) {
      const percentage = Number.parseFloat(meterMatch[1])
      tiers.push({ name: 'Monthly usage', percentage })
      overall = percentage
    }
  }

  return { tiers, overall }
}

/** Extract the extra-usage balance as an additional tier. */
function extractBalance(html: string): TierUsage | null {
  for (const { re, name } of BALANCE_PATTERNS) {
    const match = re.exec(html)
    if (!match) continue
    const balance = Number.parseFloat(match[1].replaceAll(',', ''))
    return { name, percentage: balance }
  }
  return null
}

/** Extract the reset date and remaining hours from the local-time element. */
function extractReset(html: string): { resetDate: string | null; resetInHours: number | null } {
  // Current (2026-10) structure: "Refills to $300 in 3 days." (no absolute date).
  const refillMatch = REFILL_RE.exec(html)
  if (refillMatch) {
    return { resetDate: null, resetInHours: Number.parseInt(refillMatch[1], 10) * 24 }
  }

  const resetMatch = RESET_RE.exec(html)
  if (!resetMatch) return { resetDate: null, resetInHours: null }

  const resetTimeAttr = resetMatch[1]
  const resetTime = new Date(resetTimeAttr).getTime()
  if (Number.isNaN(resetTime)) return { resetDate: null, resetInHours: null }

  return {
    resetDate: resetTimeAttr,
    resetInHours: Math.max(0, Math.round((resetTime - Date.now()) / 3600000)),
  }
}

export function parseOllamaPage(html: string): UsageResult | null {
  const plan = extractPlan(html)
  const { tiers, overall } = extractMonthlyTiers(html)

  const balance = extractBalance(html)
  if (balance) tiers.push(balance)

  const { resetDate, resetInHours } = extractReset(html)

  if (tiers.length === 0) return null

  return {
    status: 'ok',
    provider: 'ollama',
    plan,
    tiers,
    overall_percentage: Math.round(overall * 100) / 100,
    reset_date: resetDate,
    reset_in_hours: resetInHours,
  }
}

export const ollamaProvider: Provider = {
  name: 'ollama',
  async fetchUsage(sessionCookie: string): Promise<Result> {
    const headers = buildHeaders(sessionCookie)

    let html: string
    try {
      const res = await fetchWithRetry('https://ollama.com/settings', {
        headers,
        redirect: 'follow',
      })

      if (res.status === 401 || res.status === 403) {
        return {
          status: 'error',
          error_code: 'auth_expired',
          message: 'Authentication failed. Session cookie may be expired or invalid.',
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

    // Check if we're actually logged in (login redirect detected)
    // Ollama now uses WorkOS AuthKit for auth — detect both old and new login page patterns
    if (
      html.includes('action="/signin"') ||
      html.includes('href="/login"') ||
      html.includes('href="/signin"') ||
      html.includes('href="/sign-up') ||
      html.includes('api/login?provider=') ||
      html.includes('<title>Sign in</title>') ||
      html.includes('hosted-authkit') ||
      html.includes('data-dpl-id="hosted-authkit')
    ) {
      return {
        status: 'error',
        error_code: 'auth_expired',
        message: 'Session expired. Please refresh your session cookie from ollama.com.',
      }
    }

    // Page loaded and authenticated — attempt to parse usage data
    const result = parseOllamaPage(html)
    if (result) return result

    // Page loaded and authenticated, but data could not be extracted
    return {
      status: 'error',
      error_code: 'parse_error',
      message: 'Could not extract usage data. The page structure may have changed.',
    }
  },
}
