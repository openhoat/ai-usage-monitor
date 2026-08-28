import { fetchWithRetry } from '../helpers/fetch.js'
import type { Provider, Result, TierUsage } from '../types.js'

function logError(message: string): void {
  process.stderr.write(`${message}\n`)
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  }
}

function getMonthBounds(): { startDate: string; endDate: string; endTime: number } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
    endTime: end.getTime(),
  }
}

// --- Models API types (fallback) ---

interface ModelEntry {
  id: string
  display_name?: string
}

interface ModelsResponse {
  data: ModelEntry[]
  has_more?: boolean
}

// --- Admin API types ---

interface OrgInfo {
  id: string
  name?: string
  type?: string
  billing?: {
    monthly_spend_limit?: number
    monthly_spend?: number
  }
}

interface OrgsResponse {
  data: OrgInfo[]
  has_more?: boolean
}

interface UsageEntry {
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  total_tokens?: number
  start_time?: string
  end_time?: string
}

interface UsageResponse {
  data: UsageEntry[]
  has_more?: boolean
}

// Approximate pricing per million tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku': { input: 1, output: 5 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-sonnet': { input: 0.6, output: 3 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
}

function estimateModelCost(model: string, inputTokens: number, outputTokens: number): number {
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.toLowerCase().includes(prefix)) {
      return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
    }
  }
  // Default: sonnet-level pricing
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15
}

