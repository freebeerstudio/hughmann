export interface ModelRequest {
  messages: ModelMessage[]
  provider?: string
  domain?: string
  stream?: boolean
  toolUse?: boolean
  toolOptions?: Partial<ToolOptions>
}

export interface ModelMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ModelResponse {
  content: string
  provider: string
  model: string
  usage?: { inputTokens: number; outputTokens: number }
  streamed: boolean
}

export interface ModelStreamChunk {
  type: 'text' | 'done' | 'error' | 'tool_use' | 'tool_progress' | 'status'
  content: string
  metadata?: {
    toolName?: string
    toolId?: string
    turnCount?: number
    costUsd?: number
  }
}

export interface ToolOptions {
  enabled: boolean
  cwd?: string
  maxTurns?: number
  allowedTools?: string[]
  disallowedTools?: string[]
  builtinTools?: string[]  // Built-in tool names to enable; [] = none; undefined = all
  mcpServers?: Record<string, McpServerConfig | unknown>
}

export interface McpServerConfig {
  /** 'stdio' for local process, 'sse' for remote HTTP */
  type?: 'stdio' | 'sse'
  command: string
  args?: string[]
  env?: Record<string, string>
  /** For SSE transport */
  url?: string
}
