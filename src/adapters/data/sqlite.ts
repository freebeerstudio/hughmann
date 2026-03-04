import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { DataAdapter } from './types.js'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled',
  domain TEXT,
  messages TEXT NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_domain ON sessions (domain);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id),
  domain TEXT,
  content TEXT NOT NULL,
  memory_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memories_date ON memories (memory_date DESC);
CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories (domain);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision TEXT NOT NULL,
  reasoning TEXT,
  domain TEXT NOT NULL DEFAULT 'General',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_decisions_domain ON decisions (domain);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions (created_at DESC);

CREATE TABLE IF NOT EXISTS domain_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_domain_notes_domain ON domain_notes (domain);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER,
  content TEXT NOT NULL,
  domain TEXT,
  embedding TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_domain ON memory_embeddings (domain);
`

/**
 * SQLite data adapter using better-sqlite3.
 * Zero config, local-only, fully offline.
 * Stores data at ~/.hughmann/data/hughmann.db
 */
export class SQLiteAdapter implements DataAdapter {
  private db: Database.Database
  private ready = false

  constructor(hughmannHome: string) {
    const dataDir = join(hughmannHome, 'data')
    mkdirSync(dataDir, { recursive: true })
    this.db = new Database(join(dataDir, 'hughmann.db'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
  }

  async init(): Promise<{ success: boolean; error?: string }> {
    try {
      this.db.exec(SCHEMA_SQL)
      // Verify tables
      const tables = this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','memories','decisions','domain_notes')`
      ).all() as { name: string }[]
      if (tables.length < 4) {
        return { success: false, error: 'Failed to create all tables' }
      }
      this.ready = true
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ─── Sessions ──────────────────────────────────────────────────────────

  async saveSession(session: {
    id: string
    title: string
    domain: string | null
    messages: { role: string; content: string; timestamp: string }[]
    createdAt: string
    updatedAt: string
  }): Promise<void> {
    if (!this.ready) return

    this.db.prepare(`
      INSERT INTO sessions (id, title, domain, messages, message_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        domain = excluded.domain,
        messages = excluded.messages,
        message_count = excluded.message_count,
        updated_at = excluded.updated_at
    `).run(
      session.id,
      session.title,
      session.domain,
      JSON.stringify(session.messages),
      session.messages.length,
      session.createdAt,
      session.updatedAt,
    )
  }

  async listSessions(limit = 20): Promise<{
    id: string
    title: string
    domain: string | null
    message_count: number
    created_at: string
    updated_at: string
  }[]> {
    if (!this.ready) return []

    return this.db.prepare(`
      SELECT id, title, domain, message_count, created_at, updated_at
      FROM sessions ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as {
      id: string; title: string; domain: string | null
      message_count: number; created_at: string; updated_at: string
    }[]
  }

  async getSession(id: string): Promise<{
    id: string
    title: string
    domain: string | null
    messages: { role: string; content: string; timestamp: string }[]
  } | null> {
    if (!this.ready) return null

    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
      id: string; title: string; domain: string | null; messages: string
    } | undefined

    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      domain: row.domain,
      messages: JSON.parse(row.messages),
    }
  }

  // ─── Memories ──────────────────────────────────────────────────────────

  async saveMemory(entry: {
    sessionId: string
    domain: string | null
    content: string
    date: string
  }): Promise<void> {
    if (!this.ready) return

    this.db.prepare(`
      INSERT INTO memories (session_id, domain, content, memory_date)
      VALUES (?, ?, ?, ?)
    `).run(entry.sessionId, entry.domain, entry.content, entry.date)
  }

  async getRecentMemories(days = 3, domain?: string | string[]): Promise<{
    content: string
    domain: string | null
    memory_date: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().split('T')[0]

    if (domain) {
      if (Array.isArray(domain)) {
        const placeholders = domain.map(() => '?').join(',')
        return this.db.prepare(`
          SELECT content, domain, memory_date, created_at
          FROM memories WHERE memory_date >= ? AND domain IN (${placeholders})
          ORDER BY created_at DESC
        `).all(sinceStr, ...domain) as {
          content: string; domain: string | null; memory_date: string; created_at: string
        }[]
      }
      return this.db.prepare(`
        SELECT content, domain, memory_date, created_at
        FROM memories WHERE memory_date >= ? AND domain = ?
        ORDER BY created_at DESC
      `).all(sinceStr, domain) as {
        content: string; domain: string | null; memory_date: string; created_at: string
      }[]
    }

    return this.db.prepare(`
      SELECT content, domain, memory_date, created_at
      FROM memories WHERE memory_date >= ?
      ORDER BY created_at DESC
    `).all(sinceStr) as {
      content: string; domain: string | null; memory_date: string; created_at: string
    }[]
  }

  // ─── Decisions ─────────────────────────────────────────────────────────

  async logDecision(entry: {
    decision: string
    reasoning: string
    domain: string
  }): Promise<void> {
    if (!this.ready) return

    this.db.prepare(`
      INSERT INTO decisions (decision, reasoning, domain)
      VALUES (?, ?, ?)
    `).run(entry.decision, entry.reasoning, entry.domain)
  }

  async getDecisions(domain?: string, limit = 20): Promise<{
    decision: string
    reasoning: string
    domain: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    if (domain) {
      return this.db.prepare(`
        SELECT decision, reasoning, domain, created_at
        FROM decisions WHERE domain = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(domain, limit) as {
        decision: string; reasoning: string; domain: string; created_at: string
      }[]
    }

    return this.db.prepare(`
      SELECT decision, reasoning, domain, created_at
      FROM decisions ORDER BY created_at DESC LIMIT ?
    `).all(limit) as {
      decision: string; reasoning: string; domain: string; created_at: string
    }[]
  }

  // ─── Domain Notes ──────────────────────────────────────────────────────

  async addDomainNote(entry: {
    domain: string
    content: string
    source: string
  }): Promise<void> {
    if (!this.ready) return

    this.db.prepare(`
      INSERT INTO domain_notes (domain, content, source)
      VALUES (?, ?, ?)
    `).run(entry.domain, entry.content, entry.source)
  }

  async getDomainNotes(domain: string, limit = 50): Promise<{
    content: string
    source: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    return this.db.prepare(`
      SELECT content, source, created_at
      FROM domain_notes WHERE domain = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(domain, limit) as {
      content: string; source: string; created_at: string
    }[]
  }

  // ─── Vector Memory ─────────────────────────────────────────────────────
  //
  // SQLite doesn't have native vector operations, so we store embeddings
  // as JSON arrays and do brute-force cosine similarity in JS.
  // Fine for personal use (< 100k embeddings).

  async saveMemoryEmbedding(entry: {
    memoryId: number
    content: string
    domain: string | null
    embedding: number[]
  }): Promise<void> {
    if (!this.ready) return

    this.db.prepare(`
      INSERT INTO memory_embeddings (memory_id, content, domain, embedding)
      VALUES (?, ?, ?, ?)
    `).run(entry.memoryId, entry.content, entry.domain, JSON.stringify(entry.embedding))
  }

  async saveMemoryWithEmbedding(entry: {
    sessionId: string
    domain: string | null
    content: string
    date: string
    embedding: number[]
  }): Promise<number | null> {
    if (!this.ready) return null

    const insertMemory = this.db.prepare(`
      INSERT INTO memories (session_id, domain, content, memory_date)
      VALUES (?, ?, ?, ?)
    `)
    const insertEmbedding = this.db.prepare(`
      INSERT INTO memory_embeddings (memory_id, content, domain, embedding)
      VALUES (?, ?, ?, ?)
    `)

    const txn = this.db.transaction(() => {
      const result = insertMemory.run(entry.sessionId, entry.domain, entry.content, entry.date)
      const memoryId = Number(result.lastInsertRowid)
      insertEmbedding.run(memoryId, entry.content, entry.domain, JSON.stringify(entry.embedding))
      return memoryId
    })

    return txn()
  }

  async searchMemories(queryEmbedding: number[], options?: {
    limit?: number
    domain?: string
    threshold?: number
  }): Promise<{
    content: string
    domain: string | null
    similarity: number
    memory_date: string
  }[]> {
    if (!this.ready) return []

    const limit = options?.limit ?? 10
    const threshold = options?.threshold ?? 0.5

    // Fetch all embeddings (optionally filtered by domain)
    let rows: { content: string; domain: string | null; embedding: string; memory_date: string }[]
    if (options?.domain) {
      rows = this.db.prepare(`
        SELECT me.content, me.domain, me.embedding, m.memory_date
        FROM memory_embeddings me
        LEFT JOIN memories m ON m.id = me.memory_id
        WHERE me.domain = ?
      `).all(options.domain) as typeof rows
    } else {
      rows = this.db.prepare(`
        SELECT me.content, me.domain, me.embedding, m.memory_date
        FROM memory_embeddings me
        LEFT JOIN memories m ON m.id = me.memory_id
      `).all() as typeof rows
    }

    // Compute cosine similarity in JS
    const results = rows
      .map(row => {
        const emb = JSON.parse(row.embedding) as number[]
        const sim = cosineSimilarity(queryEmbedding, emb)
        return {
          content: row.content,
          domain: row.domain,
          similarity: sim,
          memory_date: row.memory_date ?? new Date().toISOString().split('T')[0],
        }
      })
      .filter(r => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)

    return results
  }

  // ─── Knowledge Base (stubs — vault sync requires Supabase for pgvector) ──

  async upsertKbNode(): Promise<string | null> { return null }
  async searchKbNodes(): Promise<{ id: string; vault: string; filePath: string; title: string; content: string; similarity: number }[]> { return [] }
  async deleteKbNode(): Promise<void> {}
  async getKbNodeByPath(): Promise<null> { return null }
}

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
