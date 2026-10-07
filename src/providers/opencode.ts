import { fetchWithRetry } from '../helpers/fetch.js'
import type { ErrorResult, Provider, Result, TierUsage, UsageResult } from '../types.js'

const API_BASE_URL = 'https://opencode.ai/console/api'
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'

/** Amounts returned by the API are in micro-cents (1e-6 cent = 1e-8 USD). */
const MICRO_CENTS_PER_USD = 100_000_000

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

/** A rolling quota meter of the "OpenCode Go" subscription (values in micro-cents). */
interface GoMeter {
  startsAt?: string | null
  resetsAt?: string | null
  limitMicroCents?: string | number | null
  usedMicroCents?: string | number | null
}

interface GoMeters {
  fiveHour?: GoMeter | null
  week?: GoMeter | null
  month?: GoMeter | null
}

interface GoStatus {
  product?: string | null
  access?: {
    meters?: GoMeters | null
  } | null
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

/** Convert a micro-cents value (string or number) to USD. Returns null when absent/invalid. */
export function microToUsd(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed / MICRO_CENTS_PER_USD
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

/**
 * Build the "OpenCode Go" subscription tiers from the Go status meters.
 *
 * The Go plan exposes three rolling quota meters (values in micro-cents):
 *   - fiveHour → a 5-hour window (resets 5h after the first use)
 *   - week     → the current UTC week
 *   - month    → the current billing period
 * Each meter has a limit and a used amount; the tier percentage is used/limit.
 * A missing meter (or a Go-less account) simply yields no tier.
 */
export function buildGoTiers(go: GoStatus | null): TierUsage[] {
  const meters = go?.access?.meters
  if (!meters) return []

  const tiers: TierUsage[] = []
  const add = (label: string, meter: GoMeter | null | undefined): void => {
    if (!meter) return
    const used = microToUsd(meter.usedMicroCents)
    const limit = microToUsd(meter.limitMicroCents)
    if (used === null || limit === null || limit <= 0) return
    const percentage = Math.min(100, Math.max(0, Math.round((used / limit) * 100)))
    tiers.push({ name: `Go ${label} ${formatUsd(used)} / ${formatUsd(limit)}`, percentage })
  }

  add('5h', meters.fiveHour)
  add('week', meters.week)
  add('month', meters.month)

  return tiers
}

/** Plan label derived from the billing mode ("pay-as-you-go", "prepaid", ...). */
export function planFromBilling(billing: BillingStatus): string {
  const mode = typeof billing.mode === 'string' && billing.mode ? billing.mode : null
  const billingMode =
    typeof billing.billingMode === 'string' && billing.billingMode ? billing.billingMode : null
  return mode || billingMode || 'opencode'
}

type FetchOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'notFound' }
  | { kind: 'error'; error: ErrorResult }

/** GET a JSON endpoint with the console session cookie and optional org header. */
async function fetchJson<T>(
  url: string,
  sessionCookie: string,
  orgId: string | null
): Promise<FetchOutcome<T>> {
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
        kind: 'error',
        error: { status: 'error', error_code: 'timeout', message: `Request timed out: ${message}` },
      }
    }
    return {
      kind: 'error',
      error: { status: 'error', error_code: 'network_error', message: `Network error: ${message}` },
    }
  }

  if (res.status === 401 || res.status === 403) {
    return {
      kind: 'error',
      error: {
        status: 'error',
        error_code: 'auth_expired',
        message: 'Authentication failed. Session cookie may be expired or invalid.',
      },
    }
  }

  if (res.status === 404) {
    return { kind: 'notFound' }
  }

  if (!res.ok) {
    return {
      kind: 'error',
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
      kind: 'error',
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
      kind: 'error',
      error: {
        status: 'error',
        error_code: 'auth_expired',
        message: `opencode.ai API error: ${tag}. Check the workspace ID and session cookie.`,
      },
    }
  }

  return { kind: 'ok', data: data as T }
}

/** GET a JSON endpoint. An HTTP 404 is reported as a network error. */
async function requestJson<T>(
  url: string,
  sessionCookie: string,
  orgId: string | null
): Promise<ApiOutcome<T>> {
  const outcome = await fetchJson<T>(url, sessionCookie, orgId)
  if (outcome.kind === 'ok') return { ok: true, data: outcome.data }
  if (outcome.kind === 'notFound') {
    return {
      ok: false,
      error: {
        status: 'error',
        error_code: 'network_error',
        message: 'Unexpected response: HTTP 404',
      },
    }
  }
  return { ok: false, error: outcome.error }
}

/** GET a JSON endpoint, returning null data when it is absent (HTTP 404). */
async function requestJsonOrNull<T>(
  url: string,
  sessionCookie: string,
  orgId: string | null
): Promise<ApiOutcome<T | null>> {
  const outcome = await fetchJson<T>(url, sessionCookie, orgId)
  if (outcome.kind === 'ok') return { ok: true, data: outcome.data }
  if (outcome.kind === 'notFound') return { ok: true, data: null }
  return { ok: false, error: outcome.error }
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

    // The Go subscription is optional: a 404 means the account has no Go plan.
    const go = await requestJsonOrNull<GoStatus>(`${API_BASE_URL}/go/status`, sessionCookie, orgId)
    if (!go.ok) return go.error

    const tiers = [
      ...buildTiers(billing.data, usage24h.data, usage30d.data),
      ...buildGoTiers(go.data),
    ]
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
