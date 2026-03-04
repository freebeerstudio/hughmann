import type { ModelAdapter, ModelAdapterOptions } from '../types/adapters.js'
import type { ModelRequest, ModelResponse, ModelStreamChunk, TaskComplexity, ToolOptions } from '../types/model.js'

/**
 * Maps task complexity to Claude model tier via OAuth ($0 via Max subscription).
 * All tiers default to Opus 4.6 since Max subscription has no usage limits.
 * OpenRouter is reserved for non-Claude models (embeddings, image gen, etc.).
 *
 * | Complexity      | Model              |
 * |-----------------|--------------------|
 * | lightweight     | claude-opus-4-6    |
 * | conversational  | claude-opus-4-6    |
 * | autonomous      | claude-opus-4-6    |
 */
const COMPLEXITY_MODEL_MAP: Record<TaskComplexity, string> = {
  lightweight: 'claude-opus-4-6',
  conversational: 'claude-opus-4-6',
  autonomous: 'claude-opus-4-6',
}

export class ModelRouter {
  private adapters: Map<string, ModelAdapter>

  constructor(adapters: ModelAdapter[]) {
    this.adapters = new Map(adapters.map(a => [a.id, a]))
  }

  /**
   * Select provider and model for a request.
   * - Default: Claude OAuth, model tier based on complexity
   * - Explicit provider override: use that provider (e.g. 'openrouter' for embeddings/image models)
   * - Fallback: OpenRouter if Claude OAuth is somehow unavailable
   */
  selectProvider(request: ModelRequest): { adapter: ModelAdapter; model: string } {
    const model = COMPLEXITY_MODEL_MAP[request.complexity]

    // If a specific provider is requested (e.g. openrouter for non-Claude models)
    if (request.provider) {
      const specific = this.adapters.get(request.provider)
      if (specific?.isAvailable()) {
        return { adapter: specific, model }
      }
    }

    // Always prefer Claude OAuth — all tiers are $0 via Max subscription
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
        maxTurns: 25,
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
