/**
 * Embedding adapter for generating vector embeddings.
 * Uses OpenAI-compatible API (works with OpenAI, OpenRouter, Ollama, etc.)
 *
 * Requires OPENAI_API_KEY or EMBEDDING_API_KEY + optional EMBEDDING_API_URL in env.
 */

export interface EmbeddingAdapter {
  id: string
  isAvailable(): boolean
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  dimensions: number
}

const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_URL = 'https://api.openai.com/v1/embeddings'
const DEFAULT_DIMENSIONS = 1536

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  id = 'openai-embeddings'
  dimensions = DEFAULT_DIMENSIONS

  private apiKey: string
  private apiUrl: string
  private model: string

  constructor() {
    this.apiKey = process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
    this.apiUrl = process.env.EMBEDDING_API_URL ?? DEFAULT_URL
    this.model = process.env.EMBEDDING_MODEL ?? DEFAULT_MODEL

    // text-embedding-3-small = 1536, text-embedding-3-large = 3072, ada-002 = 1536
    if (this.model.includes('3-large')) {
      this.dimensions = 3072
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text])
    return result[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    })

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`)
    }

    const json = await response.json() as {
      data: { embedding: number[]; index: number }[]
    }

    // Sort by index to maintain order
    return json.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding)
  }
}

/**
 * Create an embedding adapter if API keys are available.
 * Returns null if no embedding service is configured.
 */
export function createEmbeddingAdapter(): EmbeddingAdapter | null {
  const adapter = new OpenAIEmbeddingAdapter()
  return adapter.isAvailable() ? adapter : null
}
