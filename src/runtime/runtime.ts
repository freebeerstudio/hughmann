import type { ContextStore, DomainContext } from '../types/context.js'
import type { ModelMessage, ModelStreamChunk } from '../types/model.js'
import { ModelRouter } from './model-router.js'
import { buildSystemPrompt } from './system-prompt-builder.js'
import { reloadContext } from './context-loader.js'

/**
 * The central runtime orchestrator. Holds state, handles turns, manages domain switching.
 */
export class Runtime {
  context: ContextStore
  router: ModelRouter
  activeDomain: string | null = null

  private contextDir: string
  private conversationHistory: ModelMessage[] = []

  constructor(context: ContextStore, router: ModelRouter, contextDir: string) {
    this.context = context
    this.router = router
    this.contextDir = contextDir
  }

  setDomain(slug: string | null): void {
    if (slug === null) {
      this.activeDomain = null
      return
    }
    if (!this.context.domains.has(slug)) {
      // Try to find by partial match
      const match = Array.from(this.context.domains.keys()).find(k =>
        k.includes(slug) || slug.includes(k)
      )
      if (match) {
        this.activeDomain = match
      } else {
        throw new Error(`Unknown domain: ${slug}. Use /domains to see available domains.`)
      }
    } else {
      this.activeDomain = slug
    }
  }

  async chat(userMessage: string): Promise<string> {
    this.conversationHistory.push({ role: 'user', content: userMessage })

    const systemPrompt = buildSystemPrompt(this.context, {
      activeDomain: this.activeDomain ?? undefined,
      includeMasterPlan: true,
      includeGrowth: false,
    })

    const response = await this.router.route({
      messages: this.conversationHistory,
      complexity: 'conversational',
    }, systemPrompt)

    this.conversationHistory.push({ role: 'assistant', content: response.content })

    return response.content
  }

  async *chatStream(userMessage: string): AsyncIterable<ModelStreamChunk> {
    this.conversationHistory.push({ role: 'user', content: userMessage })

    const systemPrompt = buildSystemPrompt(this.context, {
      activeDomain: this.activeDomain ?? undefined,
      includeMasterPlan: true,
      includeGrowth: false,
    })

    let fullResponse = ''

    for await (const chunk of this.router.routeStream({
      messages: this.conversationHistory,
      complexity: 'conversational',
    }, systemPrompt)) {
      if (chunk.type === 'text') {
        fullResponse += chunk.content
      }
      yield chunk
    }

    this.conversationHistory.push({ role: 'assistant', content: fullResponse })
  }

  reloadContext(): { domainCount: number; docCount: number; warnings: string[] } {
    const { store, warnings } = reloadContext(this.contextDir)
    this.context = store

    // Re-validate active domain
    if (this.activeDomain && !this.context.domains.has(this.activeDomain)) {
      this.activeDomain = null
      warnings.push(`Active domain no longer exists after reload`)
    }

    return {
      domainCount: this.context.domains.size,
      docCount: 2 + (this.context.masterPlan ? 1 : 0) + (this.context.capabilities ? 1 : 0) + (this.context.growth ? 1 : 0) + this.context.domains.size,
      warnings,
    }
  }

  getAvailableDomains(): DomainContext[] {
    return Array.from(this.context.domains.values())
  }

  clearHistory(): void {
    this.conversationHistory = []
  }
}
