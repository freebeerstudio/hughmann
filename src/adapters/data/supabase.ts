import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { DataAdapter } from './types.js'
import type { Task, TaskFilters, CreateTaskInput, UpdateTaskInput } from '../../types/tasks.js'
import type { Project, ProjectFilters, CreateProjectInput, UpdateProjectInput, PlanningSessionRecord, Milestone } from '../../types/projects.js'

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
export class SupabaseAdapter implements DataAdapter {
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

  async getRecentMemories(days = 3, domain?: string | string[]): Promise<{
    content: string
    domain: string | null
    memory_date: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    const since = new Date()
    since.setDate(since.getDate() - days)

    let query = this.client
      .from('memories')
      .select('content, domain, memory_date, created_at')
      .gte('memory_date', since.toISOString().split('T')[0])
      .order('created_at', { ascending: false })

    if (domain) {
      if (Array.isArray(domain)) {
        query = query.in('domain', domain)
      } else {
        query = query.eq('domain', domain)
      }
    }

    const { data } = await query
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

  // ─── Knowledge Base ──────────────────────────────────────────────────────

  async upsertKbNode(node: {
    vault: string
    filePath: string
    title: string
    content: string
    embedding?: number[]
    frontmatter?: Record<string, unknown>
    nodeType?: string
    lastModified?: string
    customerId?: string
  }): Promise<string | null> {
    if (!this.ready) return null

    const row: Record<string, unknown> = {
      vault: node.vault,
      file_path: node.filePath,
      title: node.title,
      content: node.content,
      frontmatter: node.frontmatter ?? {},
      node_type: node.nodeType ?? 'note',
      last_modified: node.lastModified ?? new Date().toISOString(),
      synced_at: new Date().toISOString(),
      customer_id: node.customerId ?? domainToCustomerId(node.vault),
    }

    if (node.embedding) {
      row.embedding = `[${node.embedding.join(',')}]`
    }

    const { data } = await this.client
      .from('kb_nodes')
      .upsert(row, { onConflict: 'vault,file_path' })
      .select('id')
      .single()

    return data?.id ?? null
  }

  async searchKbNodes(queryEmbedding: number[], options?: {
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
  }[]> {
    if (!this.ready) return []

    const { data } = await this.client.rpc('search_kb_nodes', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      match_threshold: options?.threshold ?? 0.3,
      match_count: options?.limit ?? 5,
      filter_vault: options?.vault ?? null,
      filter_node_type: options?.nodeType ?? null,
      p_customer_id: options?.customerId ?? null,
    })

    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      vault: String(row.vault),
      filePath: String(row.file_path),
      title: String(row.title),
      content: String(row.content),
      similarity: Number(row.similarity),
    }))
  }

  async deleteKbNode(vault: string, filePath: string): Promise<void> {
    if (!this.ready) return

    await this.client
      .from('kb_nodes')
      .delete()
      .eq('vault', vault)
      .eq('file_path', filePath)
  }

  async getKbNodeByPath(vault: string, filePath: string): Promise<{
    id: string
    contentHash?: string
    lastModified?: string
  } | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('kb_nodes')
      .select('id, last_modified')
      .eq('vault', vault)
      .eq('file_path', filePath)
      .single()

    if (!data) return null
    return {
      id: data.id,
      lastModified: data.last_modified,
    }
  }

  // ─── Tasks ──────────────────────────────────────────────────────────────

  async listTasks(filters?: TaskFilters): Promise<Task[]> {
    if (!this.ready) return []

    let query = this.client
      .from('tasks')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status)
      } else {
        query = query.eq('status', filters.status)
      }
    }
    if (filters?.domain) {
      query = query.eq('domain', filters.domain)
    }
    if (filters?.project) {
      query = query.eq('project', filters.project)
    }
    if (filters?.task_type) {
      if (Array.isArray(filters.task_type)) {
        query = query.in('task_type', filters.task_type)
      } else {
        query = query.eq('task_type', filters.task_type)
      }
    }
    if (filters?.limit) {
      query = query.limit(filters.limit)
    }

    const { data } = await query
    return (data ?? []) as Task[]
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString()
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'todo',
      task_type: input.task_type ?? 'STANDARD',
      domain: input.domain ?? null,
      project: input.project ?? null,
      project_id: input.project_id ?? null,
      priority: input.priority ?? 3,
      due_date: input.due_date ?? null,
      cwd: input.cwd ?? null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      completion_notes: null,
    }

    await this.client.from('tasks').insert(task)
    return task
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('tasks')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()

    return (data as Task) ?? null
  }

  async completeTask(id: string, notes?: string): Promise<Task | null> {
    if (!this.ready) return null

    const now = new Date().toISOString()
    const { data } = await this.client
      .from('tasks')
      .update({
        status: 'done',
        completed_at: now,
        updated_at: now,
        completion_notes: notes ?? null,
      })
      .eq('id', id)
      .select('*')
      .single()

    return (data as Task) ?? null
  }

  async getTask(id: string): Promise<Task | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('tasks')
      .select('*')
      .eq('id', id)
      .single()

    return (data as Task) ?? null
  }

  // ─── Projects ──────────────────────────────────────────────────────────────

  async listProjects(filters?: ProjectFilters): Promise<Project[]> {
    if (!this.ready) return []

    let query = this.client
      .from('projects')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })

    if (filters?.domain) {
      query = query.eq('domain', filters.domain)
    }
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status)
      } else {
        query = query.eq('status', filters.status)
      }
    }
    if (filters?.limit) {
      query = query.limit(filters.limit)
    }

    const { data } = await query
    return (data ?? []).map(parseProject)
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const now = new Date().toISOString()
    const slug = input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const milestones: Milestone[] = (input.milestones ?? []).map(m => ({
      id: randomUUID(),
      title: m.title,
      target_date: m.target_date ?? null,
      completed: false,
      completed_at: null,
    }))

    const row = {
      id: randomUUID(),
      name: input.name,
      slug,
      description: input.description ?? null,
      domain: input.domain ?? null,
      status: input.status ?? 'planning',
      goals: input.goals ?? [],
      quarterly_goal: input.quarterly_goal ?? null,
      milestones,
      priority: input.priority ?? 3,
      created_at: now,
      updated_at: now,
      completed_at: null,
      metadata: input.metadata ?? {},
    }

    await this.client.from('projects').insert(row)
    return row as Project
  }

  async updateProject(id: string, input: UpdateProjectInput): Promise<Project | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('projects')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()

    return data ? parseProject(data) : null
  }

  async getProject(id: string): Promise<Project | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('projects')
      .select('*')
      .eq('id', id)
      .single()

    return data ? parseProject(data) : null
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('projects')
      .select('*')
      .eq('slug', slug)
      .single()

    return data ? parseProject(data) : null
  }

  // ─── Planning Sessions ─────────────────────────────────────────────────────

  async savePlanningSession(record: Omit<PlanningSessionRecord, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID()
    await this.client.from('planning_sessions').insert({
      id,
      ...record,
    })
    return id
  }

  async getRecentPlanningSessions(limit = 5): Promise<PlanningSessionRecord[]> {
    if (!this.ready) return []

    const { data } = await this.client
      .from('planning_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    return (data ?? []) as PlanningSessionRecord[]
  }

  async getLatestPlanningSession(): Promise<PlanningSessionRecord | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('planning_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return (data as PlanningSessionRecord) ?? null
  }

  // ─── Feedback ───────────────────────────────────────────────────────────

  async saveFeedback(entry: {
    category: string
    signal: 'positive' | 'negative' | 'correction'
    content: string
    context?: string
    domain?: string
  }): Promise<void> {
    if (!this.ready) return
    await this.client.from('feedback').insert({
      category: entry.category,
      signal: entry.signal,
      content: entry.content,
      context: entry.context ?? null,
      domain: entry.domain ?? null,
    })
  }

  async getFeedbackPatterns(options?: {
    domain?: string
    category?: string
    limit?: number
    since?: string
  }): Promise<{
    category: string
    signal: string
    content: string
    domain: string | null
    created_at: string
  }[]> {
    if (!this.ready) return []
    let query = this.client.from('feedback').select('category, signal, content, domain, created_at')
    if (options?.domain) query = query.eq('domain', options.domain)
    if (options?.category) query = query.eq('category', options.category)
    if (options?.since) query = query.gte('created_at', options.since)
    query = query.order('created_at', { ascending: false }).limit(options?.limit ?? 50)
    const { data } = await query
    return (data ?? []) as { category: string; signal: string; content: string; domain: string | null; created_at: string }[]
  }
}

