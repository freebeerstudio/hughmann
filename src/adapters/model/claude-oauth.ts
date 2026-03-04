import type { ModelAdapter } from '../../types/adapters.js'
import type { ModelResponse, ModelStreamChunk } from '../../types/model.js'

/**
 * Claude OAuth adapter using the Agent SDK.
 * Piggybacks on Claude Max subscription OAuth tokens (same auth as claude-code).
 * For conversational use: maxTurns: 1, no tools.
 */
export class ClaudeOAuthAdapter implements ModelAdapter {
  id = 'claude-oauth'
  name = 'Claude (Max OAuth)'

  private queryFn: ((args: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>) | null = null

  isAvailable(): boolean {
    // Always available since @anthropic-ai/claude-agent-sdk is a declared dependency.
    // Auth errors are handled at call time.
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
    model?: string
  ): Promise<ModelResponse> {
    const queryFn = await this.getQuery()

    // Build a single prompt from the latest user message
    const lastUserMsg = messages.filter(m => m.role === 'user').pop()
    const prompt = lastUserMsg?.content ?? ''

    let responseText = ''
    let responseModel = model ?? 'claude-sonnet-4-6'

    const q = queryFn({
      prompt,
      options: {
        model: responseModel,
        systemPrompt,
        maxTurns: 1,
        permissionMode: 'dontAsk',
      },
    })

    for await (const message of q) {
      const msg = message as Record<string, unknown>
      if (msg.type === 'assistant') {
        // Extract text from content blocks
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
        // Result message has usage data
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
    model?: string
  ): AsyncIterable<ModelStreamChunk> {
    const queryFn = await this.getQuery()

    const lastUserMsg = messages.filter(m => m.role === 'user').pop()
    const prompt = lastUserMsg?.content ?? ''

    const q = queryFn({
      prompt,
      options: {
        model: model ?? 'claude-sonnet-4-6',
        systemPrompt,
        maxTurns: 1,
        permissionMode: 'dontAsk',
        includePartialMessages: true,
      },
    })

    let lastText = ''

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
            }
          }
          if (fullText.length > lastText.length) {
            yield { type: 'text', content: fullText.slice(lastText.length) }
            lastText = fullText
          }
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success' && msg.result && !lastText) {
          yield { type: 'text', content: msg.result as string }
        }
        yield { type: 'done', content: '' }
        return
      }
    }

    yield { type: 'done', content: '' }
  }
}
