import type { ModelAdapter, ModelAdapterOptions } from '../types/adapters.js'
import type { ModelRequest, ModelResponse, ModelStreamChunk } from '../types/model.js'

const DEFAULT_MODEL = 'claude-opus-4-6'

export class ModelRouter {
  private adapters: Map<string, ModelAdapter>

  constructor(adapters: ModelAdapter[]) {
    this.adapters = new Map(adapters.map(a => [a.id, a]))
  }

  /**
   * Select provider and model for a request.
   * - Default: Claude OAuth (all $0 via Max subscription)
   * - Explicit provider override: use that provider (e.g. 'openrouter' for non-Claude models)
   * - Fallback: OpenRouter if Claude OAuth is somehow unavailable
   */
  selectProvider(request: ModelRequest): { adapter: ModelAdapter; model: string } {
    const model = DEFAULT_MODEL

    // If a specific provider is requested (e.g. openrouter for non-Claude models)
    if (request.provider) {
      const specific = this.adapters.get(request.provider)
      if (specific?.isAvailable()) {
        return { adapter: specific, model }
      }
    }

    // Always prefer Claude OAuth — all calls are $0 via Max subscription
    const claude = this.adapters.get('claude-oauth')
    if (claude?.isAvailable()) {
      return { adapter: claude, model }
    }

    // Fallback to OpenRouter only if Claude OAuth is unavailable
    const openrouter = this.adapters.get('openrouter')
    if (openrouter?.isAvailable()) {
      return { adapter: openrouter, model }
    }

    throw new Error('No model adapters available. Install @anthropic-ai/claude-agent-sdk or set OPENROUTER_API_KEY.')
  }

  private buildAdapterOptions(request: ModelRequest, model: string): ModelAdapterOptions {
    const opts: ModelAdapterOptions = { model }

    if (request.toolUse) {
      opts.tools = {
        enabled: true,
        maxTurns: 50,
        ...(request.toolOptions ?? {}),
      }
    }

    return opts
  }

  async route(request: ModelRequest, systemPrompt: string): Promise<ModelResponse> {
    const { adapter, model } = this.selectProvider(request)
    const messages = request.messages.map(m => ({ role: m.role, content: m.content }))
    const opts = this.buildAdapterOptions(request, model)
    return adapter.complete(messages, systemPrompt, opts)
  }

  async *routeStream(request: ModelRequest, systemPrompt: string): AsyncIterable<ModelStreamChunk> {
    const { adapter, model } = this.selectProvider(request)
    const messages = request.messages.map(m => ({ role: m.role, content: m.content }))
    const opts = this.buildAdapterOptions(request, model)
    yield* adapter.stream(messages, systemPrompt, opts)
  }

  getAvailableAdapters(): ModelAdapter[] {
    return Array.from(this.adapters.values()).filter(a => a.isAvailable())
  }
}
