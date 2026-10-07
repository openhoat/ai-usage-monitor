import { describe, expect, test } from 'vitest'
import {
  buildGoTiers,
  buildTiers,
  formatUsd,
  microToUsd,
  parseCredential,
  planFromBilling,
} from './opencode.js'

// ---------------------------------------------------------------------------
// parseCredential
// ---------------------------------------------------------------------------

describe('parseCredential', () => {
  test.each([
    ['wrk_01ABC:st_123', 'wrk_01ABC', 'st_123'],
    ['wrk_01ABC:part1:part2:part3', 'wrk_01ABC', 'part1:part2:part3'],
    ['st_c19366f1-ba32', '', 'st_c19366f1-ba32'],
  ])('parses "%s" into orgId and sessionCookie', (input, orgId, sessionCookie) => {
    const result = parseCredential(input)
    expect(result?.orgId).toBe(orgId)
    expect(result?.sessionCookie).toBe(sessionCookie)
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
  test('converts a numeric string (micro-cents to USD)', () => {
    expect(microToUsd('-24442290')).toBeCloseTo(-0.2444229, 7)
    expect(microToUsd('10000000')).toBeCloseTo(0.1, 7)
  })

  test('converts a number', () => {
    expect(microToUsd(46371079)).toBeCloseTo(0.46371079, 7)
  })

  test('uses the micro-cents scale (1e9 micro-cents = $10)', () => {
    expect(microToUsd('1000000000')).toBe(10)
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
    expect(tiers.map(t => t.name)).toEqual(['Balance -$0.24', 'Spend 24h $0.46', 'Spend 30d $8.47'])
    expect(tiers.every(t => t.percentage === 0)).toBe(true)
  })

  test('skips absent values', () => {
    const tiers = buildTiers({}, { totalCostMicroCents: '10000000' }, {})
    expect(tiers).toHaveLength(1)
    expect(tiers[0].name).toBe('Spend 24h $0.10')
  })

  test('returns an empty list when nothing is available', () => {
    expect(buildTiers({}, {}, {})).toEqual([])
  })

  test('parses a positive balance as credit', () => {
    const tiers = buildTiers({ balanceMicroCents: '10000000' }, {}, {})
    expect(tiers[0].name).toBe('Balance $0.10')
  })
})

// ---------------------------------------------------------------------------
// buildGoTiers
// ---------------------------------------------------------------------------

describe('buildGoTiers', () => {
  const goStatus = {
    product: 'go',
    access: {
      meters: {
        fiveHour: { limitMicroCents: '1200000000', usedMicroCents: '63559740' },
        week: { limitMicroCents: '3000000000', usedMicroCents: '1045605625' },
        month: { limitMicroCents: '6000000000', usedMicroCents: '2254682620' },
      },
    },
  }

  test('builds the three Go meters with used/limit labels and percentages', () => {
    const tiers = buildGoTiers(goStatus)
    expect(tiers.map(t => t.name)).toEqual([
      'Go 5h $0.64 / $12.00',
      'Go week $10.46 / $30.00',
      'Go month $22.55 / $60.00',
    ])
    expect(tiers.map(t => t.percentage)).toEqual([5, 35, 38])
  })

  test('returns an empty list without a Go plan (null)', () => {
    expect(buildGoTiers(null)).toEqual([])
  })

  test('returns an empty list when meters are absent', () => {
    expect(buildGoTiers({ product: 'go' })).toEqual([])
    expect(buildGoTiers({ access: {} })).toEqual([])
  })

  test('skips a meter with a missing or zero limit', () => {
    const tiers = buildGoTiers({
      access: {
        meters: {
          fiveHour: { usedMicroCents: '10000000' },
          week: { limitMicroCents: '0', usedMicroCents: '10000000' },
          month: { limitMicroCents: '3000000000', usedMicroCents: '0' },
        },
      },
    })
    expect(tiers).toEqual([{ name: 'Go month $0.00 / $30.00', percentage: 0 }])
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
      expect(process.env.OPENCODE_SESSION).toBeUndefined()
    })
  })
})
