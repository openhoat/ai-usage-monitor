import { describe, expect, test } from 'vitest'
import { parseCredential, parseOpenCodeGoPage } from './opencode-go.js'

// ---------------------------------------------------------------------------
// parseCredential
// ---------------------------------------------------------------------------

describe('parseCredential', () => {
  test('returns workspaceId and authCookie for valid credential', () => {
    const result = parseCredential('wrk_01ABC:eyJhbGciOiJIUzI1NiJ9')
    expect(result).not.toBeNull()
    expect(result?.workspaceId).toBe('wrk_01ABC')
    expect(result?.authCookie).toBe('eyJhbGciOiJIUzI1NiJ9')
  })

  test('handles cookie value that contains colons', () => {
    const result = parseCredential('wrk_01ABC:part1:part2:part3')
    expect(result).not.toBeNull()
    expect(result?.workspaceId).toBe('wrk_01ABC')
    expect(result?.authCookie).toBe('part1:part2:part3')
  })

  test('returns null when no colon is present', () => {
    expect(parseCredential('nocolon')).toBeNull()
  })

  test('returns null when workspaceId is empty', () => {
    expect(parseCredential(':sometoken')).toBeNull()
  })

  test('returns null when authCookie is empty', () => {
    expect(parseCredential('wrk_01ABC:')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseCredential('')).toBeNull()
  })

  test('trims whitespace from workspaceId and authCookie', () => {
    const result = parseCredential('  wrk_01ABC  :  mytoken  ')
    expect(result?.workspaceId).toBe('wrk_01ABC')
    expect(result?.authCookie).toBe('mytoken')
  })
})

// ---------------------------------------------------------------------------
// parseOpenCodeGoPage – SolidJS SSR hydration patterns
// ---------------------------------------------------------------------------

describe('parseOpenCodeGoPage', () => {
  test('returns null for empty HTML', () => {
    expect(parseOpenCodeGoPage('')).toBeNull()
  })

  test('returns null when no usage fields are found', () => {
    expect(parseOpenCodeGoPage('<html><body>No usage data here</body></html>')).toBeNull()
  })

  test('parses rollingUsage', () => {
    const html = `<script>rollingUsage:$R[36]={status:"ok",resetInSec:18000,usagePercent:0}</script>`
    const result = parseOpenCodeGoPage(html)
    expect(result).not.toBeNull()
    expect(result?.status).toBe('ok')
    expect(result?.provider).toBe('opencode-go')
    expect(result?.plan).toBe('go')
    expect(result?.tiers.some(t => t.name.includes('Rolling Usage 0%'))).toBe(true)
  })

  test('parses weeklyUsage', () => {
    const html = `<script>weeklyUsage:$R[37]={status:"ok",resetInSec:483164,usagePercent:0}</script>`
    const result = parseOpenCodeGoPage(html)
    expect(result).not.toBeNull()
    expect(result?.tiers.some(t => t.name.includes('Weekly Usage 0%'))).toBe(true)
  })

  test('parses monthlyUsage and uses it for overall percentage', () => {
    const html = `<script>monthlyUsage:$R[38]={status:"ok",resetInSec:1468502,usagePercent:99}</script>`
    const result = parseOpenCodeGoPage(html)
    expect(result).not.toBeNull()
    expect(result?.tiers.some(t => t.name.includes('Monthly Usage 99%'))).toBe(true)
    expect(result?.overall_percentage).toBe(99)
    expect(result?.reset_in_hours).toBe(Math.round(1468502 / 3600))
    expect(result?.reset_date).toBeTruthy()
  })

  test('combines rolling, weekly and monthly usage buckets', () => {
    const html = `<script>
      rollingUsage:$R[36]={status:"ok",resetInSec:18000,usagePercent:0}
      weeklyUsage:$R[37]={status:"ok",resetInSec:483164,usagePercent:0}
      monthlyUsage:$R[38]={status:"ok",resetInSec:1468502,usagePercent:99}
    </script>`
    const result = parseOpenCodeGoPage(html)
    expect(result).not.toBeNull()
    expect(result?.tiers.some(t => t.name.includes('Rolling Usage'))).toBe(true)
    expect(result?.tiers.some(t => t.name.includes('Weekly Usage'))).toBe(true)
    expect(result?.tiers.some(t => t.name.includes('Monthly Usage'))).toBe(true)
    // Balance and Monthly Limit are intentionally excluded — they're shared with OpenCode Zen
    expect(result?.tiers.some(t => t.name.includes('Balance'))).toBe(false)
    expect(result?.tiers.some(t => t.name.includes('Monthly Limit'))).toBe(false)
    expect(result?.overall_percentage).toBe(99)
  })

  test('clamps usagePercent to [0, 100]', () => {
    const html = `<script>monthlyUsage:$R[1]={status:"ok",resetInSec:0,usagePercent:150}</script>`
    const result = parseOpenCodeGoPage(html)
    expect(result).not.toBeNull()
    expect(result?.tiers[0].percentage).toBe(100)
    expect(result?.overall_percentage).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Real connection test (skipped unless OPENCODE_GO_SESSION is set)
// ---------------------------------------------------------------------------

describe('opencode-go scraper (real connection)', () => {
  const session = process.env.OPENCODE_GO_SESSION
  const hasCredentials = Boolean(session)

  describe.skipIf(!hasCredentials)('with OPENCODE_GO_SESSION', () => {
    test('should fetch usage page and return a result', async () => {
      const { opencodeGoProvider } = await import('./opencode-go.js')
      const result = await opencodeGoProvider.fetchUsage(session!)

      console.log('\n=== OpenCode Go Usage Data ===')
      console.log(JSON.stringify(result, null, 2))
      console.log('================================\n')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.provider).toBe('opencode-go')
        expect(result.plan).toBe('go')
        expect(result.tiers.length).toBeGreaterThan(0)
      }
    })
  })

  describe.skipIf(hasCredentials)('without OPENCODE_GO_SESSION', () => {
    test('should skip tests when OPENCODE_GO_SESSION is not set', () => {
      console.log('\nTo run real connection tests, set environment variable:')
      console.log('  export OPENCODE_GO_SESSION="workspaceId:authCookie"')
      console.log('\nGet the values from opencode.ai:')
      console.log('  1. Go to https://opencode.ai/workspace/<id>/go')
      console.log('  2. Copy the workspace ID from the URL')
      console.log('  3. Open DevTools (F12) → Application → Cookies')
      console.log('  4. Copy the value of the "auth" cookie')
      console.log('  5. Combine: export OPENCODE_GO_SESSION="wrk_01...:eyJ..."')
      expect(true).toBe(true)
    })
  })
})