async function tryBillingApi(apiKey: string): Promise<Result | null> {
  const headers = buildHeaders(apiKey)

  // Step 1: Get organizations
  let orgs: OrgInfo[]
  try {
    const orgRes = await fetchWithRetry('https://api.anthropic.com/v1/organizations', {
      headers,
      redirect: 'follow',
    })

    if (orgRes.status === 403) {
      logError('[anthropic] Admin API access denied (403) – API key may lack admin permissions')
      return null // Fall back to models validation
    }

    if (!orgRes.ok) {
      // 404 = clé sans accès admin, fallback normal vers /v1/models
      if (orgRes.status !== 404) {
        const body = await orgRes.text().catch(() => '')
        logError(
          `[anthropic] Organizations API error: ${orgRes.status} ${orgRes.statusText} – ${body}`
        )
      }
      return null
    }

    const orgData = (await orgRes.json()) as OrgsResponse
    orgs = orgData.data ?? []
  } catch (err) {
    logError(
      `[anthropic] Organizations API fetch error: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }

  if (orgs.length === 0) {
    logError('[anthropic] No organizations found')
    return null
  }

  // Step 2: Use first org to get usage data
  const orgId = orgs[0].id
  const billing = orgs[0].billing

  // If billing info is already in the org response, use it directly
  if (billing && billing.monthly_spend !== undefined) {
    const monthlySpend = billing.monthly_spend
    const budgetLimit = billing.monthly_spend_limit ?? 0
    const { endDate, endTime } = getMonthBounds()
    const resetDate = new Date(endDate).toISOString()
    const resetInHours = Math.max(0, Math.round((endTime - Date.now()) / 3600000))

    const tiers: TierUsage[] = []

    if (budgetLimit > 0) {
      tiers.push({
        name: `Monthly ($${monthlySpend.toFixed(2)}/$${budgetLimit.toFixed(0)})`,
        percentage: Math.round((monthlySpend / budgetLimit) * 10000) / 100,
      })
    } else {
      tiers.push({
        name: `Monthly Spend ($${monthlySpend.toFixed(2)})`,
        percentage: 0,
      })
    }

    // Also try to get per-model usage
    const modelUsage = await tryUsageApi(headers, orgId)
    if (modelUsage && modelUsage.size > 0) {
      const totalTokens = Array.from(modelUsage.values()).reduce(
        (sum, m) => sum + m.inputTokens + m.outputTokens,
        0
      )
      if (totalTokens > 0) {
        for (const [modelName, modelData] of modelUsage) {
          const cost = estimateModelCost(modelName, modelData.inputTokens, modelData.outputTokens)
          if (cost > 0) {
            const pct = monthlySpend > 0 ? Math.round((cost / monthlySpend) * 10000) / 100 : 0
            tiers.push({
              name: `${modelName} ($${cost.toFixed(2)})`,
              percentage: pct,
            })
          }
        }
      }
    }

    return {
      status: 'ok',
      provider: 'anthropic',
      plan: 'api',
      tiers,
      overall_percentage:
        budgetLimit > 0 ? Math.round((monthlySpend / budgetLimit) * 10000) / 100 : 0,
      reset_date: resetDate,
      reset_in_hours: resetInHours,
    }
  }

  // Step 3: If no billing info in org, try usage API to compute costs
  const modelUsage = await tryUsageApi(headers, orgId)
  if (modelUsage && modelUsage.size > 0) {
    const { endDate, endTime } = getMonthBounds()
    const resetDate = new Date(endDate).toISOString()
    const resetInHours = Math.max(0, Math.round((endTime - Date.now()) / 3600000))

    const tiers: TierUsage[] = []
    let totalCost = 0

    // Sort models by cost descending
    const modelCosts = new Map<string, number>()
    for (const [modelName, modelData] of modelUsage) {
      const cost = estimateModelCost(modelName, modelData.inputTokens, modelData.outputTokens)
      modelCosts.set(modelName, cost)
      totalCost += cost
    }

    const sorted = Array.from(modelCosts.entries()).sort(([, a], [, b]) => b - a)

    tiers.push({
      name: `Monthly Spend ($${totalCost.toFixed(2)})`,
      percentage: 0, // No budget limit to compare against
    })

    for (const [modelName, cost] of sorted.slice(0, 5)) {
      const pct = totalCost > 0 ? Math.round((cost / totalCost) * 10000) / 100 : 0
      tiers.push({
        name: `${modelName} ($${cost.toFixed(2)})`,
        percentage: pct,
      })
    }

    return {
      status: 'ok',
      provider: 'anthropic',
      plan: 'api',
      tiers,
      overall_percentage: 0,
      reset_date: resetDate,
      reset_in_hours: resetInHours,
    }
  }

  // No billing or usage data available from Admin API
  return null
}

interface ModelUsageData {
  inputTokens: number
  outputTokens: number
}

async function tryUsageApi(
  headers: Record<string, string>,
  orgId: string
): Promise<Map<string, ModelUsageData> | null> {
  const { startDate, endDate } = getMonthBounds()

  try {
    const usageUrl = `https://api.anthropic.com/v1/organizations/${orgId}/usage?start_date=${startDate}&end_date=${endDate}`
    const usageRes = await fetchWithRetry(usageUrl, { headers, redirect: 'follow' })

    if (!usageRes.ok) {
      const body = await usageRes.text().catch(() => '')
      logError(`[anthropic] Usage API error: ${usageRes.status} ${usageRes.statusText} – ${body}`)
      return null
    }

    const usageData = (await usageRes.json()) as UsageResponse
    const entries = usageData.data ?? []
    if (entries.length === 0) return null

    const modelUsage = new Map<string, ModelUsageData>()

    for (const entry of entries) {
      const model = entry.model || 'unknown'
      const existing = modelUsage.get(model) || { inputTokens: 0, outputTokens: 0 }
      existing.inputTokens += entry.input_tokens ?? 0
      existing.outputTokens += entry.output_tokens ?? 0
      modelUsage.set(model, existing)
    }

    return modelUsage
  } catch (err) {
    logError(
      `[anthropic] Usage API fetch error: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

async function tryModelsValidation(apiKey: string): Promise<Result> {
  const headers = buildHeaders(apiKey)

  const res = await fetchWithRetry('https://api.anthropic.com/v1/models', {
    headers,
    redirect: 'follow',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logError(`[anthropic] Models API error: ${res.status} ${res.statusText} – ${body}`)
    return {
      status: 'error',
      error_code: 'auth_expired',
      message: 'Could not authenticate with Anthropic API. API key may be invalid.',
    }
  }

  const data = (await res.json()) as ModelsResponse
  const models = data.data ?? []
  const modelCount = models.length

  const { endTime, endDate } = getMonthBounds()
  const resetDate = new Date(endDate).toISOString()
  const resetInHours = Math.max(0, Math.round((endTime - Date.now()) / 3600000))

  return {
    status: 'ok',
    provider: 'anthropic',
    plan: 'api',
    tiers: [
      {
        name: `API Key Valid (${modelCount} models) – No billing access`,
        percentage: 0,
      },
    ],
    overall_percentage: 0,
    reset_date: resetDate,
    reset_in_hours: resetInHours,
  }
}

export const anthropicProvider: Provider = {
  name: 'anthropic',
  async fetchUsage(apiKey: string): Promise<Result> {
    try {
      // Try Admin API first for billing data
      const billingResult = await tryBillingApi(apiKey)
      if (billingResult) return billingResult

      // Fall back to models validation
      const validationResult = await tryModelsValidation(apiKey)
      return validationResult
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { status: 'error', error_code: 'timeout', message: `Request timed out: ${message}` }
      }
      return { status: 'error', error_code: 'network_error', message: `Network error: ${message}` }
    }
  },
}
