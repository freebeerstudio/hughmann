import type { ContextStore, DomainContext } from '../types/context.js'
import type { ModelStreamChunk, ToolOptions } from '../types/model.js'
import { ModelRouter } from './model-router.js'
import { buildSystemPrompt } from './system-prompt-builder.js'
import { reloadContext } from './context-loader.js'
import { SessionManager } from './session.js'
import type { SessionSummary } from './session.js'
import { ContextWriter } from './context-writer.js'
import { MemoryManager } from './memory.js'

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours
const DISTILL_INTERVAL = 10 // every 10 turns (5 user + 5 assistant)

/**
 * The central runtime orchestrator. Holds state, handles turns, manages domain switching.
 */
export class Runtime {
  context: ContextStore
  router: ModelRouter
  sessions: SessionManager
  writer: ContextWriter
  memory: MemoryManager
  activeDomain: string | null = null
  firstBoot = false

  private contextDir: string
  private turnsSinceDistill = 0

  constructor(
    context: ContextStore,
    router: ModelRouter,
    contextDir: string,
    sessions: SessionManager,
    memory: MemoryManager,
  ) {
    this.context = context
    this.router = router
    this.contextDir = contextDir
    this.sessions = sessions
    this.writer = new ContextWriter(contextDir)
    this.memory = memory
  }

  setDomain(slug: string | null): void {
    if (slug === null) {
      this.activeDomain = null
      this.sessions.setDomain(null)
      return
    }
    if (!this.context.domains.has(slug)) {
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
    this.sessions.getOrCreate(this.activeDomain)
    const contextMessages = [
      ...this.sessions.getContextMessages(),
      { role: 'user' as const, content: userMessage },
    ]

    const systemPrompt = this.buildPrompt()

    const response = await this.router.route({
      messages: contextMessages,
      complexity: 'conversational',
    }, systemPrompt)

    this.sessions.addTurn(userMessage, response.content)
    this.turnsSinceDistill += 2
    await this.maybePeriodicDistill()

    return response.content
  }

  async *chatStream(userMessage: string): AsyncIterable<ModelStreamChunk> {
    this.sessions.getOrCreate(this.activeDomain)
    const contextMessages = [
      ...this.sessions.getContextMessages(),
      { role: 'user' as const, content: userMessage },
    ]

    const systemPrompt = this.buildPrompt()

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
    this.turnsSinceDistill += 2
    await this.maybePeriodicDistill()
  }

  /**
   * Autonomous task execution with tool use.
   * Uses opus-tier model with Claude Code preset tools.
   * Streams progress (tool use, text, status) back to the caller.
   */
  async *doTaskStream(task: string, options?: { maxTurns?: number; cwd?: string }): AsyncIterable<ModelStreamChunk> {
    this.sessions.getOrCreate(this.activeDomain)

    // Include conversation context so the agent knows what's been discussed
    const contextMessages = [
      ...this.sessions.getContextMessages(),
      { role: 'user' as const, content: task },
    ]

    const systemPrompt = this.buildPrompt()

    let fullResponse = ''

    const toolOptions: Partial<ToolOptions> = {
      maxTurns: options?.maxTurns ?? 25,
      cwd: options?.cwd,
    }

    for await (const chunk of this.router.routeStream({
      messages: contextMessages,
      complexity: 'autonomous',
      toolUse: true,
      toolOptions,
    }, systemPrompt)) {
      if (chunk.type === 'text') {
        fullResponse += chunk.content
      }
      yield chunk
    }

    // Save the task and response to session history
    this.sessions.addTurn(`[Task] ${task}`, fullResponse || '[Task completed with tool use]')
    this.turnsSinceDistill += 2
    await this.maybePeriodicDistill()
  }

  /**
   * Smart session initialization for boot.
   * - If last session is < 2 hours old, resume it
   * - If last session is stale, distill it and start fresh
   * - If no sessions exist, start fresh
   *
   * Returns a description of what happened for the CLI to display.
   */
  async initSession(): Promise<{ action: 'resumed' | 'distilled' | 'new'; message: string }> {
    const sessions = this.sessions.list()

    if (sessions.length === 0) {
      this.sessions.create(this.activeDomain)
      return { action: 'new', message: 'New session started.' }
    }

    const latest = sessions[0]
    const age = Date.now() - new Date(latest.updatedAt).getTime()

    if (age < STALE_THRESHOLD_MS && latest.messageCount > 0) {
      // Recent session — resume
      this.sessions.load(latest.id)
      this.activeDomain = this.sessions.getCurrent()?.domain ?? null
      return {
        action: 'resumed',
        message: `Resumed: ${latest.title} (${latest.messageCount} messages)`,
      }
    }

    // Stale session — distill if not already done, then start fresh
    if (latest.messageCount > 0 && !this.memory.isDistilled(latest.id)) {
      const session = this.sessions.load(latest.id)
      if (session) {
        const result = await this.memory.distill(session)
        if (result) {
          this.memory.markDistilled(latest.id)
        }
      }
      this.sessions.create(this.activeDomain)
      return {
        action: 'distilled',
        message: `Distilled previous session. New session started.`,
      }
    }

    this.sessions.create(this.activeDomain)
    return { action: 'new', message: 'New session started.' }
  }

  /** Distill the current session on demand */
  async distillCurrent(): Promise<string | null> {
    const session = this.sessions.getCurrent()
    if (!session || session.messages.length < 2) return null
    if (this.memory.isDistilled(session.id)) return null

    const result = await this.memory.distill(session)
    if (result) {
      this.memory.markDistilled(session.id)
      this.turnsSinceDistill = 0
    }
    return result
  }

  /** Periodic distillation every N turns */
  private async maybePeriodicDistill(): Promise<void> {
    if (this.turnsSinceDistill < DISTILL_INTERVAL) return
    await this.distillCurrent()
  }

  /** Build system prompt including recent memories */
  private buildPrompt(): string {
    const recentMemories = this.memory.getRecentMemories(3)

    let prompt = buildSystemPrompt(this.context, {
      activeDomain: this.activeDomain ?? undefined,
      includeMasterPlan: true,
      includeGrowth: false,
      firstBoot: this.firstBoot,
    })

    // Only use firstBoot for the first message
    if (this.firstBoot) {
      this.firstBoot = false
    }

    if (recentMemories) {
      prompt += '\n\n---\n\n## Recent Memory\n\n' +
        'Key facts and learnings from recent conversations:\n\n' +
        recentMemories
    }

    return prompt
  }

  reloadContext(): { domainCount: number; docCount: number; warnings: string[] } {
    const { store, warnings } = reloadContext(this.contextDir)
    this.context = store

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

  /** Distill current session and start fresh */
  async clearAndDistill(): Promise<string | null> {
    const result = await this.distillCurrent()
    this.sessions.newSession(this.activeDomain)
    this.turnsSinceDistill = 0
    return result
  }

  /** Clear history without distilling */
  clearHistory(): void {
    this.sessions.newSession(this.activeDomain)
    this.turnsSinceDistill = 0
  }

  resumeSession(id: string): boolean {
    const session = this.sessions.load(id)
    if (!session) return false
    this.activeDomain = session.domain
    this.turnsSinceDistill = 0
    return true
  }

  resumeLatest(): boolean {
    const session = this.sessions.loadLatest()
    if (!session) return false
    this.activeDomain = session.domain
    return true
  }

  listSessions(): SessionSummary[] {
    return this.sessions.list()
  }

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
