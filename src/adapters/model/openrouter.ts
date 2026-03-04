import type { ModelAdapter, ModelAdapterOptions } from '../../types/adapters.js'
import type { ModelResponse, ModelStreamChunk } from '../../types/model.js'

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-haiku'

/**
 * OpenRouter adapter for lightweight tasks.
 * Uses the OpenAI-compatible API with OPENROUTER_API_KEY from env.
 */
export class OpenRouterAdapter implements ModelAdapter {
  id = 'openrouter'
  name = 'OpenRouter'

  private apiKey: string | undefined

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async complete(
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options?: ModelAdapterOptions
  ): Promise<ModelResponse> {
    const model = options?.model
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY not set')
    }

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ]

    const response = await fetch(OPENROUTER_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hughmann.life',
        'X-Title': 'HughMann',
      },
      body: JSON.stringify({
        model: model ?? DEFAULT_MODEL,
        messages: apiMessages,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`)
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[]
      model: string
      usage?: { prompt_tokens: number; completion_tokens: number }
    }

    const choice = data.choices?.[0]
    if (!choice) {
      throw new Error('OpenRouter returned no choices')
    }

    return {
      content: choice.message.content,
      provider: this.id,
      model: data.model ?? model ?? DEFAULT_MODEL,
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      } : undefined,
      streamed: false,
    }
  }

  async *stream(
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options?: ModelAdapterOptions
  ): AsyncIterable<ModelStreamChunk> {
    const model = options?.model
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY not set')
    }

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ]

    const response = await fetch(OPENROUTER_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hughmann.life',
        'X-Title': 'HughMann',
      },
      body: JSON.stringify({
        model: model ?? DEFAULT_MODEL,
        messages: apiMessages,
        stream: true,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      yield { type: 'error', content: `OpenRouter API error (${response.status}): ${errorText}` }
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      yield { type: 'error', content: 'No response body' }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          yield { type: 'done', content: '' }
          return
        }

        try {
          const parsed = JSON.parse(data) as {
            choices: { delta: { content?: string } }[]
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            yield { type: 'text', content: delta }
          }
        } catch {
          // Skip malformed SSE chunks
        }
      }
    }

    yield { type: 'done', content: '' }
  }
}
