import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../helpers/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
}))

import { fetchWithRetry } from '../helpers/fetch.js'
import { openaiProvider } from './openai.js'

const mockFetch = vi.mocked(fetchWithRetry)

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, body = ''): Response {
  return new Response(body, { status, statusText: 'Error' })
}

const singlePageCosts = {
  object: 'list',
  data: [
    {
      object: 'cost',
      amount: { value: 500, currency: 'usd' },
      line_item: 'gpt-4o',
      start_time: 0,
      end_time: 0,
    },
    {
      object: 'cost',
      amount: { value: 300, currency: 'usd' },
      line_item: 'gpt-4',
      start_time: 0,
      end_time: 0,
    },
  ],
  has_more: false,
}

const subscriptionWithLimit = {
  hard_limit_usd: 100,
  soft_limit_usd: 80,
}

describe('openaiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('successful usage fetch', () => {
    test('should return usage with budget limit', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(singlePageCosts))
        .mockResolvedValueOnce(jsonResponse(subscriptionWithLimit))

      const result = await openaiProvider.fetchUsage('sk-test-key')

      expect(result).not.toBeNull()
      expect(result?.status).toBe('ok')
      expect(result?.provider).toBe('openai')
      expect(result?.plan).toBe('api')
      expect(result?.tiers.length).toBeGreaterThan(0)
      // Total = 800 cents = $8, budget = $100, percentage = 8%
      expect(result?.overall_percentage).toBe(8)
      expect(result?.reset_date).toBeDefined()
      expect(result?.reset_in_hours).toBeGreaterThanOrEqual(0)
    })

    test('should return usage without budget limit', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(singlePageCosts))
        .mockResolvedValueOnce(jsonResponse({}))

      const result = await openaiProvider.fetchUsage('sk-test-key')

      expect(result).not.toBeNull()
      expect(result?.overall_percentage).toBe(0)
      expect(result?.tiers[0].name).toBe('Monthly Spend ($8.00)')
    })

    test('should include per-model breakdown', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(singlePageCosts))
        .mockResolvedValueOnce(jsonResponse(subscriptionWithLimit))

      const result = await openaiProvider.fetchUsage('sk-test-key')

      const modelTiers = result?.tiers.filter(t => t.name.includes('gpt'))
      expect(modelTiers?.length).toBe(2)
      expect(modelTiers?.[0].name).toContain('gpt-4o')
      expect(modelTiers?.[1].name).toContain('gpt-4')
    })
  })

  describe('pagination', () => {
    test('should handle paginated cost responses', async () => {
      const page1 = {
        object: 'list',
        data: [
          {
            object: 'cost',
            amount: { value: 200, currency: 'usd' },
            line_item: 'gpt-4o',
            start_time: 0,
            end_time: 0,
          },
        ],
        has_more: true,
        next_page: 'https://api.openai.com/v1/organization/costs?page=2',
      }
      const page2 = {
        object: 'list',
        data: [
          {
            object: 'cost',
            amount: { value: 100, currency: 'usd' },
            line_item: 'gpt-4',
            start_time: 0,
            end_time: 0,
          },
        ],
        has_more: false,
      }

      mockFetch
        .mockResolvedValueOnce(jsonResponse(page1))
        .mockResolvedValueOnce(jsonResponse(page2))
        .mockResolvedValueOnce(jsonResponse(subscriptionWithLimit))

      const result = await openaiProvider.fetchUsage('sk-test-key')

      expect(result).not.toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(3)
      // Total = 300 cents = $3, budget = $100, percentage = 3%
      expect(result?.overall_percentage).toBe(3)
    })

    test('should use cursor parameter for pagination', async () => {
      const page1 = {
        object: 'list',
        data: [],
        has_more: true,
        next_page: 'page_abc123',
      }
      const page2 = {
        object: 'list',
        data: [],
        has_more: false,
      }

      mockFetch
        .mockResolvedValueOnce(jsonResponse(page1))
        .mockResolvedValueOnce(jsonResponse(page2))
        .mockResolvedValueOnce(jsonResponse(subscriptionWithLimit))

      await openaiProvider.fetchUsage('sk-test-key')

      // First call is the initial URL, second call should include page=cursor
      const secondUrl = mockFetch.mock.calls[1][0] as string
      expect(secondUrl).toContain('page=page_abc123')
    })
  })

  describe('error handling', () => {
    test('should return error when costs API returns error', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'))

      const result = await openaiProvider.fetchUsage('sk-bad-key')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('auth_expired')
      }
    })

    test('should return error when costs API fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await openaiProvider.fetchUsage('sk-test-key')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('auth_expired')
      }
    })

    test('should still return usage when subscription API fails', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(singlePageCosts))
        .mockResolvedValueOnce(errorResponse(500, 'Internal error'))

      const result = await openaiProvider.fetchUsage('sk-test-key')

      expect(result).not.toBeNull()
      expect(result?.overall_percentage).toBe(0)
    })

    test('should still return usage when subscription API throws', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(singlePageCosts))
        .mockRejectedValueOnce(new Error('Timeout'))

      const result = await openaiProvider.fetchUsage('sk-test-key')

      expect(result).not.toBeNull()
      expect(result?.overall_percentage).toBe(0)
    })
  })

  describe('headers', () => {
    test('should send correct authorization header', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(singlePageCosts))
        .mockResolvedValueOnce(jsonResponse(subscriptionWithLimit))

      await openaiProvider.fetchUsage('sk-my-api-key')

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit
      const headers = callOptions.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk-my-api-key')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })
})
