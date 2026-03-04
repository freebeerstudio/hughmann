import type { ModelAdapter } from '../../types/adapters.js'
import { ClaudeOAuthAdapter } from './claude-oauth.js'
import { OpenRouterAdapter } from './openrouter.js'

export interface AdapterFactoryResult {
  adapters: ModelAdapter[]
  warnings: string[]
}

/**
 * Creates model adapters based on available configuration and environment.
 */
export function createModelAdapters(): AdapterFactoryResult {
  const adapters: ModelAdapter[] = []
  const warnings: string[] = []

  // Claude OAuth adapter (via Max subscription)
  const claude = new ClaudeOAuthAdapter()
  if (claude.isAvailable()) {
    adapters.push(claude)
  } else {
    warnings.push('Claude OAuth not available (@anthropic-ai/claude-agent-sdk not installed)')
  }

  // OpenRouter adapter
  const openrouter = new OpenRouterAdapter()
  if (openrouter.isAvailable()) {
    adapters.push(openrouter)
  } else {
    warnings.push('OpenRouter not available (OPENROUTER_API_KEY not set)')
  }

  return { adapters, warnings }
}