/** Parse a Supabase row into a typed Project (handles JSONB arrays) */
function parseProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: row.description != null ? String(row.description) : null,
    domain: row.domain != null ? String(row.domain) : null,
    status: String(row.status) as Project['status'],
    goals: Array.isArray(row.goals) ? row.goals as string[] : [],
    quarterly_goal: row.quarterly_goal != null ? String(row.quarterly_goal) : null,
    milestones: Array.isArray(row.milestones) ? row.milestones as Milestone[] : [],
    priority: Number(row.priority),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    metadata: (row.metadata && typeof row.metadata === 'object') ? row.metadata as Record<string, unknown> : {},
  }
}

// ─── Domain → Customer ID Mapping ───────────────────────────────────────────

const CUSTOMER_IDS: Record<string, string> = {
  omnissa: '926a785c-2964-4eef-973c-c82f768d8a56',
  fbs: 'fdd7ce7f-5194-4dae-91c5-fd6b1b4d6a88',
  personal: 'fc64558e-2740-4005-883f-53388b7edad7',
}

export function domainToCustomerId(domain: string | null): string {
  if (!domain) return CUSTOMER_IDS.personal
  return CUSTOMER_IDS[domain.toLowerCase()] ?? CUSTOMER_IDS.personal
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
  customer_id UUID,
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
  customer_id UUID,
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
  customer_id UUID,
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
  customer_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_notes_domain ON domain_notes (domain);

-- Knowledge base nodes
CREATE TABLE IF NOT EXISTS kb_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault TEXT NOT NULL,
  file_path TEXT NOT NULL,
  title TEXT,
  content TEXT,
  embedding vector(1536),
  frontmatter JSONB DEFAULT '{}',
  node_type TEXT,
  last_modified TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  customer_id UUID,
  UNIQUE(vault, file_path)
);

