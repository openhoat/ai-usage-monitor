import { useEffect, useState } from 'react'
import { PROVIDERS } from '../providers'

interface ConfigResponse {
  providers: Record<string, { value: string; isDefault: boolean }>
  refresh_interval_minutes?: number
}

export function SettingsModal({
  open,
  onClose,
  onSaved,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [refreshInterval, setRefreshInterval] = useState<number>(5)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/config')
      .then(r => r.json() as Promise<ConfigResponse>)
      .then(data => {
        const initial: Record<string, string> = {}
        for (const field of PROVIDERS) {
          initial[field.configKey] = data.providers[field.id]?.value || ''
        }
        setValues(initial)
        setRefreshInterval(data.refresh_interval_minutes || 5)
      })
      .catch(() => setToast('Failed to load config'))
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { refresh_interval_minutes: refreshInterval }
      for (const field of PROVIDERS) {
        if (values[field.configKey]) {
          body[field.configKey] = values[field.configKey]
        }
      }
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { success: boolean; message: string }
      if (data.success) {
        setToast('Configuration saved')
        onSaved()
        setTimeout(() => {
          onClose()
          setToast(null)
        }, 1000)
      } else {
        setToast(data.message || 'Failed to save')
      }
    } catch {
      setToast('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <>
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
        <div className="mx-4 w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-xl">
          <h2 className="mb-5 text-lg font-semibold">Settings</h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="refresh-interval"
                className="mb-1 block text-sm font-medium text-muted-foreground"
              >
                Refresh interval (minutes)
              </label>
              <input
                id="refresh-interval"
                type="number"
                min={1}
                value={refreshInterval}
                onChange={e =>
                  setRefreshInterval(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
                }
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-refresh of the dashboard and usage cache TTL.
              </p>
            </div>

            <div className="border-t border-border pt-4">
              {PROVIDERS.map(field => (
                <div key={field.id} className="mb-4">
                  <label
                    htmlFor={field.id}
                    className="mb-1 block text-sm font-medium text-muted-foreground"
                  >
                    {field.label}
                  </label>
                  <input
                    id={field.id}
                    type="text"
                    value={values[field.configKey] || ''}
                    onChange={e => setValues(v => ({ ...v, [field.configKey]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    autoComplete="off"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
