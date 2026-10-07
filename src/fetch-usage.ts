import { getAvailableProviders, getProvider } from './providers/index.js'
import type { ErrorResult } from './types.js'

async function main(): Promise<void> {
  const provider = process.argv[2]
  const credential = process.argv[3]

  if (!provider || !credential) {
    const result: ErrorResult = {
      status: 'error',
      error_code: 'missing_args',
      message: `Usage: node fetch-usage.js <provider> <credential>\nAvailable providers: ${getAvailableProviders().join(', ')}`,
    }
    console.log(JSON.stringify(result))
    process.exit(1)
  }

  const providerImpl = getProvider(provider)
  if (!providerImpl) {
    const result: ErrorResult = {
      status: 'error',
      error_code: 'unknown_provider',
      message: `Unknown provider: ${provider}. Available: ${getAvailableProviders().join(', ')}`,
    }
    console.log(JSON.stringify(result))
    process.exit(1)
  }

  const result = await providerImpl.fetchUsage(credential)
  console.log(JSON.stringify(result))
  if (result.status === 'error') {
    process.exit(1)
  }
}

await main()