CREATE INDEX IF NOT EXISTS idx_kb_nodes_vault ON kb_nodes(vault);
CREATE INDEX IF NOT EXISTS idx_kb_nodes_type ON kb_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_kb_nodes_customer ON kb_nodes(customer_id);

-- Knowledge base edges
CREATE TABLE IF NOT EXISTS kb_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id UUID REFERENCES kb_nodes(id) ON DELETE CASCADE,
  target_node_id UUID REFERENCES kb_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  context TEXT,
  customer_id UUID
);

CREATE INDEX IF NOT EXISTS idx_kb_edges_source ON kb_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_kb_edges_target ON kb_edges(target_node_id);

-- Context docs (for Trigger.dev cloud access)
CREATE TABLE IF NOT EXISTS context_docs (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  domain_slug TEXT,
  isolation_zone TEXT,
  content_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'blocked')),
  task_type TEXT NOT NULL DEFAULT 'STANDARD' CHECK (task_type IN ('MUST', 'MIT', 'BIG_ROCK', 'STANDARD')),
  domain TEXT,
  project TEXT,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
  due_date TEXT,
  cwd TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  completion_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks (domain);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks (task_type);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'paused', 'completed', 'archived')),
  goals JSONB NOT NULL DEFAULT '[]',
  quarterly_goal TEXT,
  milestones JSONB NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects (domain);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug);

-- Planning sessions table
CREATE TABLE IF NOT EXISTS planning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  focus_area TEXT NOT NULL,
  topics_covered JSONB NOT NULL DEFAULT '[]',
  decisions_made JSONB NOT NULL DEFAULT '[]',
  tasks_created JSONB NOT NULL DEFAULT '[]',
  projects_touched JSONB NOT NULL DEFAULT '[]',
  open_questions JSONB NOT NULL DEFAULT '[]',
  next_steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planning_sessions_created ON planning_sessions (created_at DESC);

-- Add project_id to tasks (optional FK)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'project_id') THEN
    ALTER TABLE tasks ADD COLUMN project_id UUID REFERENCES projects(id);
    CREATE INDEX idx_tasks_project_id ON tasks (project_id);
  END IF;
END $$;

-- Domain-to-customer mapping function
CREATE OR REPLACE FUNCTION hughmann_customer_id(p_domain TEXT)
RETURNS UUID AS $$
  SELECT CASE lower(p_domain)
    WHEN 'omnissa' THEN '926a785c-2964-4eef-973c-c82f768d8a56'::uuid
    WHEN 'fbs' THEN 'fdd7ce7f-5194-4dae-91c5-fd6b1b4d6a88'::uuid
    ELSE 'fc64558e-2740-4005-883f-53388b7edad7'::uuid
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Search KB nodes by vector similarity (exact scan — no approximate index)
CREATE OR REPLACE FUNCTION search_kb_nodes(
  query_embedding text,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 5,
  filter_vault text DEFAULT NULL,
  filter_node_type text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL
) RETURNS TABLE(
  id uuid,
  vault text,
  file_path text,
  title text,
  content text,
  frontmatter jsonb,
  node_type text,
  similarity float
) AS $$
BEGIN
  -- Force sequential scan to avoid incomplete results from approximate vector indexes
  SET LOCAL enable_indexscan = off;
  SET LOCAL enable_bitmapscan = off;

  RETURN QUERY
  SELECT
    kn.id,
    kn.vault,
    kn.file_path,
    kn.title,
    kn.content,
    kn.frontmatter,
    kn.node_type,
    1 - (kn.embedding <=> query_embedding::vector) AS similarity
  FROM kb_nodes kn
  WHERE kn.embedding IS NOT NULL
    AND 1 - (kn.embedding <=> query_embedding::vector) > match_threshold
    AND (filter_vault IS NULL OR kn.vault = filter_vault)
    AND (filter_node_type IS NULL OR kn.node_type = filter_node_type)
    AND (p_customer_id IS NULL OR kn.customer_id = p_customer_id)
  ORDER BY kn.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_sessions ENABLE ROW LEVEL SECURITY;

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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kb_nodes' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON kb_nodes FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kb_edges' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON kb_edges FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'context_docs' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON context_docs FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tasks' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON tasks FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON projects FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'planning_sessions' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON planning_sessions FOR ALL USING (true);
  END IF;
END $$;
`

/**
 * Returns the migration SQL for users to run.
 */
export function getMigrationSQL(): string {
  return MIGRATION_SQL
}
