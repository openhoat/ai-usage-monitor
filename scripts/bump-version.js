#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PACKAGE_JSON_PATH = resolve(process.cwd(), 'package.json')

/**
 * Parse semantic version string
 * @param {string} version - Version string (e.g., "1.2.3")
 * @returns {{ major: number, minor: number, patch: number }}
 */
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    throw new Error(`Invalid version format: ${version}`)
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }
}

/**
 * Bump version based on release type
 * @param {{ major: number, minor: number, patch: number }} version
 * @param {'major' | 'minor' | 'patch'} type
 * @returns {{ major: number, minor: number, patch: number }}
 */
function bumpVersion(version, type) {
  const { major, minor, patch } = version

  switch (type) {
    case 'major':
      return { major: major + 1, minor: 0, patch: 0 }
    case 'minor':
      return { major, minor: minor + 1, patch: 0 }
    case 'patch':
      return { major, minor, patch: patch + 1 }
    default:
      throw new Error(`Invalid bump type: ${type}. Use 'major', 'minor', or 'patch'.`)
  }
}

/**
 * Format version object to string
 * @param {{ major: number, minor: number, patch: number }} version
 * @returns {string}
 */
function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`
}

/**
 * Update package.json with new version
 * @param {string} newVersion
 */
function updatePackageJson(newVersion) {
  const content = readFileSync(PACKAGE_JSON_PATH, 'utf-8')
  const pkg = JSON.parse(content)
  const oldVersion = pkg.version

  pkg.version = newVersion
  writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')

  // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
  console.log(`✓ Updated package.json: ${oldVersion} → ${newVersion}`)
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('Usage: node scripts/bump-version.js <major|minor|patch>')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('Examples:')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('  node scripts/bump-version.js patch  # 1.0.0 → 1.0.1')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('  node scripts/bump-version.js minor  # 1.0.0 → 1.1.0')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('  node scripts/bump-version.js major  # 1.0.0 → 2.0.0')
    process.exit(1)
  }

  const bumpType = args[0]

  if (!['major', 'minor', 'patch'].includes(bumpType)) {
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.error(`Error: Invalid bump type '${bumpType}'. Use 'major', 'minor', or 'patch'.`)
    process.exit(1)
  }

  try {
    // Read current version from package.json
    const pkgContent = readFileSync(PACKAGE_JSON_PATH, 'utf-8')
    const pkg = JSON.parse(pkgContent)
    const currentVersion = parseVersion(pkg.version)

    // Calculate new version
    const newVersion = bumpVersion(currentVersion, bumpType)
    const newVersionStr = formatVersion(newVersion)

    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log(`Bumping version: ${pkg.version} → ${newVersionStr}`)
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('')

    // Update files
    updatePackageJson(newVersionStr)

    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('✅ Version bump complete!')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('Next steps:')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log('  1. Review the changes')
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log(
      `  2. Commit: git add -A && git commit -m "chore: bump version to ${newVersionStr}"`
    )
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.log(`  3. Tag: git tag v${newVersionStr}`)
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: CLI script that needs to output to console
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }
}

main()
