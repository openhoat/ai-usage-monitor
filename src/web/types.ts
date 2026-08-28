export interface TierUsage {
  name: string
  percentage: number
}

export interface ProviderData {
  provider: string
  plan: string
  tiers: TierUsage[]
  overall_percentage: number
  reset_date: string | null
  reset_in_hours: number | null
}

export interface ProviderResult {
  status: 'ok' | 'error'
  data?: ProviderData
  error?: {
    code: string
    message: string
  }
}

export interface StatusResponse {
  providers: Record<string, ProviderResult>
  last_refresh: string | null
}
