import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../helpers/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
}))

import { fetchWithRetry } from '../helpers/fetch.js'
import { openrouterProvider } from './openrouter.js'

const mockFetch = vi.mocked(fetchWithRetry)

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const sampleKey = {
  data: {
    label: 'sk-or-v1-test',
    limit: 100,
    limit_remaining: 87.5,
    usage: 12.5,
    usage_monthly: 12.5,
    is_free_tier: false,
    expires_at: null,
  },
}

describe('openrouterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('should return usage with percentage when a limit is set', async () => {
    mockFetch.mockResolvedValue(jsonResponse(sampleKey))

    const result = await openrouterProvider.fetchUsage('sk-or-v1-test')

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.provider).toBe('openrouter')
      expect(result.plan).toBe('api')
      expect(result.tiers[0].name).toContain('$12.50/$100')
      expect(result.tiers[0].percentage).toBe(12.5)
      expect(result.overall_percentage).toBe(12.5)
    }
  })

  test('should show spend without percentage when no limit is set', async () => {
    const noLimit = {
      data: { ...sampleKey.data, limit: null, limit_remaining: null },
    }
    mockFetch.mockResolvedValue(jsonResponse(noLimit))

    const result = await openrouterProvider.fetchUsage('sk-or-v1-test')

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.tiers[0].name).toContain('$12.50')
      expect(result.tiers[0].percentage).toBe(0)
      expect(result.overall_percentage).toBe(0)
    }
  })

  test('should return auth_expired on 401', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))

    const result = await openrouterProvider.fetchUsage('invalid-key')

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error_code).toBe('auth_expired')
    }
  })

  test('should return auth_expired on 403', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'forbidden' }, 403))

    const result = await openrouterProvider.fetchUsage('invalid-key')

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error_code).toBe('auth_expired')
    }
  })

  test('should return network_error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('DNS error'))

    const result = await openrouterProvider.fetchUsage('test-key')

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error_code).toBe('network_error')
    }
  })

  test('should send Authorization header with Bearer token', async () => {
    mockFetch.mockResolvedValue(jsonResponse(sampleKey))

    await openrouterProvider.fetchUsage('my-secret-key')

    const callOptions = mockFetch.mock.calls[0][1] as RequestInit
    const headers = callOptions.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer my-secret-key')
  })
})
