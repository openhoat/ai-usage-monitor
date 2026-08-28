import type { Provider } from '../types.js'
import { anthropicProvider } from './anthropic.js'
import { claudeProvider } from './claude.js'
import { geminiProvider } from './gemini.js'
import { ollamaProvider } from './ollama.js'
import { openaiProvider } from './openai.js'
import { opencodeGoProvider } from './opencode-go.js'
import { opencodeZenProvider } from './opencode-zen.js'
import { openrouterProvider } from './openrouter.js'

const providers: Map<string, Provider> = new Map()

function register(provider: Provider): void {
  providers.set(provider.name, provider)
}

export function getProvider(name: string): Provider | undefined {
  return providers.get(name)
}

export function getAvailableProviders(): string[] {
  return Array.from(providers.keys())
}

// Register built-in providers
register(anthropicProvider)
register(claudeProvider)
register(geminiProvider)
register(opencodeGoProvider)
register(opencodeZenProvider)
register(openrouterProvider)
register(ollamaProvider)
register(openaiProvider)
