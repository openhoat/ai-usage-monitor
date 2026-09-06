import { describe, expect, test } from 'vitest'
import { parseOllamaPage } from './ollama.js'

const OLLAMA_SETTINGS_URL = 'https://ollama.com/settings'

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0'

// Mock HTML fixture matching the current ollama.com/settings structure
// (captured 2026-09-06). Includes the "Included usage" section, the
// "$X of $Y used" monthly meter, the balance remaining block and the
// local-time reset element.
const MOCK_SETTINGS_HTML = `<!doctype html>
<html>
  <head><title>Usage · Settings</title></head>
  <body>
    <div class="flex flex-1 justify-center">
      <div class="mx-auto max-w-[50rem] w-full px-6 py-10">
        <h2 class="text-xl font-medium flex items-center space-x-2">
          <span>Included usage</span>
          <span class="text-xs font-normal px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 capitalize">pro</span>
        </h2>
        <p class="text-xs text-neutral-500 mb-4">
          Cloud models and capabilities such as web search draw from your monthly included usage.
        </p>
        <div>
          <div class="flex justify-between mb-2">
            <span class="text-sm">Monthly usage</span>
            <span class="text-sm ">$4.32 of $60 used</span>
          </div>
          <div class="relative group" data-usage-meter>
            <div class="relative h-3 overflow-hidden rounded-full bg-neutral-200" data-usage-track aria-label="Monthly usage $4.32 of $60 used">
              <div class="flex h-full overflow-hidden bg-neutral-950" style="width: 7.2%; ">
                <button type="button" style="width: 13.6%; background: #3b82f6" data-usage-segment data-model="glm-5.2" data-requests="18" aria-label="glm-5.2: 18 requests"></button>
                <button type="button" style="width: 86.4%; background: #4f46e5" data-usage-segment data-model="deepseek-v4-flash:0731" data-requests="106" aria-label="deepseek-v4-flash:0731: 106 requests"></button>
              </div>
            </div>
          </div>
          <div class="text-xs text-neutral-500 mt-1 local-time" data-time="2026-09-24T09:40:39Z">
            Resets in 2 weeks.
          </div>
        </div>
        <div id="extra-usage" class="space-y-6 pt-4">
          <div class="space-y-7">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="mb-1 text-xs text-neutral-500">Balance remaining</div>
                <div class="text-2xl font-medium leading-tight">$0</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`

// Legacy structure fixture (pre-2026): "Cloud usage" + "N% used" blocks
const LEGACY_SETTINGS_HTML = `<!doctype html>
<html>
  <head><title>Usage · Settings</title></head>
  <body>
    <div class="flex justify-between">
      <span class="text-sm">Cloud usage</span>
      <span class="text-sm">3.9% used</span>
    </div>
    <div class="flex justify-between">
      <span class="text-sm">Weekly usage</span>
      <span class="text-sm">5% used</span>
    </div>
    <div class="text-xs text-neutral-500 mt-1 local-time" data-time="2026-09-24T09:40:39Z">
      Resets in 2 weeks.
    </div>
  </body>
</html>`

// WorkOS AuthKit login page fixture
const LOGIN_PAGE_HTML = `<!doctype html>
<html data-dpl-id="hosted-authkit-3bc070dfd073a44f17dfb05485546e63b13eb277">
  <head><title>Sign in</title></head>
  <body>
    <div class="ak-Background">
      <form action="/signin" method="post">
        <input type="email" name="email" />
        <button type="submit">Sign in</button>
      </form>
    </div>
  </body>
</html>`

/**
 * Fetch settings page with session cookie
 */
async function fetchSettingsPage(sessionCookie: string): Promise<string | null> {
  try {
    const res = await fetch(OLLAMA_SETTINGS_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        Cookie: sessionCookie,
      },
      redirect: 'follow',
    })

    if (!res.ok) {
      console.error('HTTP error:', res.status, res.statusText)
      return null
    }

    const html = await res.text()

    // Check if we're actually logged in (not redirected to login page)
    // Note: "/signout" appears in settings page when logged in, so we check for login-specific elements
    if (
      html.includes('action="/signin"') ||
      html.includes('href="/login"') ||
      html.includes('href="/signin"')
    ) {
      console.error('Not logged in - page contains login elements')
      return null
    }

    return html
  } catch (error) {
    console.error('Fetch settings error:', error)
    return null
  }
}

