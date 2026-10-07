import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { getRefreshIntervalMs, setRefreshIntervalMs } from './refresh-interval'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: () => getRefreshIntervalMs(),
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
})

async function loadRefreshInterval(): Promise<void> {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) return
    const data = (await res.json()) as { refresh_interval_minutes?: number }
    const minutes = data.refresh_interval_minutes
    if (typeof minutes === 'number' && minutes >= 1) {
      setRefreshIntervalMs(minutes)
    }
  } catch {
    // Keep default interval on failure
  }
}

void loadRefreshInterval()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
