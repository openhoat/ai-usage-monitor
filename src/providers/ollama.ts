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

export function parseOllamaPage(html: string): UsageResult | null {
  const tiers: TierUsage[] = []
  let overallPercentage = 0
  let plan = 'free'
  let resetDate: string | null = null
  let resetInHours: number | null = null

  // Extract plan from the "Included usage" badge (new structure)
  // <h2 ...><span>Included usage</span><span class="...">pro</span></h2>
  // Note: the closing </span> may be split across lines (e.g. "</span\n>")
  const planMatch =
    html.match(/>Included usage<[\s\S]{0,300}?>(\w+)<\/span\s*>/i) ||
    html.match(/>Cloud usage<[\s\S]{0,500}?>(\w+)</) ||
    html.match(/Cloud usage[\s\S]{0,200}?badge[^>]*>(\w+)<\//) ||
    html.match(/data-testid="plan-badge"[^>]*>(\w+)</)
  if (planMatch) {
    plan = planMatch[1].trim().toLowerCase()
  }

  // Parse the monthly usage block (new structure):
  // <div class="flex justify-between mb-2">
  //   <span class="text-sm">Monthly usage</span>
  //   <span class="text-sm ">$4.32 of $60 used</span>
  // </div>
  // Fallback to the legacy "N% used" format.
  const blockMatches = html.matchAll(
    /class="flex justify-between[^>]*>\s*<span[^>]*>([\w][\w\s]*?)<\/span>\s*<span[^>]*>[\s\n]*(\$[\d.,]+\s*of\s*\$[\d.,]+\s*used|\d+(?:\.\d+)?\s*% used)/g
  )
  for (const blockMatch of blockMatches) {
    const name = blockMatch[1].trim()
    const valueText = blockMatch[2].trim()

    let percentage = 0

    // New format: "$4.32 of $60 used" -> percentage = spent / total * 100
    const dollarMatch = valueText.match(/\$([\d.,]+)\s*of\s*\$([\d.,]+)\s*used/i)
    if (dollarMatch) {
      const spent = parseFloat(dollarMatch[1].replace(/,/g, ''))
      const total = parseFloat(dollarMatch[2].replace(/,/g, ''))
      if (total > 0) {
        percentage = (spent / total) * 100
      }
    } else {
      // Legacy format: "3.9% used"
      const pctMatch = valueText.match(/(\d+(?:\.\d+)?)\s*%\s*used/i)
      if (pctMatch) {
        percentage = parseFloat(pctMatch[1])
      }
    }

    if (percentage > 0 || name) {
      tiers.push({ name, percentage })

      if (percentage > overallPercentage) {
        overallPercentage = percentage
      }
    }
  }

  // Fallback: if no "of $X used" block matched, read the percentage from the
  // usage meter width style: <div ... style="width: 7.2%; ">
  if (tiers.length === 0) {
    const meterMatch = html.match(/data-usage-meter[\s\S]{0,800}?style="width:\s*([\d.]+)%/)
    if (meterMatch) {
      const percentage = parseFloat(meterMatch[1])
      tiers.push({ name: 'Monthly usage', percentage })
      overallPercentage = percentage
    }
  }

  // Extract the extra-usage balance as an additional tier (new structure):
  // <div class="mb-1 text-xs text-neutral-500">Balance remaining</div>
  // <div class="text-2xl font-medium leading-tight">$0</div>
  const balanceMatch = html.match(
    />Balance remaining<[\s\S]{0,200}?class="text-2xl[^"]*"[^>]*>\$([\d.,]+)</
  )
  if (balanceMatch) {
    const balance = parseFloat(balanceMatch[1].replace(/,/g, ''))
    tiers.push({ name: 'Balance remaining', percentage: balance })
  }

  // Look for reset time (local-time can be among multiple CSS classes)
  const resetMatch = html.match(/class="[^"]*\blocal-time\b[^"]*"[^>]*?data-time="([^"]+)"/i)
  if (resetMatch) {
    const resetTimeAttr = resetMatch[1]
    const resetTime = new Date(resetTimeAttr).getTime()
    if (!Number.isNaN(resetTime)) {
      resetInHours = Math.max(0, Math.round((resetTime - Date.now()) / 3600000))
      resetDate = resetTimeAttr
    }
  }

  if (tiers.length === 0) return null

  return {
    status: 'ok',
    provider: 'ollama',
    plan,
    tiers,
    overall_percentage: Math.round(overallPercentage * 100) / 100,
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