describe('parseOllamaPage', () => {
  test('should parse plan, monthly usage and balance from current structure', () => {
    const result = parseOllamaPage(MOCK_SETTINGS_HTML)

    expect(result).not.toBeNull()
    expect(result?.status).toBe('ok')
    expect(result?.provider).toBe('ollama')
    expect(result?.plan).toBe('pro')

    // Monthly usage: $4.32 of $60 -> 7.2%
    const monthly = result?.tiers.find(t => t.name === 'Monthly usage')
    expect(monthly).toBeDefined()
    expect(monthly?.percentage).toBeCloseTo(7.2, 1)

    // Balance remaining: $0
    const balance = result?.tiers.find(t => t.name === 'Balance remaining')
    expect(balance).toBeDefined()
    expect(balance?.percentage).toBe(0)

    // Overall percentage should be the highest tier percentage
    expect(result?.overall_percentage).toBeCloseTo(7.2, 1)

    // Reset time
    expect(result?.reset_date).toBe('2026-09-24T09:40:39Z')
    expect(result?.reset_in_hours).not.toBeNull()
  })

  test('should parse legacy "N% used" structure', () => {
    const result = parseOllamaPage(LEGACY_SETTINGS_HTML)

    expect(result).not.toBeNull()
    expect(result?.status).toBe('ok')
    expect(result?.plan).toBe('free')

    const cloud = result?.tiers.find(t => t.name === 'Cloud usage')
    expect(cloud).toBeDefined()
    expect(cloud?.percentage).toBeCloseTo(3.9, 1)

    const weekly = result?.tiers.find(t => t.name === 'Weekly usage')
    expect(weekly).toBeDefined()
    expect(weekly?.percentage).toBe(5)

    expect(result?.overall_percentage).toBe(5)
  })

  test('should return null when no usage data is present', () => {
    const result = parseOllamaPage('<html><body><h1>No usage here</h1></body></html>')
    expect(result).toBeNull()
  })

  test('should return null for the WorkOS login page', () => {
    const result = parseOllamaPage(LOGIN_PAGE_HTML)
    expect(result).toBeNull()
  })
})

describe('ollama scraper (real connection)', () => {
  // Use session cookie directly (from __Secure-session cookie)
  const sessionCookie = process.env.OLLAMA_SESSION_COOKIE

  const hasCredentials = Boolean(sessionCookie)

  describe.skipIf(!hasCredentials)('with session cookie', () => {
    test('should fetch settings page with session cookie', async () => {
      // Format the cookie header - check if it already has the cookie name prefix
      const cookieHeader = sessionCookie!.startsWith('__Secure-session=')
        ? sessionCookie!
        : `__Secure-session=${sessionCookie}`

      // Fetch settings
      const html = await fetchSettingsPage(cookieHeader)

      console.log('Settings page length:', html?.length || 0)
      expect(html).not.toBeNull()
      expect(html).toContain('Included usage')
    })

    test('should scrape usage data from real page', async () => {
      // Format the cookie header - check if it already has the cookie name prefix
      const cookieHeader = sessionCookie!.startsWith('__Secure-session=')
        ? sessionCookie!
        : `__Secure-session=${sessionCookie}`

      // Fetch and parse
      const html = await fetchSettingsPage(cookieHeader)
      expect(html).not.toBeNull()

      const result = parseOllamaPage(html!)

      console.log('\n=== Ollama Usage Data ===')
      console.log('Plan:', result?.plan)
      console.log('Overall:', `${result?.overall_percentage}%`)
      console.log('Tiers:')
      result?.tiers.forEach(tier => {
        console.log(`  - ${tier.name}: ${tier.percentage}%`)
      })
      console.log('Reset in:', result?.reset_in_hours, 'hours')
      console.log('=========================\n')

      expect(result).not.toBeNull()
      expect(result?.status).toBe('ok')
      expect(result?.provider).toBe('ollama')
      expect(result?.tiers.length).toBeGreaterThan(0)
    })
  })

  describe.skipIf(hasCredentials)('without session cookie', () => {
    test('should skip tests when OLLAMA_SESSION_COOKIE is not set', () => {
      console.log('\nTo run real connection tests, set environment variable:')
      console.log('  export OLLAMA_SESSION_COOKIE=your-session-cookie-value')
      console.log('\nGet the __Secure-session cookie from your browser:')
      console.log('  1. Go to ollama.com/settings')
      console.log('  2. Open DevTools (F12) → Application → Cookies')
      console.log('  3. Copy the value of __Secure-session')
      expect(true).toBe(true)
    })
  })
})
