import type { ModelRouter } from './model-router.js'
import type { ModelStreamChunk, McpServerConfig } from '../types/model.js'

/**
 * Sub-agent definition for parallel task execution.
 */
export interface SubAgent {
  id: string
  name: string
  task: string
  domain?: string
  /** System prompt override (uses default if not set) */
  systemPrompt?: string
  maxTurns?: number
}

/**
 * Result from a completed sub-agent.
 */
export interface SubAgentResult {
  id: string
  name: string
  content: string
  toolLog: string[]
  success: boolean
  error?: string
}

/**
 * Sub-agent orchestrator.
 * Spawns multiple AI agents in parallel, each with their own task and context.
 * All sub-agents use the same model (Opus) with tools enabled.
 */
export class SubAgentManager {
  private router: ModelRouter
  private mcpServers: Record<string, McpServerConfig>
  private defaultSystemPrompt: string

  constructor(
    router: ModelRouter,
    defaultSystemPrompt: string,
    mcpServers?: Record<string, McpServerConfig>,
  ) {
    this.router = router
    this.defaultSystemPrompt = defaultSystemPrompt
    this.mcpServers = mcpServers ?? {}
  }

  /**
   * Run a single sub-agent and collect its full output.
   */
  async run(agent: SubAgent): Promise<SubAgentResult> {
    const chunks: string[] = []
    const toolLog: string[] = []

    try {
      for await (const chunk of this.stream(agent)) {
        if (chunk.type === 'text') chunks.push(chunk.content)
        if (chunk.type === 'tool_use') toolLog.push(chunk.content)
      }

      return {
        id: agent.id,
        name: agent.name,
        content: chunks.join(''),
        toolLog,
        success: true,
      }
    } catch (err) {
      return {
        id: agent.id,
        name: agent.name,
        content: '',
        toolLog,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Stream output from a single sub-agent. Tools always enabled.
   */
  async *stream(agent: SubAgent): AsyncIterable<ModelStreamChunk> {
    const systemPrompt = agent.systemPrompt ?? this.defaultSystemPrompt

    yield* this.router.routeStream({
      messages: [{ role: 'user', content: agent.task }],
      toolUse: true,
      toolOptions: {
        enabled: true,
        maxTurns: agent.maxTurns ?? 15,
        mcpServers: Object.keys(this.mcpServers).length > 0 ? this.mcpServers : undefined,
      },
    }, systemPrompt)
  }

  /**
   * Run multiple sub-agents in parallel and collect all results.
   * Returns results in the same order as the input agents.
   */
  async runParallel(agents: SubAgent[]): Promise<SubAgentResult[]> {
    const promises = agents.map(agent => this.run(agent))
    return Promise.all(promises)
  }

  /**
   * Run multiple sub-agents in parallel and stream progress.
   * Yields status updates as agents complete, then a final summary.
   */
  async *runParallelStream(agents: SubAgent[]): AsyncIterable<ModelStreamChunk & { agentId?: string }> {
    // Start all agents
    const promises = agents.map(agent =>
      this.run(agent).then(result => ({ agent, result }))
    )

    yield {
      type: 'status',
      content: `Spawning ${agents.length} sub-agents: ${agents.map(a => a.name).join(', ')}`,
    }

    // Use Promise.allSettled to handle individual failures
    const settled = await Promise.allSettled(promises)

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const { agent, result } = outcome.value
        if (result.success) {
          yield {
            type: 'status',
            content: `${agent.name}: completed`,
            agentId: agent.id,
          }
        } else {
          yield {
            type: 'error',
            content: `${agent.name}: ${result.error}`,
            agentId: agent.id,
          }
        }
      } else {
        yield {
          type: 'error',
          content: `Agent failed: ${outcome.reason}`,
        }
      }
    }

    yield { type: 'done', content: '' }
  }

  /**
   * Decompose a complex task into sub-agents using a planning call.
   * Uses a planning call to analyze the task and suggest sub-tasks.
   */
  async decompose(task: string, systemPrompt?: string): Promise<SubAgent[]> {
    const planPrompt = `You are a task decomposer. Given a complex task, break it into 2-5 independent sub-tasks that can run in parallel.

For each sub-task, output a JSON array with this format:
[
  { "id": "1", "name": "short name", "task": "detailed task description" }
]

Only output the JSON array, nothing else.

Task to decompose:
${task}`

    const response = await this.router.route({
      messages: [{ role: 'user', content: planPrompt }],
    }, systemPrompt ?? this.defaultSystemPrompt)

    try {
      // Extract JSON from response (may be wrapped in markdown code block)
      const jsonMatch = response.content.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return [{ id: '1', name: 'Full Task', task }]

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        id: string
        name: string
        task: string
      }>

      return parsed.map(p => ({
        id: p.id,
        name: p.name,
        task: p.task,
      }))
    } catch {
      // If decomposition fails, run as single agent
      return [{ id: '1', name: 'Full Task', task }]
    }
  }
}
