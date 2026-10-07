import { fetchWithRetry } from '../helpers/fetch.js'
import type { ErrorResult, Provider, Result, TierUsage, UsageResult } from '../types.js'

const API_BASE_URL = 'https://opencode.ai/console/api'
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'

/** Amounts returned by the API are in micro-USD (1e-6 USD). */
const MICRO_PER_USD = 1_000_000

interface BillingStatus {
  billingMode?: string | null
  mode?: string | null
  balanceMicroCents?: string | number | null
  availableMicroCents?: string | number | null
  creditLimitMicroCents?: string | number | null
}

interface UsageSummary {
  totalRequests?: string | number | null
  totalCostMicroCents?: string | number | null
}

interface Org {
  id: string
  name?: string
}

type ApiOutcome<T> = { ok: true; data: T } | { ok: false; error: ErrorResult }

/**
 * Parse the credential string.
 *
 * Accepted formats:
 *   - "orgId:sessionCookie" (e.g. wrk_01ABC...:st_...)
 *   - "sessionCookie" (the org ID is then resolved automatically)
 *
 * Returns null when the cookie is missing.
 */
export function parseCredential(
  credential: string
): { orgId: string; sessionCookie: string } | null {
  const trimmed = credential.trim()
  if (!trimmed) return null

  const colonIndex = trimmed.indexOf(':')
  if (colonIndex === -1) {
    return { orgId: '', sessionCookie: trimmed }
  }

  const orgId = trimmed.slice(0, colonIndex).trim()
  const sessionCookie = trimmed.slice(colonIndex + 1).trim()
  if (!sessionCookie) return null
  return { orgId, sessionCookie }
}

/** Convert a micro-USD value (string or number) to USD. Returns null when absent/invalid. */
export function microToUsd(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed / MICRO_PER_USD
}

/** Format a USD amount as "$12.34" (or "-$12.34" for debt). */
export function formatUsd(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  return `${sign}$${Math.abs(amount).toFixed(2)}`
}

/**
 * Build the usage tiers from the billing status and the rolling usage windows.
 *
 * The new opencode.ai console is a pay-as-you-go / prepaid model:
 *   - balance     → billing/status.balanceMicroCents (may be negative = debt)
 *   - 24h spend   → usage/summary?range=24h.totalCostMicroCents
 *   - 30d spend   → usage/summary?range=30d.totalCostMicroCents
 */
export function buildTiers(
  billing: BillingStatus,
  usage24h: UsageSummary,
  usage30d: UsageSummary
): TierUsage[] {
  const tiers: TierUsage[] = []

  const balance = microToUsd(billing.balanceMicroCents)
  if (balance !== null) {
    tiers.push({ name: `Balance ${formatUsd(balance)}`, percentage: 0 })
  }

  const cost24h = microToUsd(usage24h.totalCostMicroCents)
  if (cost24h !== null) {
    tiers.push({ name: `Spend 24h ${formatUsd(cost24h)}`, percentage: 0 })
  }

  const cost30d = microToUsd(usage30d.totalCostMicroCents)
  if (cost30d !== null) {
    tiers.push({ name: `Spend 30d ${formatUsd(cost30d)}`, percentage: 0 })
  }

  return tiers
}

/** Plan label derived from the billing mode ("pay-as-you-go", "prepaid", ...). */
export function planFromBilling(billing: BillingStatus): string {
  const mode = typeof billing.mode === 'string' && billing.mode ? billing.mode : null
  const billingMode =
    typeof billing.billingMode === 'string' && billing.billingMode ? billing.billingMode : null
  return mode || billingMode || 'opencode'
}

/** GET a JSON endpoint with the console session cookie and optional org header. */
async function requestJson<T>(
  url: string,
  sessionCookie: string,
  orgId: string | null
): Promise<ApiOutcome<T>> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    Cookie: `__Host-console_session=${sessionCookie}`,
  }
  if (orgId) headers['x-org-id'] = orgId

  let res: Response
  try {
    res = await fetchWithRetry(url, { headers, redirect: 'follow' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        error: { status: 'error', error_code: 'timeout', message: `Request timed out: ${message}` },
      }
    }
    return {
      ok: false,
      error: { status: 'error', error_code: 'network_error', message: `Network error: ${message}` },
    }
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: {
        status: 'error',
        error_code: 'auth_expired',
        message: 'Authentication failed. Session cookie may be expired or invalid.',
      },
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      error: {
        status: 'error',
        error_code: 'network_error',
        message: `Unexpected response: HTTP ${res.status}`,
      },
    }
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    return {
      ok: false,
      error: {
        status: 'error',
        error_code: 'network_error',
        message: 'Invalid JSON response from opencode.ai.',
      },
    }
  }

  // The API returns {"_tag":"OrgRequired"} when the org header is missing/invalid.
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && '_tag' in data) {
    const tag = (data as { _tag?: string })._tag ?? 'unknown'
    return {
      ok: false,
      error: {
        status: 'error',
        error_code: 'auth_expired',
        message: `opencode.ai API error: ${tag}. Check the workspace ID and session cookie.`,
      },
    }
  }

  return { ok: true, data: data as T }
}

export const opencodeProvider: Provider = {
  name: 'opencode',
  async fetchUsage(credential: string): Promise<Result> {
    const parsed = parseCredential(credential)
    if (!parsed) {
      return {
        status: 'error',
        error_code: 'auth_expired',
        message:
          'Invalid credential format. Expected "workspaceId:sessionCookie" or just the session cookie.',
      }
    }

    const { sessionCookie } = parsed
    let orgId = parsed.orgId

    // Resolve the org ID from the session when it was not provided.
    if (!orgId) {
      const orgs = await requestJson<Org[]>(`${API_BASE_URL}/orgs`, sessionCookie, null)
      if (!orgs.ok) return orgs.error

      if (!Array.isArray(orgs.data) || orgs.data.length === 0 || !orgs.data[0]?.id) {
        return {
          status: 'error',
          error_code: 'auth_expired',
          message: 'No workspace found for this session. Session cookie may be expired.',
        }
      }
      orgId = orgs.data[0].id
    }

    const billing = await requestJson<BillingStatus>(
      `${API_BASE_URL}/billing/status`,
      sessionCookie,
      orgId
    )
    if (!billing.ok) return billing.error

    const usage24h = await requestJson<UsageSummary>(
      `${API_BASE_URL}/usage/summary?range=24h`,
      sessionCookie,
      orgId
    )
    if (!usage24h.ok) return usage24h.error

    const usage30d = await requestJson<UsageSummary>(
      `${API_BASE_URL}/usage/summary?range=30d`,
      sessionCookie,
      orgId
    )
    if (!usage30d.ok) return usage30d.error

    const tiers = buildTiers(billing.data, usage24h.data, usage30d.data)
    const plan = planFromBilling(billing.data)

    const result: UsageResult = {
      status: 'ok',
      provider: 'opencode',
      plan,
      tiers: tiers.length > 0 ? tiers : [{ name: 'No usage data', percentage: 0 }],
      overall_percentage: 0,
      reset_date: null,
      reset_in_hours: null,
    }
    return result
  },
}
