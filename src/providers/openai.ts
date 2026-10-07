import { fetchWithRetry } from '../helpers/fetch.js'
import type { Provider, Result, TierUsage } from '../types.js'

function logError(message: string): void {
  process.stderr.write(`${message}\n`)
}

interface CostLineItem {
  object: string
  amount: { value: number; currency: string }
  line_item: string
  start_time: number
  end_time: number
}

interface CostsResponse {
  object: string
  data: CostLineItem[]
  has_more: boolean
  next_page?: string
}

interface SubscriptionResponse {
  hard_limit_usd: number
  soft_limit_usd: number
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function getMonthBounds(): { startTime: number; endTime: number } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return {
    startTime: Math.floor(start.getTime() / 1000),
    endTime: Math.floor(end.getTime() / 1000),
  }
}

function accumulateCosts(costsByModel: Map<string, number>, data: CostsResponse): void {
  for (const item of data.data) {
    const model = item.line_item || 'Other'
    const cents = item.amount?.value ?? 0
    costsByModel.set(model, (costsByModel.get(model) ?? 0) + cents)
  }
}

function nextPageUrl(data: CostsResponse, baseUrl: string): string | null {
  if (data.has_more && data.next_page) return `${baseUrl}&page=${data.next_page}`
  return null
}

async function fetchMonthlyCosts(apiKey: string): Promise<Map<string, number> | null> {
  const headers = buildHeaders(apiKey)
  const { startTime, endTime } = getMonthBounds()
  const costsByModel = new Map<string, number>()

  const BASE_URL = `https://api.openai.com/v1/organization/costs?start_time=${startTime}&end_time=${endTime}&limit=30&group_by=line_item`
  let url: string | null = BASE_URL

  try {
    while (url) {
      const res = await fetchWithRetry(url, { headers, redirect: 'follow' })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        logError(`[openai] Costs API error: ${res.status} ${res.statusText} – ${body}`)
        return null
      }

      const data = (await res.json()) as CostsResponse
      accumulateCosts(costsByModel, data)
      url = nextPageUrl(data, BASE_URL)
    }
  } catch (err) {
    logError(`[openai] Costs API fetch error: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  return costsByModel
}

async function fetchBudgetLimit(apiKey: string): Promise<number | null> {
  const headers = buildHeaders(apiKey)

  try {
    const res = await fetchWithRetry('https://api.openai.com/v1/organization/subscription', {
      headers,
      redirect: 'follow',
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logError(`[openai] Subscription API error: ${res.status} ${res.statusText} – ${body}`)
      return null
    }

    const data = (await res.json()) as SubscriptionResponse
    return data.hard_limit_usd ?? data.soft_limit_usd ?? null
  } catch (err) {
    logError(
      `[openai] Subscription API fetch error: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

function buildTiers(
  costsByModel: Map<string, number>,
  totalCents: number,
  totalDollars: number,
  budgetLimit: number | null
): TierUsage[] {
  const tiers: TierUsage[] = []

  if (budgetLimit && budgetLimit > 0) {
    tiers.push({
      name: `Monthly ($${totalDollars.toFixed(2)}/$${budgetLimit.toFixed(0)})`,
      percentage: Math.round((totalDollars / budgetLimit) * 10000) / 100,
    })
  } else {
    tiers.push({ name: `Monthly Spend ($${totalDollars.toFixed(2)})`, percentage: 0 })
  }

  const sorted = Array.from(costsByModel.entries())
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  for (const [model, cents] of sorted) {
    tiers.push({
      name: `${model} ($${(cents / 100).toFixed(2)})`,
      percentage: totalCents > 0 ? Math.round((cents / totalCents) * 10000) / 100 : 0,
    })
  }

  return tiers
}

function overallPercentage(totalDollars: number, budgetLimit: number | null): number {
  if (budgetLimit && budgetLimit > 0) return Math.round((totalDollars / budgetLimit) * 10000) / 100
  return 0
}

export const openaiProvider: Provider = {
  name: 'openai',
  async fetchUsage(apiKey: string): Promise<Result> {
    try {
      const costsByModel = await fetchMonthlyCosts(apiKey)
      if (!costsByModel) {
        return {
          status: 'error',
          error_code: 'auth_expired',
          message: 'Could not retrieve cost data. API key may be invalid.',
        }
      }

      const totalCents = Array.from(costsByModel.values()).reduce((sum, v) => sum + v, 0)
      const totalDollars = totalCents / 100
      const budgetLimit = await fetchBudgetLimit(apiKey)

      const tiers = buildTiers(costsByModel, totalCents, totalDollars, budgetLimit)

      // Reset at end of month
      const { endTime } = getMonthBounds()
      const resetDate = new Date(endTime * 1000).toISOString()
      const resetInHours = Math.max(0, Math.round((endTime * 1000 - Date.now()) / 3600000))

      return {
        status: 'ok',
        provider: 'openai',
        plan: 'api',
        tiers,
        overall_percentage: overallPercentage(totalDollars, budgetLimit),
        reset_date: resetDate,
        reset_in_hours: resetInHours,
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
