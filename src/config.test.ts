import { afterEach, describe, expect, test } from 'vitest'
import { clearUserAgentCache, getUserAgent } from './config.js'

describe('config', () => {
  afterEach(() => {
    clearUserAgentCache()
  })

  test('should return a user agent with name and version', () => {
    const userAgent = getUserAgent()

    // Match either full package name or short name
    expect(userAgent).toMatch(/^ai-usage-monitor\/\d+\.\d+\.\d+/)
  })

  test('should include platform and architecture', () => {
    const userAgent = getUserAgent()

    expect(userAgent).toContain(process.platform)
    expect(userAgent).toContain(process.arch)
  })

  test('should cache the user agent', () => {
    const userAgent1 = getUserAgent()
    const userAgent2 = getUserAgent()

    expect(userAgent1).toBe(userAgent2)
  })

  test('should clear cache and regenerate user agent', () => {
    const userAgent1 = getUserAgent()
    clearUserAgentCache()
    const userAgent2 = getUserAgent()

    expect(userAgent1).toBe(userAgent2) // Same value, but regenerated
  })

  test('should format user agent correctly', () => {
    const userAgent = getUserAgent()
    const expectedPattern = /^[\w-]+\/[\d.]+\s+\([\w]+;\s*[\w]+\)$/

    expect(userAgent).toMatch(expectedPattern)
  })
})
