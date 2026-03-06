import type { ModelRouter } from './model-router.js'
import type { ModelStreamChunk, McpServerConfig } from '../types/model.js'

/** Predefined agent roles with specialized system prompts */
export type AgentRole = 'researcher' | 'coder' | 'reviewer' | 'writer' | 'planner' | 'custom'

const ROLE_PROMPTS: Record<Exclude<AgentRole, 'custom'>, string> = {
  researcher: `You are a research specialist. Your job is to gather information, find relevant sources, and compile comprehensive findings. Be thorough but concise. Cite sources when possible. Focus on accuracy over speed.`,

  coder: `You are a coding specialist. Write clean, well-tested code. Follow existing patterns in the codebase. Keep changes minimal and focused. Always consider edge cases and error handling.`,

  reviewer: `You are a code/content reviewer. Analyze the provided work for correctness, completeness, security issues, and quality. Be constructive and specific in your feedback. Categorize issues as critical, important, or minor.`,

  writer: `You are a writing specialist. Produce clear, well-structured content appropriate for the target audience. Match the tone and style conventions of the project. Be concise but thorough.`,

  planner: `You are a planning specialist. Break down complex tasks into actionable steps. Identify dependencies, risks, and decision points. Prioritize by impact and effort. Output structured plans.`,
}

/**
 * Sub-agent definition for parallel task execution.
 */
export interface SubAgent {
  id: string
  name: string
  task: string
  role?: AgentRole
  domain?: string
  /** System prompt override (uses default if not set) */
  systemPrompt?: string
  maxTurns?: number
}

/**
 * Pipeline step — agents run sequentially, each receiving the previous output.
 */
export interface PipelineStep {
  name: string
  role: AgentRole
  /** Template with {{INPUT}} placeholder for previous step's output */
  taskTemplate: string
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
    const systemPrompt = agent.systemPrompt
      ?? (agent.role && agent.role !== 'custom' ? ROLE_PROMPTS[agent.role] : null)
      ?? this.defaultSystemPrompt

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
   * Run agents as a sequential pipeline. Each step receives the previous output.
   * The {{INPUT}} placeholder in taskTemplate is replaced with the prior result.
   */
  async runPipeline(steps: PipelineStep[], initialInput: string): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = []
    let currentInput = initialInput

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const task = step.taskTemplate.replace(/\{\{INPUT\}\}/g, currentInput)

      const result = await this.run({
        id: `pipeline-${i}`,
        name: step.name,
        role: step.role,
        task,
        maxTurns: step.maxTurns,
      })

      results.push(result)

      if (!result.success) break // Stop pipeline on failure
      currentInput = result.content
    }

    return results
  }

  /**
   * Synthesize results from multiple agents into a single coherent response.
   * Uses a planning call to merge and summarize all agent outputs.
   */
  async synthesize(results: SubAgentResult[], originalTask: string): Promise<string> {
    const agentOutputs = results
      .filter(r => r.success)
      .map(r => `### ${r.name}\n\n${r.content}`)
      .join('\n\n---\n\n')

    const synthesisPrompt = `You received outputs from ${results.length} specialized agents working on parts of a larger task.

Original task: ${originalTask}

Agent outputs:
${agentOutputs}

${results.some(r => !r.success) ? `\nNote: ${results.filter(r => !r.success).length} agent(s) failed: ${results.filter(r => !r.success).map(r => `${r.name}: ${r.error}`).join('; ')}` : ''}

Synthesize these outputs into a single, coherent response. Resolve any conflicts, remove redundancy, and present a unified answer.`

    const response = await this.router.route({
      messages: [{ role: 'user', content: synthesisPrompt }],
    }, this.defaultSystemPrompt)

    return response.content
  }

  /**
   * Create a role-based agent with a predefined system prompt.
   */
  createRoleAgent(name: string, role: AgentRole, task: string, opts?: { maxTurns?: number; domain?: string }): SubAgent {
    return {
      id: `${role}-${Date.now()}`,
      name,
      role,
      task,
      maxTurns: opts?.maxTurns,
      domain: opts?.domain,
    }
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
