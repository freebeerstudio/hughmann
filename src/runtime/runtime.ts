import type { ContextStore, DomainContext } from '../types/context.js'
import type { ModelStreamChunk } from '../types/model.js'
import { ModelRouter } from './model-router.js'
import { buildSystemPrompt } from './system-prompt-builder.js'
import { reloadContext } from './context-loader.js'
import { SessionManager } from './session.js'
import type { SessionSummary } from './session.js'
import { ContextWriter } from './context-writer.js'

/**
 * The central runtime orchestrator. Holds state, handles turns, manages domain switching.
 */
export class Runtime {
  context: ContextStore
  router: ModelRouter
  sessions: SessionManager
  writer: ContextWriter
  activeDomain: string | null = null

  private contextDir: string

  constructor(context: ContextStore, router: ModelRouter, contextDir: string, sessions: SessionManager) {
    this.context = context
    this.router = router
    this.contextDir = contextDir
    this.sessions = sessions
    this.writer = new ContextWriter(contextDir)
  }

  setDomain(slug: string | null): void {
    if (slug === null) {
      this.activeDomain = null
      this.sessions.setDomain(null)
      return
    }
    if (!this.context.domains.has(slug)) {
      // Try to find by partial match
      const match = Array.from(this.context.domains.keys()).find(k =>
        k.includes(slug) || slug.includes(k)
      )
      if (match) {
        this.activeDomain = match
        this.sessions.setDomain(match)
      } else {
        throw new Error(`Unknown domain: ${slug}. Use /domains to see available domains.`)
      }
    } else {
      this.activeDomain = slug
      this.sessions.setDomain(slug)
    }
  }

  async chat(userMessage: string): Promise<string> {
    const session = this.sessions.getOrCreate(this.activeDomain)
    const contextMessages = [
      ...this.sessions.getContextMessages(),
      { role: 'user' as const, content: userMessage },
    ]

    const systemPrompt = buildSystemPrompt(this.context, {
      activeDomain: this.activeDomain ?? undefined,
      includeMasterPlan: true,
      includeGrowth: false,
    })

    const response = await this.router.route({
      messages: contextMessages,
      complexity: 'conversational',
    }, systemPrompt)

    this.sessions.addTurn(userMessage, response.content)

    return response.content
  }

  async *chatStream(userMessage: string): AsyncIterable<ModelStreamChunk> {
    const session = this.sessions.getOrCreate(this.activeDomain)
    const contextMessages = [
      ...this.sessions.getContextMessages(),
      { role: 'user' as const, content: userMessage },
    ]

    const systemPrompt = buildSystemPrompt(this.context, {
      activeDomain: this.activeDomain ?? undefined,
      includeMasterPlan: true,
      includeGrowth: false,
    })

    let fullResponse = ''

    for await (const chunk of this.router.routeStream({
      messages: contextMessages,
      complexity: 'conversational',
    }, systemPrompt)) {
      if (chunk.type === 'text') {
        fullResponse += chunk.content
      }
      yield chunk
    }

    this.sessions.addTurn(userMessage, fullResponse)
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

  /** Clear history and start a fresh session */
  clearHistory(): void {
    this.sessions.newSession(this.activeDomain)
  }

  /** Resume a specific session by ID */
  resumeSession(id: string): boolean {
    const session = this.sessions.load(id)
    if (!session) return false
    this.activeDomain = session.domain
    return true
  }

  /** Resume the most recent session */
  resumeLatest(): boolean {
    const session = this.sessions.loadLatest()
    if (!session) return false
    this.activeDomain = session.domain
    return true
  }

  /** List past sessions */
  listSessions(): SessionSummary[] {
    return this.sessions.list()
  }

  /** Get current session info */
  getSessionInfo(): { id: string; title: string; messageCount: number } | null {
    const current = this.sessions.getCurrent()
    if (!current) return null
    return {
      id: current.id,
      title: current.title,
      messageCount: current.messages.length,
    }
  }
}
