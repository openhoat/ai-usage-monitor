import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ProviderCard } from './components/ProviderCard'
import { SettingsModal } from './components/SettingsModal'
import { setRefreshIntervalMs } from './main'
import { PROVIDERS } from './providers'
import type { StatusResponse } from './types'

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/status')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function refreshStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/refresh', { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function App() {
  const [refreshing, setRefreshing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
  })

  const hasSuccess = PROVIDERS.some(p => data?.providers[p.id]?.status === 'ok')
  const hasProviders = PROVIDERS.some(p => data?.providers[p.id] !== undefined)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshStatus()
      await refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const onSaved = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/config')
      if (res.ok) {
        const data = (await res.json()) as { refresh_interval_minutes?: number }
        if (typeof data.refresh_interval_minutes === 'number') {
          setRefreshIntervalMs(data.refresh_interval_minutes)
        }
      }
      await refreshStatus()
      await refetch()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                !hasProviders ? 'bg-muted-foreground' : hasSuccess ? 'bg-success' : 'bg-destructive'
              }`}
              data-testid="global-dot"
            />
            <h1 className="text-lg font-semibold">AI Usage Monitor</h1>
          </div>
          <div className="flex items-center gap-3">
            {data?.last_refresh && (
              <span className="text-xs text-muted-foreground">
                Updated {formatTime(data.last_refresh)}
              </span>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {isLoading && <p className="text-center text-muted-foreground">Loading…</p>}

        {isError && (
          <p className="text-center text-destructive">
            Failed to load data: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        )}

        {!isLoading && !isError && !hasProviders && (
          <p className="text-center text-muted-foreground">
            No providers configured. Set credentials via environment variables.
          </p>
        )}

        {!isLoading && !isError && hasProviders && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROVIDERS.map(
              ({ id, label }) =>
                data!.providers[id] && (
                  <ProviderCard key={id} name={label} result={data!.providers[id]} />
                )
            )}
          </div>
        )}
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={onSaved} />
    </div>
  )
}
