import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  getConfigForProviders: vi.fn(),
  getProvider: vi.fn(),
}))

vi.mock('./config-store.js', () => ({
  loadConfig: mocks.loadConfig,
  saveConfig: mocks.saveConfig,
  getConfigForProviders: mocks.getConfigForProviders,
}))

vi.mock('../providers/index.js', () => ({
  getProvider: mocks.getProvider,
}))

const baseConfig = {
  anthropic_api_key: '',
  claude_token: '',
  gemini_api_key: '',
  openai_api_key: '',
  ollama_session_cookie: '',
  opencode_session: '',
  openrouter_api_key: '',
  refresh_interval_minutes: 5,
}

const okResult = {
  status: 'ok' as const,
  provider: 'openai',
  plan: 'api',
  tiers: [{ name: 'Monthly', percentage: 10 }],
  overall_percentage: 10,
  reset_date: null,
  reset_in_hours: null,
}

/** Import a fresh api-handler module so its in-memory cache starts empty. */
async function loadHandler() {
  vi.resetModules()
  return import('./api-handler.js')
}

function configureOpenai(fetchUsage: ReturnType<typeof vi.fn>): void {
  mocks.getConfigForProviders.mockReturnValue([{ provider: 'openai', credential: 'k' }])
  mocks.getProvider.mockReturnValue({ fetchUsage })
}

describe('api-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadConfig.mockReturnValue({ ...baseConfig })
    mocks.getConfigForProviders.mockReturnValue([])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('handleGetConfig', () => {
    test('reports env-backed defaults', async () => {
      vi.stubEnv('OPENAIAPIKEY', 'env-key')
      const handler = await loadHandler()

      const config = handler.handleGetConfig()

      expect(config.providers.openai).toEqual({ value: '', isDefault: true })
      expect(config.providers.anthropic).toEqual({ value: '', isDefault: false })
      expect(config.refresh_interval_minutes).toBe(5)
    })

    test('returns stored values', async () => {
      mocks.loadConfig.mockReturnValue({
        ...baseConfig,
        openai_api_key: 'file-key',
        refresh_interval_minutes: 15,
      })
      const handler = await loadHandler()

      const config = handler.handleGetConfig()

      expect(config.providers.openai).toEqual({ value: 'file-key', isDefault: false })
      expect(config.refresh_interval_minutes).toBe(15)
    })
  })

  describe('handleSaveConfig', () => {
    test('merges fields, saves and updates the interval', async () => {
      const handler = await loadHandler()

      const result = handler.handleSaveConfig({
        ...baseConfig,
        openai_api_key: 'new-key',
        refresh_interval_minutes: 10,
      })

      expect(result).toEqual({ success: true, message: 'Configuration saved' })
      expect(mocks.saveConfig).toHaveBeenCalledTimes(1)
      expect(mocks.saveConfig.mock.calls[0][0]).toMatchObject({
        openai_api_key: 'new-key',
        refresh_interval_minutes: 10,
      })
      expect(handler.handleGetConfig().refresh_interval_minutes).toBe(10)
    })

    test('ignores empty fields and an invalid interval', async () => {
      const handler = await loadHandler()

      handler.handleSaveConfig({ ...baseConfig, openai_api_key: '', refresh_interval_minutes: 0 })

      expect(mocks.saveConfig.mock.calls[0][0]).toMatchObject({
        openai_api_key: '',
        refresh_interval_minutes: 5,
      })
    })
  })

  describe('refreshAll', () => {
    test('collects provider results', async () => {
      configureOpenai(vi.fn().mockResolvedValue(okResult))
      const handler = await loadHandler()

      const result = await handler.refreshAll()

      expect(result.providers.openai.status).toBe('ok')
      expect(result.providers.openai.data).toMatchObject({ provider: 'openai', plan: 'api' })
      expect(result.last_refresh).toEqual(expect.any(String))
    })

    test('reports unknown providers', async () => {
      mocks.getConfigForProviders.mockReturnValue([{ provider: 'ghost', credential: 'k' }])
      mocks.getProvider.mockReturnValue(undefined)
      const handler = await loadHandler()

      const result = await handler.refreshAll()

      expect(result.providers.ghost).toEqual({
        status: 'error',
        error: { code: 'unknown_provider', message: 'Unknown provider: ghost' },
      })
    })

    test('maps provider error results', async () => {
      configureOpenai(
        vi.fn().mockResolvedValue({
          status: 'error',
          error_code: 'auth_expired',
          message: 'nope',
        })
      )
      const handler = await loadHandler()

      const result = await handler.refreshAll()

      expect(result.providers.openai).toEqual({
        status: 'error',
        error: { code: 'auth_expired', message: 'nope' },
      })
    })

    test('maps thrown errors to network_error', async () => {
      configureOpenai(vi.fn().mockRejectedValue(new Error('boom')))
      const handler = await loadHandler()

      const result = await handler.refreshAll()

      expect(result.providers.openai).toEqual({
        status: 'error',
        error: { code: 'network_error', message: 'boom' },
      })
    })

    test('stringifies non-Error throws', async () => {
      configureOpenai(vi.fn().mockRejectedValue('bad'))
      const handler = await loadHandler()

      const result = await handler.refreshAll()

      expect(result.providers.openai.error).toEqual({ code: 'network_error', message: 'bad' })
    })

    test('waits for an in-progress refresh', async () => {
      vi.useFakeTimers()
      try {
        // Replaced synchronously below when fetchUsage is invoked.
        let resolveFetch: (value: unknown) => void = () => {
          /* noop until the promise is created */
        }
        const fetchUsage = vi.fn(
          () =>
            new Promise(resolve => {
              resolveFetch = resolve
            })
        )
        configureOpenai(fetchUsage)
        const handler = await loadHandler()

        const first = handler.refreshAll()
        const second = handler.refreshAll()

        resolveFetch(okResult)
        const a = await first
        await vi.advanceTimersByTimeAsync(100)
        const b = await second

        expect(a.providers.openai.status).toBe('ok')
        expect(b.providers.openai.status).toBe('ok')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('handleStatus', () => {
    test('serves the cached result within the interval', async () => {
      const fetchUsage = vi.fn().mockResolvedValue(okResult)
      configureOpenai(fetchUsage)
      const handler = await loadHandler()

      await handler.refreshAll()
      const result = await handler.handleStatus()

      expect(result.providers.openai.status).toBe('ok')
      expect(fetchUsage).toHaveBeenCalledTimes(1)
    })

    test('refreshes after the cache is cleared', async () => {
      const fetchUsage = vi.fn().mockResolvedValue(okResult)
      configureOpenai(fetchUsage)
      const handler = await loadHandler()

      await handler.refreshAll()
      handler.handleSaveConfig({ ...baseConfig })
      await handler.handleStatus()

      expect(fetchUsage).toHaveBeenCalledTimes(2)
    })
  })
})
