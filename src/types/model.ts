export type TaskComplexity = 'lightweight' | 'conversational' | 'autonomous'

export interface ModelRequest {
  messages: ModelMessage[]
  complexity: TaskComplexity
  provider?: string
  domain?: string
  stream?: boolean
  toolUse?: boolean
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
  type: 'text' | 'done' | 'error'
  content: string
}
