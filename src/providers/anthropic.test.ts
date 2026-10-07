import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../helpers/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
}))

import { fetchWithRetry } from '../helpers/fetch.js'
import { anthropicProvider } from './anthropic.js'

const mockFetch = vi.mocked(fetchWithRetry)

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const sampleModelsResponse = {
  data: [
    { id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4' },
  ],
  has_more: false,
}

const sampleOrgsResponse = {
  data: [
    {
      id: 'org-123',
      name: 'Test Org',
      type: 'individual',
      billing: { monthly_spend: 10.5, monthly_spend_limit: 100 },
    },
  ],
  has_more: false,
}

describe('anthropicProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('successful key validation', () => {
    test('should return ok status when API key is valid (models fallback)', async () => {
      // First call: organizations API returns 404 (no admin access)
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'not_found_error' } }, 404)
      )
      // Second call: models API succeeds
      mockFetch.mockResolvedValueOnce(jsonResponse(sampleModelsResponse))

      const result = await anthropicProvider.fetchUsage('sk-ant-test-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.provider).toBe('anthropic')
        expect(result.plan).toBe('api')
        expect(result.overall_percentage).toBe(0)
        expect(result.reset_date).not.toBeNull()
        expect(result.reset_in_hours).not.toBeNull()
      }
    })

    test('should include model count in tier name (models fallback)', async () => {
      // Organizations API fails
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'not_found_error' } }, 404)
      )
      // Models API succeeds
      mockFetch.mockResolvedValueOnce(jsonResponse(sampleModelsResponse))

      const result = await anthropicProvider.fetchUsage('sk-ant-test-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.tiers).toHaveLength(1)
        expect(result.tiers[0].name).toContain('3 models')
        expect(result.tiers[0].percentage).toBe(0)
      }
    })

    test('should handle empty models list gracefully', async () => {
      // Organizations API fails
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'not_found_error' } }, 404)
      )
      // Models API returns empty list
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }))

      const result = await anthropicProvider.fetchUsage('sk-ant-test-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.tiers[0].name).toContain('0 models')
      }
    })

    test('should set reset_in_hours to end of current month', async () => {
      // Organizations API fails
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'not_found_error' } }, 404)
      )
      // Models API succeeds
      mockFetch.mockResolvedValueOnce(jsonResponse(sampleModelsResponse))

      const result = await anthropicProvider.fetchUsage('sk-ant-test-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.reset_in_hours).toBeGreaterThan(0)
        expect(result.reset_in_hours).toBeLessThanOrEqual(31 * 24)
      }
    })

    test('should return billing data when admin API is accessible', async () => {
      // Organizations API succeeds with billing info
      mockFetch.mockResolvedValueOnce(jsonResponse(sampleOrgsResponse))

      const result = await anthropicProvider.fetchUsage('sk-ant-admin-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.provider).toBe('anthropic')
        expect(result.tiers.length).toBeGreaterThanOrEqual(1)
        expect(result.tiers[0].name).toContain('$')
      }
    })

    test('adds per-model tiers from the usage API when billing is present', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ id: 'org-1', billing: { monthly_spend: 20, monthly_spend_limit: 100 } }],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              { model: 'claude-sonnet-4-6', input_tokens: 2_000_000, output_tokens: 1_000_000 },
              { model: 'claude-opus-4-7', input_tokens: 1_000_000, output_tokens: 500_000 },
            ],
          })
        )

      const result = await anthropicProvider.fetchUsage('sk-ant-admin-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.tiers[0].name).toContain('$20.00')
        expect(result.tiers.some(t => t.name.includes('claude-sonnet-4-6'))).toBe(true)
        expect(result.tiers.some(t => t.name.includes('claude-opus-4-7'))).toBe(true)
      }
    })

    test('shows monthly spend when no budget limit is set', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ data: [{ id: 'org-1', billing: { monthly_spend: 12 } }] })
        )
        .mockResolvedValueOnce(jsonResponse({ data: [] }))

      const result = await anthropicProvider.fetchUsage('sk-ant-admin-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.tiers[0]).toEqual({ name: 'Monthly Spend ($12.00)', percentage: 0 })
        expect(result.overall_percentage).toBe(0)
      }
    })

    test('computes spend from the usage API when the org has no billing', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'org-1' }] }))
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              { model: 'claude-sonnet-4-6', input_tokens: 1_000_000, output_tokens: 1_000_000 },
              { model: 'claude-haiku', input_tokens: 500_000, output_tokens: 500_000 },
            ],
          })
        )

      const result = await anthropicProvider.fetchUsage('sk-ant-admin-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.tiers[0].name).toContain('Monthly Spend')
        expect(result.overall_percentage).toBe(0)
        expect(result.tiers.some(t => t.name.includes('claude-sonnet-4-6'))).toBe(true)
      }
    })

    test('falls back to models validation when the org has no billing or usage', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'org-1' }] }))
        .mockResolvedValueOnce(jsonResponse({ data: [] }))
        .mockResolvedValueOnce(jsonResponse(sampleModelsResponse))

      const result = await anthropicProvider.fetchUsage('sk-ant-key')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.tiers[0].name).toContain('models')
      }
    })

    test('falls back to models validation when no organizations are returned', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ data: [] }))
        .mockResolvedValueOnce(jsonResponse(sampleModelsResponse))

      const result = await anthropicProvider.fetchUsage('sk-ant-key')

      expect(result.status).toBe('ok')
    })
  })

  describe('error handling', () => {
    test('should return auth_expired error when models API returns 401', async () => {
      // Organizations API fails with 401
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'authentication_error' } }, 401)
      )
      // Models API also returns 401
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'authentication_error' } }, 401)
      )

      const result = await anthropicProvider.fetchUsage('invalid-key')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('auth_expired')
        expect(result.message).toContain('invalid')
      }
    })

    test('should return auth_expired error when models API returns 403', async () => {
      // Organizations API returns 403
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'permission_error' } }, 403)
      )
      // Models API also returns 401 (auth expired)
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'authentication_error' } }, 401)
      )

      const result = await anthropicProvider.fetchUsage('invalid-key')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('auth_expired')
      }
    })

    test('should return network_error when fetch throws', async () => {
      // Organizations API throws
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))
      // Models API also throws
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await anthropicProvider.fetchUsage('sk-ant-test-key')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('network_error')
        expect(result.message).toContain('Network error')
      }
    })

    test('should return timeout error when AbortError is thrown', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      // Both APIs throw AbortError
      mockFetch.mockRejectedValueOnce(abortError)
      mockFetch.mockRejectedValueOnce(abortError)

      const result = await anthropicProvider.fetchUsage('sk-ant-test-key')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('timeout')
        expect(result.message).toContain('timed out')
      }
    })
  })

  describe('headers', () => {
    test('should send correct authentication headers', async () => {
      // Organizations API fails
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'not_found_error' } }, 404)
      )
      // Models API succeeds
      mockFetch.mockResolvedValueOnce(jsonResponse(sampleModelsResponse))

      await anthropicProvider.fetchUsage('my-api-key')

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit
      const headers = callOptions.headers as Record<string, string>
      expect(headers['x-api-key']).toBe('my-api-key')
      expect(headers['anthropic-version']).toBe('2023-06-01')
    })

    test('should call /v1/organizations first, then /v1/models', async () => {
      // Organizations API fails
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ type: 'error', error: { type: 'not_found_error' } }, 404)
      )
      // Models API succeeds
      mockFetch.mockResolvedValueOnce(jsonResponse(sampleModelsResponse))

      await anthropicProvider.fetchUsage('my-api-key')

      const firstUrl = mockFetch.mock.calls[0][0] as string
      const secondUrl = mockFetch.mock.calls[1][0] as string
      expect(firstUrl).toBe('https://api.anthropic.com/v1/organizations')
      expect(secondUrl).toBe('https://api.anthropic.com/v1/models')
    })
  })
})
