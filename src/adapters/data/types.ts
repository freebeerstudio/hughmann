/**
 * Common interface for data adapters (Supabase, SQLite, Turso, etc.)
 * Both persistent storage and vector memory operations.
 */
export interface DataAdapter {
  init(): Promise<{ success: boolean; error?: string }>

  // ─── Sessions ────────────────────────────────────────────────────────

  saveSession(session: {
    id: string
    title: string
    domain: string | null
    messages: { role: string; content: string; timestamp: string }[]
    createdAt: string
    updatedAt: string
  }): Promise<void>

  listSessions(limit?: number): Promise<{
    id: string
    title: string
    domain: string | null
    message_count: number
    created_at: string
    updated_at: string
  }[]>

  getSession(id: string): Promise<{
    id: string
    title: string
    domain: string | null
    messages: { role: string; content: string; timestamp: string }[]
  } | null>

  // ─── Memories ────────────────────────────────────────────────────────

  saveMemory(entry: {
    sessionId: string
    domain: string | null
    content: string
    date: string
  }): Promise<void>

  getRecentMemories(days?: number, domain?: string | string[]): Promise<{
    content: string
    domain: string | null
    memory_date: string
    created_at: string
  }[]>

  // ─── Decisions ───────────────────────────────────────────────────────

  logDecision(entry: {
    decision: string
    reasoning: string
    domain: string
  }): Promise<void>

  getDecisions(domain?: string, limit?: number): Promise<{
    decision: string
    reasoning: string
    domain: string
    created_at: string
  }[]>

  // ─── Domain Notes ────────────────────────────────────────────────────

  addDomainNote(entry: {
    domain: string
    content: string
    source: string
  }): Promise<void>

  getDomainNotes(domain: string, limit?: number): Promise<{
    content: string
    source: string
    created_at: string
  }[]>

  // ─── Vector Memory ───────────────────────────────────────────────────

  saveMemoryEmbedding(entry: {
    memoryId: number
    content: string
    domain: string | null
    embedding: number[]
  }): Promise<void>

  saveMemoryWithEmbedding(entry: {
    sessionId: string
    domain: string | null
    content: string
    date: string
    embedding: number[]
  }): Promise<number | null>

  searchMemories(queryEmbedding: number[], options?: {
    limit?: number
    domain?: string
    threshold?: number
  }): Promise<{
    content: string
    domain: string | null
    similarity: number
    memory_date: string
  }[]>

  // ─── Knowledge Base ──────────────────────────────────────────────

  upsertKbNode(node: {
    vault: string
    filePath: string
    title: string
    content: string
    embedding?: number[]
    frontmatter?: Record<string, unknown>
    nodeType?: string
    lastModified?: string
    customerId?: string
  }): Promise<string | null>

  searchKbNodes(queryEmbedding: number[], options?: {
    limit?: number
    vault?: string
    nodeType?: string
    threshold?: number
    customerId?: string
  }): Promise<{
    id: string
    vault: string
    filePath: string
    title: string
    content: string
    similarity: number
  }[]>

  deleteKbNode(vault: string, filePath: string): Promise<void>

  getKbNodeByPath(vault: string, filePath: string): Promise<{
    id: string
    contentHash?: string
    lastModified?: string
  } | null>
}
