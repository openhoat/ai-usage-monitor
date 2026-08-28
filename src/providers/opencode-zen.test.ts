import { describe, expect, test } from 'vitest'
import { parseCredential, parseOpenCodeZenPage } from './opencode-zen.js'

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
// parseOpenCodeZenPage – SolidJS SSR hydration patterns
// ---------------------------------------------------------------------------

describe('parseOpenCodeZenPage', () => {
  test('returns null for empty HTML', () => {
    expect(parseOpenCodeZenPage('')).toBeNull()
  })

  test('returns null when no usage fields are found', () => {
    expect(parseOpenCodeZenPage('<html><body>No usage data here</body></html>')).toBeNull()
  })

  test('parses negative balance as debt', () => {
    // -24 442 290 micro-cents = -$24.44
    const html = `<script>balance:-24442290</script>`
    const result = parseOpenCodeZenPage(html)
    expect(result).not.toBeNull()
    expect(result?.status).toBe('ok')
    expect(result?.provider).toBe('opencode-zen')
    expect(result?.plan).toBe('zen')
    expect(result?.tiers[0].name).toContain('Balance -$24.44')
    expect(result?.overall_percentage).toBe(0)
  })

  test('parses positive balance', () => {
    // 10 000 000 micro-cents = $10.00
    const html = `<script>balance:10000000</script>`
    const result = parseOpenCodeZenPage(html)
    expect(result).not.toBeNull()
    expect(result?.tiers.some(t => t.name.includes('Balance $10.00'))).toBe(true)
  })

  test('parses monthlyUsage and monthlyLimit as raw USD', () => {
    const html = `<script>monthlyUsage:5,monthlyLimit:20</script>`
    const result = parseOpenCodeZenPage(html)
    expect(result).not.toBeNull()
    expect(result?.tiers.some(t => t.name.includes('Monthly Spend $5.00 / $20'))).toBe(true)
    expect(result?.overall_percentage).toBe(25)
  })

  test('parses monthlyUsage without limit', () => {
    const html = `<script>monthlyUsage:12.5</script>`
    const result = parseOpenCodeZenPage(html)
    expect(result).not.toBeNull()
    expect(result?.tiers.some(t => t.name.includes('Monthly Spend $12.50'))).toBe(true)
    expect(result?.overall_percentage).toBe(0)
  })

  test('combines balance and monthly tiers when both present', () => {
    const html = `<script>
      balance:-24442290
      monthlyUsage:5
      monthlyLimit:20
    </script>`
    const result = parseOpenCodeZenPage(html)
    expect(result).not.toBeNull()
    expect(result?.tiers.length).toBeGreaterThanOrEqual(2)
    expect(result?.tiers.some(t => t.name.includes('Balance'))).toBe(true)
    expect(result?.tiers.some(t => t.name.includes('Monthly Spend'))).toBe(true)
  })

  test('clamps percentage to [0, 100]', () => {
    const html = `<script>monthlyUsage:30,monthlyLimit:20</script>`
    const result = parseOpenCodeZenPage(html)
    expect(result).not.toBeNull()
    expect(result?.overall_percentage).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Real connection test (skipped unless OPENCODE_ZEN_SESSION is set)
// ---------------------------------------------------------------------------

describe('opencode-zen scraper (real connection)', () => {
  const session = process.env.OPENCODE_ZEN_SESSION
  const hasCredentials = Boolean(session)

  describe.skipIf(!hasCredentials)('with OPENCODE_ZEN_SESSION', () => {
    test('should fetch usage page and return a result', async () => {
      const { opencodeZenProvider } = await import('./opencode-zen.js')
      const result = await opencodeZenProvider.fetchUsage(session!)

      console.log('\n=== OpenCode Zen Usage Data ===')
      console.log(JSON.stringify(result, null, 2))
      console.log('================================\n')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.provider).toBe('opencode-zen')
        expect(result.plan).toBe('zen')
        expect(result.tiers.length).toBeGreaterThan(0)
      }
    })
  })

  describe.skipIf(hasCredentials)('without OPENCODE_ZEN_SESSION', () => {
    test('should skip tests when OPENCODE_ZEN_SESSION is not set', () => {
      console.log('\nTo run real connection tests, set environment variable:')
      console.log('  export OPENCODE_ZEN_SESSION="workspaceId:authCookie"')
      console.log('\nGet the values from opencode.ai:')
      console.log('  1. Go to https://opencode.ai/workspace/<id>/usage')
      console.log('  2. Copy the workspace ID from the URL')
      console.log('  3. Open DevTools (F12) → Application → Cookies')
      console.log('  4. Copy the value of the "auth" cookie')
      console.log('  5. Combine: export OPENCODE_ZEN_SESSION="wrk_01...:eyJ..."')
      expect(true).toBe(true)
    })
  })
})
