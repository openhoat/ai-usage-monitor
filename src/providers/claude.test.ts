import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../helpers/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
}))

import { fetchWithRetry } from '../helpers/fetch.js'
import { claudeProvider } from './claude.js'

const mockFetch = vi.mocked(fetchWithRetry)

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const sampleOrgs = [{ uuid: 'org-123', name: 'My Org', capabilities: ['claude_pro'] }]

const sampleRawUsage = {
  five_hour: { utilization: 45.5, resets_at: '2026-03-01T00:00:00Z' },
  seven_day: { utilization: 20.0, resets_at: '2026-03-01T00:00:00Z' },
}

describe('claudeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('API endpoint flow', () => {
    test('should return usage from API when both endpoints succeed', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(sampleOrgs))
        .mockResolvedValueOnce(jsonResponse(sampleRawUsage))

      const result = await claudeProvider.fetchUsage('test-token')

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.provider).toBe('claude')
        expect(result.plan).toBe('pro')
        expect(result.tiers).toHaveLength(2)
        expect(result.tiers[0].name).toBe('Standard (5h)')
        expect(result.tiers[0].percentage).toBe(45.5)
        expect(result.tiers[1].name).toBe('Extended (7d)')
        expect(result.tiers[1].percentage).toBe(20)
        expect(result.overall_percentage).toBe(45.5)
        expect(result.reset_date).toBe('2026-03-01T00:00:00Z')
      }
    })

    test('should select pro org from organizations list', async () => {
      const orgs = [
        { uuid: 'org-free', name: 'Free Org', capabilities: [] },
        { uuid: 'org-pro', name: 'Pro Org', capabilities: ['claude_pro'] },
      ]
      mockFetch
        .mockResolvedValueOnce(jsonResponse(orgs))
        .mockResolvedValueOnce(jsonResponse(sampleRawUsage))

      await claudeProvider.fetchUsage('test-token')

      expect(mockFetch).toHaveBeenCalledTimes(2)
      const usageUrl = mockFetch.mock.calls[1][0] as string
      expect(usageUrl).toContain('org-pro')
    })
  })

  describe('error handling', () => {
    test('should return auth_expired when organizations returns 401', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))

      const result = await claudeProvider.fetchUsage('invalid-token')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('auth_expired')
      }
    })

    test('should return auth_expired when organizations returns 403', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'forbidden' }, 403))

      const result = await claudeProvider.fetchUsage('invalid-token')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('auth_expired')
      }
    })

    test('should return network_error when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('DNS error'))

      const result = await claudeProvider.fetchUsage('test-token')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('network_error')
      }
    })

    test('should return timeout when AbortError is thrown', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      mockFetch.mockRejectedValue(abortError)

      const result = await claudeProvider.fetchUsage('test-token')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error_code).toBe('timeout')
      }
    })
  })

  describe('headers', () => {
    test('should send Cookie header with sessionKey and routingHint', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(sampleOrgs))
        .mockResolvedValueOnce(jsonResponse(sampleRawUsage))

      await claudeProvider.fetchUsage('sk-ant-sid01-abc:sk-ant-rh-xyz')

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit
      const headers = callOptions.headers as Record<string, string>
      expect(headers.Cookie).toBe('sessionKey=sk-ant-sid01-abc; routingHint=sk-ant-rh-xyz')
      expect(headers['User-Agent']).toBeDefined()
    })

    test('should send Cookie header with sessionKey only', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(sampleOrgs))
        .mockResolvedValueOnce(jsonResponse(sampleRawUsage))

      await claudeProvider.fetchUsage('sk-ant-sid01-abc')

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit
      const headers = callOptions.headers as Record<string, string>
      expect(headers.Cookie).toBe('sessionKey=sk-ant-sid01-abc')
    })
  })
})
