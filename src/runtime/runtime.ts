import type { ContextStore, DomainContext } from '../types/context.js'
import type { ModelStreamChunk, ToolOptions, McpServerConfig } from '../types/model.js'
import { ModelRouter } from './model-router.js'
import { buildSystemPrompt } from './system-prompt-builder.js'
import { reloadContext } from './context-loader.js'
import { SessionManager } from './session.js'
import type { SessionSummary } from './session.js'
import { ContextWriter } from './context-writer.js'
import { MemoryManager } from './memory.js'
import { SkillManager } from './skills.js'
import type { SupabaseAdapter } from '../adapters/data/supabase.js'
import type { UsageTracker } from './usage.js'
import { SubAgentManager } from './sub-agents.js'
import type { SubAgent, SubAgentResult } from './sub-agents.js'
import { ContextWatcher } from './watcher.js'

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
  mcpServers: Record<string, McpServerConfig>
  skills: SkillManager
  supabase?: SupabaseAdapter
  usage?: UsageTracker

  private contextDir: string
  private turnsSinceDistill = 0
  private watcher: ContextWatcher | null = null

  constructor(
    context: ContextStore,
    router: ModelRouter,
    contextDir: string,
    sessions: SessionManager,
    memory: MemoryManager,
    mcpServers?: Record<string, McpServerConfig>,
    skills?: SkillManager,
    supabase?: SupabaseAdapter,
    usage?: UsageTracker,
  ) {
    this.context = context
    this.router = router
    this.contextDir = contextDir
    this.sessions = sessions
    this.writer = new ContextWriter(contextDir)
    this.memory = memory
    this.mcpServers = mcpServers ?? {}
    this.skills = skills ?? new SkillManager(contextDir.replace('/context', ''))
    this.supabase = supabase
    this.usage = usage
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
    this.syncSessionToSupabase()

    // Track usage
    if (this.usage && response.usage) {
      this.usage.record({
        provider: response.provider,
        model: response.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        domain: this.activeDomain,
        source: 'chat',
      })
    }

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
      if (chunk.type === 'done' && this.usage && chunk.metadata?.costUsd) {
        this.usage.record({
          provider: 'claude-oauth',
          model: 'claude-sonnet-4-6',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: chunk.metadata.costUsd,
          domain: this.activeDomain,
          source: 'chat',
        })
      }
      yield chunk
    }

    this.sessions.addTurn(userMessage, fullResponse)
    this.turnsSinceDistill += 2
    await this.maybePeriodicDistill()
    this.syncSessionToSupabase()
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
      mcpServers: Object.keys(this.mcpServers).length > 0 ? this.mcpServers : undefined,
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
      if (chunk.type === 'done' && this.usage && chunk.metadata?.costUsd) {
        this.usage.record({
          provider: 'claude-oauth',
          model: 'claude-opus-4-6',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: chunk.metadata.costUsd,
          domain: this.activeDomain,
          source: 'task',
        })
      }
      yield chunk
    }

    // Save the task and response to session history
    this.sessions.addTurn(`[Task] ${task}`, fullResponse || '[Task completed with tool use]')
    this.turnsSinceDistill += 2
    await this.maybePeriodicDistill()
    this.syncSessionToSupabase()
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
      // Sync memory to Supabase (text)
      this.supabase?.saveMemory({
        sessionId: session.id,
        domain: session.domain,
        content: result,
        date: new Date().toISOString().split('T')[0],
      }).catch(() => {})
      // Generate and store embedding (vector)
      this.memory.embedAndStore(result, session.id, session.domain).catch(() => {})
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

  /**
   * Run multiple sub-agents in parallel for complex tasks.
   * Each agent gets its own model call with appropriate complexity tier.
   */
  async runSubAgents(agents: SubAgent[]): Promise<SubAgentResult[]> {
    const systemPrompt = this.buildPrompt()
    const manager = new SubAgentManager(this.router, systemPrompt, this.mcpServers)
    return manager.runParallel(agents)
  }

  /**
   * Decompose a complex task into sub-agents and run them in parallel.
   * Uses a planning call to break the task into independent pieces.
   */
  async *decomposeAndRun(task: string): AsyncIterable<ModelStreamChunk> {
    const systemPrompt = this.buildPrompt()
    const manager = new SubAgentManager(this.router, systemPrompt, this.mcpServers)

    // First: decompose the task
    yield { type: 'status', content: 'Analyzing task and planning sub-agents...' }
    const agents = await manager.decompose(task, systemPrompt)

    if (agents.length <= 1) {
      // Not worth decomposing — run as single task
      yield { type: 'status', content: 'Running as single task (not decomposable)' }
      yield* this.doTaskStream(task)
      return
    }

    // Run all sub-agents in parallel
    yield* manager.runParallelStream(agents)

    // Synthesize results
    const results = await manager.runParallel(agents)
    const synthesis = results
      .filter(r => r.success)
      .map(r => `## ${r.name}\n\n${r.content}`)
      .join('\n\n---\n\n')

    if (synthesis) {
      yield { type: 'text', content: synthesis }
    }

    yield { type: 'done', content: '' }
  }

  /** Semantic search across memories (requires embeddings + Supabase) */
  async searchMemory(query: string, options?: {
    limit?: number
    domain?: string
  }): Promise<{ content: string; domain: string | null; similarity: number }[]> {
    return this.memory.searchSemantic(query, options)
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

  /**
   * Start watching context directory for file changes.
   * Automatically reloads context when .md files change.
   * Returns a callback for notification (e.g. to print a message in CLI).
   */
  startWatching(onReload?: (result: { domainCount: number; docCount: number; warnings: string[] }) => void): void {
    if (this.watcher) return

    this.watcher = new ContextWatcher(this.contextDir)
    this.watcher.start(() => {
      const result = this.reloadContext()
      onReload?.(result)
    })
  }

  /** Stop watching context directory. */
  stopWatching(): void {
    this.watcher?.stop()
    this.watcher = null
  }

  /** Check if file watcher is active. */
  isWatching(): boolean {
    return this.watcher?.isActive() ?? false
  }

  /** Fire-and-forget sync of current session to Supabase */
  private syncSessionToSupabase(): void {
    if (!this.supabase) return
    const session = this.sessions.getCurrent()
    if (!session) return

    this.supabase.saveSession({
      id: session.id,
      title: session.title,
      domain: session.domain,
      messages: session.messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: new Date().toISOString(),
      })),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }).catch(() => {}) // Best-effort, don't block chat
  }
}
