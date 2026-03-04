import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelAdapter } from '../types/adapters.js'
import type { EmbeddingAdapter } from '../adapters/embeddings/index.js'
import type { SupabaseAdapter } from '../adapters/data/supabase.js'
import type { Session } from './session.js'

const DISTILL_PROMPT = `You are a memory extraction system. Given a conversation between a user and their AI system, extract the key information worth remembering.

Extract ONLY facts, decisions, preferences, and actionable insights. Skip small talk, greetings, and anything already obvious from context.

Format your response EXACTLY as a markdown list:

## Key Facts
- [concrete facts learned about the user, their projects, people, dates, etc.]

## Decisions Made
- [any decisions reached during the conversation, with brief reasoning]

## Preferences & Patterns
- [communication preferences, workflow patterns, tool choices observed]

## Action Items
- [anything the user committed to doing, or asked the AI to track]

If a section has nothing, omit it entirely. Be concise. Each bullet should be one line.`

export class MemoryManager {
  private memoryDir: string
  private model: ModelAdapter | null = null
  private embeddings: EmbeddingAdapter | null = null
  private supabase: SupabaseAdapter | null = null

  constructor(hughmannHome: string) {
    this.memoryDir = join(hughmannHome, 'memory')
    mkdirSync(this.memoryDir, { recursive: true })
  }

  /** Set the model adapter used for distillation (haiku-class) */
  setModel(adapter: ModelAdapter): void {
    this.model = adapter
  }

  /** Set the embedding adapter for vector memory */
  setEmbeddings(adapter: EmbeddingAdapter): void {
    this.embeddings = adapter
  }

  /** Set the Supabase adapter for persistent vector storage */
  setSupabase(adapter: SupabaseAdapter): void {
    this.supabase = adapter
  }

  /**
   * Distill a session into today's memory file.
   * Uses a lightweight model call to extract key facts.
   */
  async distill(session: Session): Promise<string | null> {
    if (!this.model) return null
    if (session.messages.length < 2) return null

    // Build conversation text for the model
    const conversationText = session.messages
      .map(m => `${m.role === 'user' ? 'User' : 'Hugh Mann'}: ${m.content}`)
      .join('\n\n')

    const prompt = `Here is the conversation to distill:\n\n${conversationText}`

    try {
      const response = await this.model.complete(
        [{ role: 'user', content: prompt }],
        DISTILL_PROMPT,
        { model: 'claude-haiku-4-5-20251001' }
      )

      const extracted = response.content.trim()
      if (!extracted) return null

      // Append to today's memory file
      this.appendToDaily(extracted, session)

      return extracted
    } catch (err) {
      // Distillation is best-effort — don't crash if model fails
      console.error(`Memory distillation failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /**
   * Append distilled memory to today's dated file.
   */
  private appendToDaily(content: string, session: Session): void {
    const today = new Date().toISOString().split('T')[0]
    const path = join(this.memoryDir, `${today}.md`)

    const time = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })

    const domainTag = session.domain ? ` [${session.domain}]` : ''
    const header = `### ${time}${domainTag} — ${session.title}\n`
    const entry = `${header}\n${content}\n\n---\n\n`

    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf-8')
      writeFileSync(path, existing + entry, 'utf-8')
    } else {
      const fileHeader = `# Memory — ${today}\n\n`
      writeFileSync(path, fileHeader + entry, 'utf-8')
    }
  }

  /**
   * Get recent memories for inclusion in system prompt.
   * Returns the last N days of memory content.
   */
  getRecentMemories(days: number = 3): string {
    if (!existsSync(this.memoryDir)) return ''

    const files = readdirSync(this.memoryDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, days)

    if (files.length === 0) return ''

    const sections: string[] = []
    for (const file of files) {
      const content = readFileSync(join(this.memoryDir, file), 'utf-8')
      sections.push(content)
    }

    return sections.join('\n')
  }

  /**
   * Check if a session has already been distilled.
   * We track this by storing distilled session IDs in a ledger file.
   */
  isDistilled(sessionId: string): boolean {
    const ledger = this.loadLedger()
    return ledger.has(sessionId)
  }

  /** Mark a session as distilled */
  markDistilled(sessionId: string): void {
    const ledger = this.loadLedger()
    ledger.add(sessionId)
    this.saveLedger(ledger)
  }

  private loadLedger(): Set<string> {
    const path = join(this.memoryDir, '.distilled.json')
    if (!existsSync(path)) return new Set()
    try {
      const raw = readFileSync(path, 'utf-8')
      const arr = JSON.parse(raw) as string[]
      return new Set(arr)
    } catch {
      return new Set()
    }
  }

  private saveLedger(ledger: Set<string>): void {
    const path = join(this.memoryDir, '.distilled.json')
    // Keep only the last 200 entries to prevent unbounded growth
    const arr = Array.from(ledger).slice(-200)
    writeFileSync(path, JSON.stringify(arr, null, 2), 'utf-8')
  }

  // ─── Vector Memory ────────────────────────────────────────────────────

  /** Check if vector memory is available (needs both embeddings + Supabase) */
  hasVectorMemory(): boolean {
    return !!(this.embeddings && this.supabase)
  }

  /**
   * Store a memory with its embedding vector.
   * Called after distillation to enable semantic search.
   */
  async embedAndStore(content: string, sessionId: string, domain: string | null): Promise<void> {
    if (!this.embeddings || !this.supabase) return

    try {
      const embedding = await this.embeddings.embed(content)
      await this.supabase.saveMemoryWithEmbedding({
        sessionId,
        domain,
        content,
        date: new Date().toISOString().split('T')[0],
        embedding,
      })
    } catch {
      // Best-effort — vector memory is an enhancement, not critical
    }
  }

  /**
   * Semantic search across all memories.
   * Returns the most relevant memories for a given query.
   */
  async searchSemantic(query: string, options?: {
    limit?: number
    domain?: string
    threshold?: number
  }): Promise<{ content: string; domain: string | null; similarity: number }[]> {
    if (!this.embeddings || !this.supabase) return []

    try {
      const queryEmbedding = await this.embeddings.embed(query)
      return await this.supabase.searchMemories(queryEmbedding, options)
    } catch {
      return []
    }
  }
}
