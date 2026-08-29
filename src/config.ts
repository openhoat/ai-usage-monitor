import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let cachedUserAgent: string | null = null

function getPackageInfo(): { name: string; version: string } {
  try {
    // Try multiple possible locations for package.json
    const possiblePaths = [
      join(process.cwd(), 'package.json'),
      join(__dirname, '..', 'package.json'),
      join(__dirname, 'package.json'),
    ]

    for (const packageJsonPath of possiblePaths) {
      try {
        const content = readFileSync(packageJsonPath, 'utf-8')
        const pkg = JSON.parse(content) as { name?: string; version?: string }
        if (pkg.name && pkg.version) {
          return { name: pkg.name, version: pkg.version }
        }
      } catch {
        // Try next path
      }
    }
  } catch {
    // Fall through to defaults
  }

  return { name: 'ai-usage-monitor', version: '1.1.0' }
}

/**
 * Generates a dynamic User-Agent string based on package info and platform.
 * Format: {name}/{version} ({platform}; {arch})
 */
export function getUserAgent(): string {
  if (cachedUserAgent) {
    return cachedUserAgent
  }

  const { name, version } = getPackageInfo()
  const platform = process.platform
  const arch = process.arch

  cachedUserAgent = `${name}/${version} (${platform}; ${arch})`
  return cachedUserAgent
}

/**
 * Clears the cached User-Agent (useful for testing).
 */
export function clearUserAgentCache(): void {
  cachedUserAgent = null
}
