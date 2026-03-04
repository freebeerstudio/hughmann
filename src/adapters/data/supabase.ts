import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseConfig {
  url: string
  key: string
}

/**
 * Supabase data adapter for structured persistence.
 * Syncs sessions, memories, decisions, and domain data to Supabase tables.
 *
 * Tables:
 *   sessions       - Chat sessions with messages
 *   memories       - Distilled memory entries
 *   decisions      - Decision log entries
 *   domain_notes   - Per-domain notes and context
 */
export class SupabaseAdapter {
  private client: SupabaseClient
  private ready = false

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.key)
  }

  getClient(): SupabaseClient {
    return this.client
  }

  /** Verify connection and tables exist */
  async init(): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.client.from('sessions').select('id').limit(1)
      if (error) {
        if (error.message.includes('does not exist')) {
          return { success: false, error: 'Tables not found. Run migrations first.' }
        }
        return { success: false, error: error.message }
      }
      this.ready = true
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ─── Sessions ─────────────────────────────────────────────────────────

  async saveSession(session: {
    id: string
    title: string
    domain: string | null
    messages: { role: string; content: string; timestamp: string }[]
    createdAt: string
    updatedAt: string
  }): Promise<void> {
    if (!this.ready) return

    await this.client.from('sessions').upsert({
      id: session.id,
      title: session.title,
      domain: session.domain,
      messages: session.messages,
      message_count: session.messages.length,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    })
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

    const { data } = await this.client
      .from('sessions')
      .select('id, title, domain, message_count, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit)

    return data ?? []
  }

  async getSession(id: string): Promise<{
    id: string
    title: string
    domain: string | null
    messages: { role: string; content: string; timestamp: string }[]
  } | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('sessions')
      .select('*')
      .eq('id', id)
      .single()

    return data
  }

  // ─── Memories ─────────────────────────────────────────────────────────

  async saveMemory(entry: {
    sessionId: string
    domain: string | null
    content: string
    date: string
  }): Promise<void> {
    if (!this.ready) return

    await this.client.from('memories').insert({
      session_id: entry.sessionId,
      domain: entry.domain,
      content: entry.content,
      memory_date: entry.date,
    })
  }

  async getRecentMemories(days = 3): Promise<{
    content: string
    domain: string | null
    memory_date: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    const since = new Date()
    since.setDate(since.getDate() - days)

    const { data } = await this.client
      .from('memories')
      .select('content, domain, memory_date, created_at')
      .gte('memory_date', since.toISOString().split('T')[0])
      .order('created_at', { ascending: false })

    return data ?? []
  }

  // ─── Decisions ────────────────────────────────────────────────────────

  async logDecision(entry: {
    decision: string
    reasoning: string
    domain: string
  }): Promise<void> {
    if (!this.ready) return

    await this.client.from('decisions').insert({
      decision: entry.decision,
      reasoning: entry.reasoning,
      domain: entry.domain,
    })
  }

  async getDecisions(domain?: string, limit = 20): Promise<{
    decision: string
    reasoning: string
    domain: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    let query = this.client
      .from('decisions')
      .select('decision, reasoning, domain, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (domain) {
      query = query.eq('domain', domain)
    }

    const { data } = await query
    return data ?? []
  }

  // ─── Domain Notes ─────────────────────────────────────────────────────

  async addDomainNote(entry: {
    domain: string
    content: string
    source: string
  }): Promise<void> {
    if (!this.ready) return

    await this.client.from('domain_notes').insert({
      domain: entry.domain,
      content: entry.content,
      source: entry.source,
    })
  }

  async getDomainNotes(domain: string, limit = 50): Promise<{
    content: string
    source: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    const { data } = await this.client
      .from('domain_notes')
      .select('content, source, created_at')
      .eq('domain', domain)
      .order('created_at', { ascending: false })
      .limit(limit)

    return data ?? []
  }

  // ─── Vector Memory ──────────────────────────────────────────────────────
  //
  // Uses the existing PAI memory_embeddings table schema (UUID ids, no FK to memories).
  // Columns: id, content, domain, embedding, source, memory_type, importance, metadata, etc.

  async saveMemoryEmbedding(entry: {
    memoryId: number
    content: string
    domain: string | null
    embedding: number[]
  }): Promise<void> {
    if (!this.ready) return

    await this.client.from('memory_embeddings').insert({
      content: entry.content,
      domain: entry.domain,
      embedding: `[${entry.embedding.join(',')}]`,
      source: 'hughmann',
      memory_type: 'distilled',
    })
  }

  async saveMemoryWithEmbedding(entry: {
    sessionId: string
    domain: string | null
    content: string
    date: string
    embedding: number[]
  }): Promise<number | null> {
    if (!this.ready) return null

    // Insert memory into memories table
    const { data: memData } = await this.client.from('memories').insert({
      session_id: entry.sessionId,
      domain: entry.domain,
      content: entry.content,
      memory_date: entry.date,
    }).select('id').single()

    if (!memData?.id) return null

    // Insert embedding into existing memory_embeddings table (no FK, uses source tag)
    await this.client.from('memory_embeddings').insert({
      content: entry.content,
      domain: entry.domain,
      embedding: `[${entry.embedding.join(',')}]`,
      source: 'hughmann',
      memory_type: 'distilled',
      metadata: { hughmann_memory_id: memData.id, session_id: entry.sessionId },
    })

    return memData.id
  }

  /**
   * Semantic similarity search using pgvector.
   * Uses the existing search_memory_v2 RPC function from PAI.
   */
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

    const { data } = await this.client.rpc('search_memory_v2', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      match_count: options?.limit ?? 10,
      match_threshold: options?.threshold ?? 0.5,
      filter_domain: options?.domain ?? null,
    })

    return data ?? []
  }
}

// ─── SQL Migration ──────────────────────────────────────────────────────────

/**
 * SQL to create the HughMann tables in Supabase.
 * Run this via the Supabase SQL editor or CLI.
 */
export const MIGRATION_SQL = `
-- HughMann Data Tables
-- Run this in your Supabase SQL editor
--
-- NOTE: memory_embeddings table is NOT created here.
-- HughMann reuses the existing PAI memory_embeddings table and search_memory_v2 function.
-- New HughMann embeddings are tagged with source='hughmann', memory_type='distilled'.

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled',
  domain TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_domain ON sessions (domain);

-- Memories table
CREATE TABLE IF NOT EXISTS memories (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  domain TEXT,
  content TEXT NOT NULL,
  memory_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_date ON memories (memory_date DESC);
CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories (domain);

-- Decisions table
CREATE TABLE IF NOT EXISTS decisions (
  id BIGSERIAL PRIMARY KEY,
  decision TEXT NOT NULL,
  reasoning TEXT,
  domain TEXT NOT NULL DEFAULT 'General',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decisions_domain ON decisions (domain);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions (created_at DESC);

-- Domain notes table
CREATE TABLE IF NOT EXISTS domain_notes (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_notes_domain ON domain_notes (domain);

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_notes ENABLE ROW LEVEL SECURITY;

-- Allow all operations for service key
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sessions' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON sessions FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memories' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON memories FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'decisions' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON decisions FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'domain_notes' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON domain_notes FOR ALL USING (true);
  END IF;
END $$;
`

/**
 * Returns the migration SQL for users to run.
 */
export function getMigrationSQL(): string {
  return MIGRATION_SQL
}
