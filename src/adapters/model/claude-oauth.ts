import type { ModelAdapter, ModelAdapterOptions } from '../../types/adapters.js'
import type { ModelResponse, ModelStreamChunk } from '../../types/model.js'

/**
 * Claude OAuth adapter using the Agent SDK.
 * Piggybacks on Claude Max subscription OAuth tokens (same auth as claude-code).
 *
 * Supports two modes:
 * - Conversational: maxTurns: 1, no tools (fast Q&A)
 * - Autonomous: maxTurns configurable, Claude Code preset tools (file read/write, shell, search)
 */
export class ClaudeOAuthAdapter implements ModelAdapter {
  id = 'claude-oauth'
  name = 'Claude (Max OAuth)'

  private queryFn: ((args: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>> & { setPermissionMode?: (mode: string) => Promise<void> }) | null = null

  isAvailable(): boolean {
    return true
  }

  private async getQuery() {
    if (!this.queryFn) {
      const sdk = await import('@anthropic-ai/claude-agent-sdk')
      this.queryFn = sdk.query as unknown as typeof this.queryFn
    }
    return this.queryFn!
  }

  async complete(
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options?: ModelAdapterOptions
  ): Promise<ModelResponse> {
    const queryFn = await this.getQuery()
    const model = options?.model ?? 'claude-opus-4-6'
    const tools = options?.tools

    const lastUserMsg = messages.filter(m => m.role === 'user').pop()
    const prompt = lastUserMsg?.content ?? ''

    let responseText = ''
    let responseModel = model

    const queryOptions: Record<string, unknown> = {
      model,
      systemPrompt,
    }

    if (tools?.enabled) {
      queryOptions.maxTurns = tools.maxTurns ?? 25
      queryOptions.permissionMode = 'bypassPermissions'
      queryOptions.allowDangerouslySkipPermissions = true
      if (tools.builtinTools !== undefined) {
        queryOptions.tools = tools.builtinTools
      }
      if (tools.cwd) {
        queryOptions.cwd = tools.cwd
      }
      if (tools.allowedTools) {
        queryOptions.allowedTools = tools.allowedTools
      }
      if (tools.disallowedTools) {
        queryOptions.disallowedTools = tools.disallowedTools
      }
      if (tools.mcpServers && Object.keys(tools.mcpServers).length > 0) {
        queryOptions.mcpServers = tools.mcpServers
      }
    } else {
      // Conversational: deny all tools so model responds from system prompt
      queryOptions.maxTurns = 10
      queryOptions.canUseTool = denyAllTools
    }

    const q = queryFn({ prompt, options: queryOptions })

    for await (const message of q) {
      const msg = message as Record<string, unknown>
      if (msg.type === 'assistant') {
        const assistantMsg = msg.message as Record<string, unknown> | undefined
        const content = assistantMsg?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              responseText += block.text
            }
          }
        }
        responseModel = (assistantMsg?.model as string) ?? responseModel
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success' && msg.result) {
          if (!responseText) {
            responseText = msg.result as string
          }
        }
      }
    }

    return {
      content: responseText,
      provider: this.id,
      model: responseModel,
      streamed: false,
    }
  }

  async *stream(
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options?: ModelAdapterOptions
  ): AsyncIterable<ModelStreamChunk> {
    const queryFn = await this.getQuery()
    const model = options?.model ?? 'claude-opus-4-6'
    const tools = options?.tools

    const lastUserMsg = messages.filter(m => m.role === 'user').pop()
    const prompt = lastUserMsg?.content ?? ''

    const queryOptions: Record<string, unknown> = {
      model,
      systemPrompt,
      includePartialMessages: true,
    }

    if (tools?.enabled) {
      queryOptions.maxTurns = tools.maxTurns ?? 25
      queryOptions.permissionMode = 'bypassPermissions'
      queryOptions.allowDangerouslySkipPermissions = true
      if (tools.builtinTools !== undefined) {
        queryOptions.tools = tools.builtinTools
      }
      if (tools.cwd) {
        queryOptions.cwd = tools.cwd
      }
      if (tools.allowedTools) {
        queryOptions.allowedTools = tools.allowedTools
      }
      if (tools.disallowedTools) {
        queryOptions.disallowedTools = tools.disallowedTools
      }
      if (tools.mcpServers && Object.keys(tools.mcpServers).length > 0) {
        queryOptions.mcpServers = tools.mcpServers
      }
    } else {
      // Conversational mode: no tools. Deny all tool use so the model responds
      // purely from the system prompt (which includes KB search results).
      queryOptions.maxTurns = 10
      queryOptions.canUseTool = denyAllTools
    }

    const q = queryFn({ prompt, options: queryOptions })

    let lastText = ''
    let currentToolName: string | null = null

    try {
      for await (const message of q) {
        const msg = message as Record<string, unknown>

        if (msg.type === 'assistant') {
          const assistantMsg = msg.message as Record<string, unknown> | undefined
          const content = assistantMsg?.content
          if (Array.isArray(content)) {
            let fullText = ''
            for (const block of content) {
              if (block.type === 'text') {
                fullText += block.text
              } else if (block.type === 'tool_use') {
                // Claude is requesting a tool — emit tool_use chunk
                const toolName = (block.name as string) ?? 'unknown'
                const input = block.input as Record<string, unknown> | undefined
                currentToolName = toolName
                yield {
                  type: 'tool_use',
                  content: formatToolUse(toolName, input),
                  metadata: { toolName, toolId: block.id as string },
                }
              }
            }
            if (fullText.length > lastText.length) {
              yield { type: 'text', content: fullText.slice(lastText.length) }
              lastText = fullText
            }
          }
        } else if (msg.type === 'tool_progress') {
          // Tool is executing
          const toolName = (msg.tool_name as string) ?? currentToolName ?? 'tool'
          yield {
            type: 'tool_progress',
            content: `${toolName} running...`,
            metadata: {
              toolName,
              toolId: msg.tool_use_id as string,
            },
          }
        } else if (msg.type === 'tool_use_summary') {
          // Summary after tool use sequence
          yield {
            type: 'status',
            content: msg.summary as string,
          }
        } else if (msg.type === 'result') {
          const turnCount = msg.num_turns as number | undefined
          const costUsd = msg.total_cost_usd as number | undefined

          if (msg.subtype === 'success') {
            // If there's a result text and we haven't captured text from assistant messages
            if (msg.result && !lastText) {
              yield { type: 'text', content: msg.result as string }
            }
            yield {
              type: 'done',
              content: '',
              metadata: { turnCount, costUsd },
            }
          } else {
            // Error result
            const errors = msg.errors as string[] | undefined
            const errorContent = (errors && errors.length > 0)
              ? errors.join('; ')
              : `Agent ended: ${msg.subtype}`
            console.error(`[claude-oauth] Stream error — subtype: ${msg.subtype}, errors: ${JSON.stringify(errors)}, turns: ${turnCount}`)
            yield {
              type: 'error',
              content: errorContent,
              metadata: { turnCount, costUsd },
            }
            yield { type: 'done', content: '', metadata: { turnCount, costUsd } }
          }
          return
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[claude-oauth] Stream threw: ${errMsg}`)
      yield { type: 'error', content: `Stream error: ${errMsg}` }
    }

    yield { type: 'done', content: '' }
  }
}

/**
 * Denies all tool use — used in conversational mode where KB data
 * is already injected into the system prompt.
 */
async function denyAllTools(
  _toolName: string,
  _input: Record<string, unknown>,
  _options: Record<string, unknown>,
): Promise<{ behavior: string; message?: string }> {
  return { behavior: 'deny', message: 'Respond using the knowledge provided in your system prompt.' }
}


/**
 * Format a tool use for display.
 */
function formatToolUse(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return toolName

  switch (toolName) {
    case 'Read':
      return `Reading ${input.file_path ?? 'file'}`
    case 'Edit':
      return `Editing ${input.file_path ?? 'file'}`
    case 'Write':
      return `Writing ${input.file_path ?? 'file'}`
    case 'Bash':
      return `Running: ${truncate(String(input.command ?? ''), 80)}`
    case 'Grep':
      return `Searching for "${truncate(String(input.pattern ?? ''), 40)}"`
    case 'Glob':
      return `Finding files: ${input.pattern ?? ''}`
    case 'WebFetch':
      return `Fetching ${input.url ?? 'URL'}`
    case 'WebSearch':
      return `Searching: "${truncate(String(input.query ?? ''), 60)}"`
    case 'list_tasks':
      return 'Checking tasks...'
    case 'create_task':
      return `Creating task: ${input.title ?? ''}`
    case 'update_task':
      return `Updating task ${input.id ?? ''}`
    case 'complete_task':
      return `Completing task ${input.id ?? ''}`
    case 'list_projects':
      return 'Checking projects...'
    case 'create_project':
      return `Creating project: ${input.name ?? ''}`
    case 'update_project':
      return `Updating project ${input.id ?? ''}`
    case 'get_current_time':
      return 'Checking time...'
    default:
      return toolName
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}
