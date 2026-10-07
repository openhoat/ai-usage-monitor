import type { ReactNode } from 'react'
import type { ProviderResult } from '../types'

const ERROR_MESSAGES: Record<string, string> = {
  auth_expired: 'Credential expired or invalid',
  timeout: 'Request timed out',
  network_error: 'Network error',
  parse_error: 'Invalid response',
  unknown_provider: 'Unknown provider',
}

function formatResetTime(hours: number | null): string {
  if (hours === null || hours === undefined) return ''
  const days = Math.floor(hours / 24)
  const h = hours % 24
  if (days > 0) return `${days}d ${h}h`
  return `${h}h`
}

function levelClass(percentage: number): string {
  if (percentage > 80) return 'bg-destructive'
  if (percentage >= 50) return 'bg-amber-500'
  return 'bg-primary'
}

function TIcon({
  children,
  className,
  label,
}: {
  children: ReactNode
  className: string
  label: string
}) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 cursor-help ${className}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {children}
    </svg>
  )
}

function ClockIcon({ label }: { label: string }) {
  return (
    <TIcon className="text-sky-400" label={label}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2 2" />
    </TIcon>
  )
}

function WalletIcon({ label }: { label: string }) {
  return (
    <TIcon className="text-emerald-400" label={label}>
      <rect x="1" y="4" width="14" height="9" rx="1.5" />
      <circle cx="10.5" cy="8.5" r="1.5" />
      <path d="M1 6.5h3" />
    </TIcon>
  )
}

function CreditCardIcon({ label }: { label: string }) {
  return (
    <TIcon className="text-amber-400" label={label}>
      <rect x="1" y="3.5" width="14" height="9" rx="1.5" />
      <path d="M1 6h14" />
      <path d="M5 9h2" />
    </TIcon>
  )
}

function GaugeIcon({ label }: { label: string }) {
  return (
    <TIcon className="text-violet-400" label={label}>
      <path d="M2 10a6 6 0 0 1 12 0" />
      <path d="M8 7v2" />
      <circle cx="8" cy="10" r=".5" />
    </TIcon>
  )
}

function KeyIcon({ label }: { label: string }) {
  return (
    <TIcon className="text-cyan-400" label={label}>
      <circle cx="5" cy="11" r="2.5" />
      <path d="m7 9 4.5-4.5" />
      <path d="M10 5.5 12 3.5" />
      <path d="M11 4.5 13 6.5" />
    </TIcon>
  )
}

function InfoIcon({ label }: { label: string }) {
  return (
    <TIcon className="text-muted-foreground" label={label}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v4" />
      <path d="M8 11.5v.5" />
    </TIcon>
  )
}

function getTierIcon(name: string): (props: { label: string }) => ReactNode {
  const lower = name.toLowerCase()

  if (lower.includes('balance')) return WalletIcon
  if (lower.includes('spend') || /monthly\s*\(?\$/.test(lower)) return CreditCardIcon
  if (lower.includes('limit')) return GaugeIcon
  if (/rolling|5h|7d|week|month|standard|extended|cowork|omelette/.test(lower)) return ClockIcon
  if (lower.includes('api key') || lower.includes('models')) return KeyIcon
  return InfoIcon
}

export function ProviderCard({ name, result }: { name: string; result: ProviderResult }) {
  const isOk = result.status === 'ok'

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span
          className={`inline-block h-3 w-3 rounded-full ${isOk ? 'bg-success' : 'bg-destructive'}`}
          data-testid={`dot-${name}`}
        />
        <span className="font-medium">{name}</span>
        {result.data?.plan && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {result.data.plan}
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        {!isOk ? (
          <p className="text-sm text-destructive">
            {ERROR_MESSAGES[result.error?.code || ''] || result.error?.message || 'Unknown error'}
          </p>
        ) : (
          <div className="space-y-3">
            {result.data?.tiers.map(tier => {
              const Icon = getTierIcon(tier.name)
              return (
                <div key={tier.name} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon label={tier.name} />
                    <span className="flex-1 truncate text-sm">{tier.name}</span>
                    <span className="shrink-0 text-sm font-semibold">
                      {Math.round(tier.percentage)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${levelClass(tier.percentage)}`}
                      style={{ width: `${Math.min(tier.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {result.data?.reset_in_hours !== null && result.data?.reset_in_hours !== undefined && (
              <p className="text-xs text-muted-foreground">
                Resets in {formatResetTime(result.data.reset_in_hours)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
