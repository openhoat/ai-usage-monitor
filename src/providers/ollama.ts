import { getUserAgent } from '../config.js'
import { fetchWithRetry } from '../helpers/fetch.js'
import type { ErrorResult, Provider, Result, TierUsage, UsageResult } from '../types.js'

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

// Current (2026-11) structure: the settings page is a shell that loads its cost
// report over htmx, plan and renewal live on the billing page.
const SETTINGS_URL = 'https://ollama.com/settings'
const COST_REPORT_URL = 'https://ollama.com/settings/usage/report?scope=self'
const BILLING_URL = 'https://ollama.com/settings/billing'

// Cost report fragment: <dt>Total cost</dt><dd>$57.34</dd>.
const TOTAL_COST_RE = /<dt[^>]*>\s*Total cost\s*<\/dt>\s*<dd[^>]*>\s*\$([\d.,]+)\s*<\/dd>/i
// Billing page: "Current plan: Pro" and "Your subscription renews on
// <span>November 11, 2026</span>.".
const BILLING_PLAN_RE = /Current plan:\s*(?:<[^>]+>\s*)*([A-Za-z]+)/i
const RENEWAL_RE = /renews on\s*(?:<[^>]+>\s*)*([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/

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

/**
 * Parse the htmx cost report fragment (2026-11 structure).
 * The fragment carries the month-to-date cost; there is no percentage anymore
 * (the account is a subscription billed outside the included usage).
 */
export function parseCostReport(html: string): TierUsage | null {
  const match = TOTAL_COST_RE.exec(html)
  if (!match) return null
  return { name: `Monthly cost $${match[1].trim()}`, percentage: 0 }
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** Parse a "November 11, 2026" date as a UTC timestamp (null when invalid). */
function parseMonthDate(text: string): number | null {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim())
  if (!match) return null
  const month = MONTHS.indexOf(match[1].toLowerCase())
  if (month === -1) return null
  return Date.UTC(Number.parseInt(match[3], 10), month, Number.parseInt(match[2], 10))
}

export interface BillingInfo {
  plan: string | null
  resetDate: string | null
  resetInHours: number | null
}

/** Parse the billing page: current plan and subscription renewal date. */
export function parseBillingPage(html: string): BillingInfo {
  const planMatch = BILLING_PLAN_RE.exec(html)
  const renewalMatch = RENEWAL_RE.exec(html)

  const plan = planMatch ? planMatch[1].trim().toLowerCase() : null
  const renewalTime = renewalMatch ? parseMonthDate(renewalMatch[1]) : null

  if (renewalTime === null) return { plan, resetDate: null, resetInHours: null }

  return {
    plan,
    resetDate: new Date(renewalTime).toISOString(),
    resetInHours: Math.max(0, Math.round((renewalTime - Date.now()) / 3600000)),
  }
}

type PageOutcome = { kind: 'ok'; html: string } | { kind: 'error'; result: ErrorResult }

/** Detect a login page served instead of the requested one (expired session). */
function isLoginPage(html: string): boolean {
  // Ollama now uses WorkOS AuthKit for auth — detect both old and new login page patterns
  return (
    html.includes('action="/signin"') ||
    html.includes('href="/login"') ||
    html.includes('href="/signin"') ||
    html.includes('href="/sign-up') ||
    html.includes('api/login?provider=') ||
    html.includes('<title>Sign in</title>') ||
    html.includes('hosted-authkit') ||
    html.includes('data-dpl-id="hosted-authkit')
  )
}

const AUTH_EXPIRED: ErrorResult = {
  status: 'error',
  error_code: 'auth_expired',
  message: 'Authentication failed. Session cookie may be expired or invalid.',
}

/** GET an ollama.com page, mapping HTTP and network failures to an error Result. */
async function fetchPage(url: string, headers: Record<string, string>): Promise<PageOutcome> {
  try {
    const res = await fetchWithRetry(url, { headers, redirect: 'follow' })

    if (res.status === 401 || res.status === 403) return { kind: 'error', result: AUTH_EXPIRED }
    if (!res.ok) {
      return {
        kind: 'error',
        result: {
          status: 'error',
          error_code: 'network_error',
          message: `Unexpected response: HTTP ${res.status}`,
        },
      }
    }

    const html = await res.text()
    if (isLoginPage(html)) {
      return {
        kind: 'error',
        result: {
          status: 'error',
          error_code: 'auth_expired',
          message: 'Session expired. Please refresh your session cookie from ollama.com.',
        },
      }
    }
    return { kind: 'ok', html }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        kind: 'error',
        result: {
          status: 'error',
          error_code: 'timeout',
          message: `Request timed out: ${message}`,
        },
      }
    }
    return {
      kind: 'error',
      result: {
        status: 'error',
        error_code: 'network_error',
        message: `Network error: ${message}`,
      },
    }
  }
}

export const ollamaProvider: Provider = {
  name: 'ollama',
  async fetchUsage(sessionCookie: string): Promise<Result> {
    const headers = buildHeaders(sessionCookie)

    const settings = await fetchPage(SETTINGS_URL, headers)
    if (settings.kind === 'error') return settings.result

    const report = await fetchPage(COST_REPORT_URL, headers)
    if (report.kind === 'error') return report.result

    const costTier = parseCostReport(report.html)

    if (!costTier) {
      // Pages before 2026-11 carried the usage data inline on /settings.
      const legacy = parseOllamaPage(settings.html)
      if (legacy) return legacy

      // Report loaded and authenticated, but no cost could be extracted.
      return {
        status: 'error',
        error_code: 'parse_error',
        message: 'Could not extract usage data. The page structure may have changed.',
      }
    }

    // Plan and renewal are informative: a billing failure keeps the cost data.
    const billing = await fetchPage(BILLING_URL, headers)
    const billingInfo = billing.kind === 'ok' ? parseBillingPage(billing.html) : null

    return {
      status: 'ok',
      provider: 'ollama',
      plan: billingInfo?.plan ?? extractPlan(settings.html),
      tiers: [costTier],
      overall_percentage: 0,
      reset_date: billingInfo?.resetDate ?? null,
      reset_in_hours: billingInfo?.resetInHours ?? null,
    }
  },
}
