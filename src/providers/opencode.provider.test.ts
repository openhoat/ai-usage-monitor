import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../helpers/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
}))

import { fetchWithRetry } from '../helpers/fetch.js'
import { opencodeProvider } from './opencode.js'

const mockFetch = vi.mocked(fetchWithRetry)

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, statusText: 'Error' })
}

const billing = { mode: 'pay-as-you-go', balanceMicroCents: '-24442290' }
const usage24h = { totalCostMicroCents: '46371079' }
const usage30d = { totalCostMicroCents: '846819868' }
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

/** Queue the four calls of a fully successful usage fetch (orgId already known). */
function mockSuccessSequence(): void {
  mockFetch
    .mockResolvedValueOnce(jsonResponse(billing))
    .mockResolvedValueOnce(jsonResponse(usage24h))
    .mockResolvedValueOnce(jsonResponse(usage30d))
    .mockResolvedValueOnce(jsonResponse(goStatus))
}

function headersOfCall(index: number): Record<string, string> {
  return (mockFetch.mock.calls[index][1] as RequestInit).headers as Record<string, string>
}

describe('opencodeProvider (network)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('builds balance, spend and Go tiers (orgId in credential)', async () => {
    mockSuccessSequence()

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.provider).toBe('opencode')
      expect(result.plan).toBe('pay-as-you-go')
      expect(result.tiers.map(t => t.name)).toEqual([
        'Balance -$0.24',
        'Spend 24h $0.46',
        'Spend 30d $8.47',
        'Go 5h $0.64 / $12.00',
        'Go week $10.46 / $30.00',
        'Go month $22.55 / $60.00',
      ])
    }
  })

  test('resolves the orgId from /orgs when the credential has none', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([{ id: 'wrk_resolved' }]))
      .mockResolvedValueOnce(jsonResponse(billing))
      .mockResolvedValueOnce(jsonResponse(usage24h))
      .mockResolvedValueOnce(jsonResponse(usage30d))
      .mockResolvedValueOnce(jsonResponse(goStatus))

    const result = await opencodeProvider.fetchUsage('st_only_cookie')

    expect(result.status).toBe('ok')
    expect(mockFetch.mock.calls[0][0]).toContain('/orgs')
    expect(headersOfCall(1)['x-org-id']).toBe('wrk_resolved')
  })

  test('treats a missing Go plan (404) as no extra tiers', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(billing))
      .mockResolvedValueOnce(jsonResponse(usage24h))
      .mockResolvedValueOnce(jsonResponse(usage30d))
      .mockResolvedValueOnce(jsonResponse({}, 404))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.tiers.some(t => t.name.startsWith('Go '))).toBe(false)
    }
  })

  test('falls back to "No usage data" when nothing is available', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}, 404))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.tiers).toEqual([{ name: 'No usage data', percentage: 0 }])
    }
  })

  test('sends the session cookie, user agent and org headers', async () => {
    mockSuccessSequence()

    await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    const headers = headersOfCall(0)
    expect(headers.Cookie).toBe('__Host-console_session=st_123')
    expect(headers.Accept).toBe('application/json')
    expect(headers['x-org-id']).toBe('wrk_01ABC')
  })

  test('returns auth_expired for an invalid credential format', async () => {
    const result = await opencodeProvider.fetchUsage('   ')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('auth_expired')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('returns auth_expired when no workspace is found', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]))

    const result = await opencodeProvider.fetchUsage('st_only_cookie')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('auth_expired')
  })

  test('returns auth_expired on 401 from the billing API', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 401))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('auth_expired')
  })

  test('returns network_error on an unexpected HTTP status', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('network_error')
  })

  test('returns network_error on an invalid JSON body', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('not json'))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('network_error')
  })

  test('returns auth_expired when the API returns an OrgRequired tag', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ _tag: 'OrgRequired' }))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error_code).toBe('auth_expired')
      expect(result.message).toContain('OrgRequired')
    }
  })

  test('returns network_error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('DNS error'))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('network_error')
  })

  test('returns timeout when fetch aborts', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('timeout')
  })

  test('propagates an error from the 24h usage call', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(billing))
      .mockResolvedValueOnce(jsonResponse({}, 401))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('auth_expired')
  })

  test('propagates an error from the 30d usage call', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(billing))
      .mockResolvedValueOnce(jsonResponse(usage24h))
      .mockResolvedValueOnce(jsonResponse({}, 401))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
  })

  test('propagates an error from the Go status call', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(billing))
      .mockResolvedValueOnce(jsonResponse(usage24h))
      .mockResolvedValueOnce(jsonResponse(usage30d))
      .mockResolvedValueOnce(jsonResponse({}, 500))

    const result = await opencodeProvider.fetchUsage('wrk_01ABC:st_123')

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error_code).toBe('network_error')
  })
})
