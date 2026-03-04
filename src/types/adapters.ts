import type { ModelRequest, ModelResponse, ModelStreamChunk } from './model.js'

export interface ModelAdapter {
  id: string
  name: string
  isAvailable(): boolean
  complete(messages: { role: string; content: string }[], systemPrompt: string, model?: string): Promise<ModelResponse>
  stream(messages: { role: string; content: string }[], systemPrompt: string, model?: string): AsyncIterable<ModelStreamChunk>
}

export interface FrontendAdapter {
  id: string
  name: string
  start(): Promise<void>
  stop(): void
}

// Interfaces only for future phases
export interface DataAdapter {
  id: string
  name: string
  isAvailable(): boolean
}

export interface ExecutionAdapter {
  id: string
  name: string
  isAvailable(): boolean
}
