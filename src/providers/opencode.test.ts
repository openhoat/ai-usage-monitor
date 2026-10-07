import { describe, expect, test } from 'vitest'
import { buildTiers, formatUsd, microToUsd, parseCredential, planFromBilling } from './opencode.js'

// ---------------------------------------------------------------------------
// parseCredential
// ---------------------------------------------------------------------------

describe('parseCredential', () => {
  test('returns orgId and sessionCookie for "orgId:sessionCookie"', () => {
    const result = parseCredential('wrk_01ABC:st_123')
    expect(result).not.toBeNull()
    expect(result?.orgId).toBe('wrk_01ABC')
    expect(result?.sessionCookie).toBe('st_123')
  })

  test('handles a cookie value that contains colons', () => {
    const result = parseCredential('wrk_01ABC:part1:part2:part3')
    expect(result).not.toBeNull()
    expect(result?.orgId).toBe('wrk_01ABC')
    expect(result?.sessionCookie).toBe('part1:part2:part3')
  })

  test('accepts a bare session cookie (orgId resolved later)', () => {
    const result = parseCredential('st_c19366f1-ba32')
    expect(result).not.toBeNull()
    expect(result?.orgId).toBe('')
    expect(result?.sessionCookie).toBe('st_c19366f1-ba32')
  })

  test('returns null when the cookie is empty', () => {
    expect(parseCredential('wrk_01ABC:')).toBeNull()
  })

  test('returns null for an empty string', () => {
    expect(parseCredential('')).toBeNull()
    expect(parseCredential('   ')).toBeNull()
  })

  test('trims whitespace from orgId and sessionCookie', () => {
    const result = parseCredential('  wrk_01ABC  :  st_123  ')
    expect(result?.orgId).toBe('wrk_01ABC')
    expect(result?.sessionCookie).toBe('st_123')
  })
})

// ---------------------------------------------------------------------------
// microToUsd / formatUsd
// ---------------------------------------------------------------------------

describe('microToUsd', () => {
  test('converts a numeric string', () => {
    expect(microToUsd('-24442290')).toBeCloseTo(-24.44229, 5)
    expect(microToUsd('10000000')).toBe(10)
  })

  test('converts a number', () => {
    expect(microToUsd(46371079)).toBeCloseTo(46.371079, 5)
  })

  test('returns null for null / undefined / empty / invalid', () => {
    expect(microToUsd(null)).toBeNull()
    expect(microToUsd(undefined)).toBeNull()
    expect(microToUsd('')).toBeNull()
    expect(microToUsd('not-a-number')).toBeNull()
  })
})

describe('formatUsd', () => {
  test('formats a positive amount', () => {
    expect(formatUsd(46.371079)).toBe('$46.37')
  })

  test('formats a negative amount as debt', () => {
    expect(formatUsd(-24.44229)).toBe('-$24.44')
  })

  test('formats zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
})

// ---------------------------------------------------------------------------
// buildTiers
// ---------------------------------------------------------------------------

describe('buildTiers', () => {
  test('builds balance, 24h and 30d tiers', () => {
    const tiers = buildTiers(
      { balanceMicroCents: '-24442290', mode: 'pay-as-you-go' },
      { totalCostMicroCents: '46371079' },
      { totalCostMicroCents: '846819868' }
    )
    expect(tiers.map(t => t.name)).toEqual([
      'Balance -$24.44',
      'Spend 24h $46.37',
      'Spend 30d $846.82',
    ])
    expect(tiers.every(t => t.percentage === 0)).toBe(true)
  })

  test('skips absent values', () => {
    const tiers = buildTiers({}, { totalCostMicroCents: '10000000' }, {})
    expect(tiers).toHaveLength(1)
    expect(tiers[0].name).toBe('Spend 24h $10.00')
  })

  test('returns an empty list when nothing is available', () => {
    expect(buildTiers({}, {}, {})).toEqual([])
  })

  test('parses a positive balance as credit', () => {
    const tiers = buildTiers({ balanceMicroCents: '10000000' }, {}, {})
    expect(tiers[0].name).toBe('Balance $10.00')
  })
})

// ---------------------------------------------------------------------------
// planFromBilling
// ---------------------------------------------------------------------------

describe('planFromBilling', () => {
  test('prefers mode over billingMode', () => {
    expect(planFromBilling({ mode: 'pay-as-you-go', billingMode: 'prepaid' })).toBe('pay-as-you-go')
  })

  test('falls back to billingMode', () => {
    expect(planFromBilling({ billingMode: 'prepaid' })).toBe('prepaid')
  })

  test('falls back to "opencode"', () => {
    expect(planFromBilling({})).toBe('opencode')
  })
})

// ---------------------------------------------------------------------------
// Real connection test (skipped unless OPENCODE_SESSION is set)
// ---------------------------------------------------------------------------

describe('opencode scraper (real connection)', () => {
  const session = process.env.OPENCODE_SESSION
  const hasCredentials = Boolean(session)

  describe.skipIf(!hasCredentials)('with OPENCODE_SESSION', () => {
    test('should fetch usage and return a result', async () => {
      const { opencodeProvider } = await import('./opencode.js')
      const result = await opencodeProvider.fetchUsage(session!)

      console.log('\n=== OpenCode Usage Data ===')
      console.log(JSON.stringify(result, null, 2))
      console.log('===========================\n')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.provider).toBe('opencode')
        expect(result.tiers.length).toBeGreaterThan(0)
      }
    })
  })

  describe.skipIf(hasCredentials)('without OPENCODE_SESSION', () => {
    test('should skip tests when OPENCODE_SESSION is not set', () => {
      console.log('\nTo run real connection tests, set environment variable:')
      console.log('  export OPENCODE_SESSION="workspaceId:sessionCookie"')
      console.log('\nGet the values from opencode.ai/console:')
      console.log('  1. Open DevTools (F12) → Application → Cookies')
      console.log('  2. Copy the value of the "__Host-console_session" cookie')
      console.log('  3. Copy the workspace ID from the URL (wrk_...)')
      console.log('  4. Combine: export OPENCODE_SESSION="wrk_01...:st_..."')
      expect(true).toBe(true)
    })
  })
})
