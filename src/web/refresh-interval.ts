const DEFAULT_REFRESH_INTERVAL_MINUTES = 5

let refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MINUTES * 60 * 1000

/**
 * Current dashboard refresh interval in milliseconds. Kept in its own module so
 * both the query client (main.tsx) and the settings flow (App.tsx) can share it
 * without importing each other (which would create an import cycle).
 */
export function getRefreshIntervalMs(): number {
  return refreshIntervalMs
}

export function setRefreshIntervalMs(minutes: number): void {
  if (minutes >= 1) {
    refreshIntervalMs = minutes * 60 * 1000
  }
}
