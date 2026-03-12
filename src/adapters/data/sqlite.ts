import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { DataAdapter, CalendarEvent } from './types.js'
import { cosineSimilarity } from '../../util/math.js'
import * as sqliteVec from 'sqlite-vec'
import type { Task, TaskFilters, CreateTaskInput, UpdateTaskInput } from '../../types/tasks.js'
import type { Project, ProjectFilters, CreateProjectInput, UpdateProjectInput, PlanningSessionRecord, DomainGoal, ApprovalBundle, ApprovalBundleFilters, StateUpdate } from '../../types/projects.js'
import type { Advisor } from '../../types/advisors.js'
import type { ContentPiece, Topic, ContentSource, ContentStatus, ContentPlatform, ContentSourceType } from '../../types/content.js'

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

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER,
  content TEXT NOT NULL,
  domain TEXT,
  embedding TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_domain ON memory_embeddings (domain);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'blocked')),
  task_type TEXT NOT NULL DEFAULT 'standard' CHECK (task_type IN ('must', 'mit', 'big_rock', 'standard')),
  domain TEXT,
  project_id TEXT,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
  due_date TEXT,
  cwd TEXT,
  assignee TEXT,
  assigned_agent_id TEXT,
  blocked_reason TEXT,
  sprint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  completion_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks (domain);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks (task_type);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'paused', 'completed', 'archived', 'incubator')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
  domain_goal_id TEXT,
  north_star TEXT,
  guardrails TEXT NOT NULL DEFAULT '[]',
  infrastructure TEXT NOT NULL DEFAULT '{}',
  refinement_cadence TEXT DEFAULT 'weekly' CHECK (refinement_cadence IN ('weekly', 'biweekly', 'monthly')),
  last_refinement_at TEXT,
  approval_mode TEXT NOT NULL DEFAULT 'required' CHECK (approval_mode IN ('required', 'auto_proceed', 'notify_only')),
  local_path TEXT,
  stack TEXT NOT NULL DEFAULT '[]',
  claude_md_exists INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects (domain);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug);

CREATE TABLE IF NOT EXISTS approval_bundles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  summary TEXT NOT NULL,
  proposed_tasks TEXT NOT NULL DEFAULT '[]',
  reasoning TEXT NOT NULL,
  expires_at TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_approval_bundles_project ON approval_bundles (project_id);
CREATE INDEX IF NOT EXISTS idx_approval_bundles_status ON approval_bundles (status);

CREATE TABLE IF NOT EXISTS planning_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  focus_area TEXT NOT NULL,
  topics_covered TEXT NOT NULL DEFAULT '[]',
  decisions_made TEXT NOT NULL DEFAULT '[]',
  tasks_created TEXT NOT NULL DEFAULT '[]',
  projects_touched TEXT NOT NULL DEFAULT '[]',
  open_questions TEXT NOT NULL DEFAULT '[]',
  next_steps TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_planning_sessions_created ON planning_sessions (created_at DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  signal TEXT NOT NULL CHECK (signal IN ('positive', 'negative', 'correction')),
  content TEXT NOT NULL,
  context TEXT,
  domain TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback (category);
CREATE INDEX IF NOT EXISTS idx_feedback_signal ON feedback (signal);
CREATE INDEX IF NOT EXISTS idx_feedback_domain ON feedback (domain);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);

CREATE TABLE IF NOT EXISTS kb_nodes (
  id TEXT PRIMARY KEY,
  vault TEXT NOT NULL,
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'chunk',
  content_hash TEXT,
  last_modified TEXT,
  customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vault, file_path)
);
CREATE INDEX IF NOT EXISTS idx_kb_nodes_vault ON kb_nodes (vault);
CREATE INDEX IF NOT EXISTS idx_kb_nodes_file_path ON kb_nodes (file_path);

CREATE TABLE IF NOT EXISTS kb_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL REFERENCES kb_nodes(id) ON DELETE CASCADE,
  embedding TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_embeddings_node_id ON kb_embeddings (node_id);

CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  domain TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_briefings_type ON briefings (type);
CREATE INDEX IF NOT EXISTS idx_briefings_created ON briefings (created_at DESC);

CREATE TABLE IF NOT EXISTS advisors (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT,
  expertise TEXT DEFAULT '[]',
  system_prompt TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_advisors_name ON advisors (name);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_topics_domain ON topics (domain);
CREATE INDEX IF NOT EXISTS idx_topics_active ON topics (active);

CREATE TABLE IF NOT EXISTS content_sources (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rss' CHECK (type IN ('rss', 'youtube', 'newsletter', 'manual')),
  url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_content_sources_domain ON content_sources (domain);
CREATE INDEX IF NOT EXISTS idx_content_sources_active ON content_sources (active);

CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  topic_id TEXT,
  project_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'drafting', 'review', 'approved', 'scheduled', 'published', 'rejected')),
  platform TEXT NOT NULL DEFAULT 'blog' CHECK (platform IN ('blog', 'linkedin', 'x', 'newsletter', 'youtube', 'shorts')),
  body TEXT,
  source_material TEXT NOT NULL DEFAULT '[]',
  scheduled_at TEXT,
  published_at TEXT,
  published_url TEXT,
  created_by TEXT NOT NULL DEFAULT 'radar',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_content_status ON content (status);
CREATE INDEX IF NOT EXISTS idx_content_domain ON content (domain);
CREATE INDEX IF NOT EXISTS idx_content_topic ON content (topic_id);

CREATE TABLE IF NOT EXISTS domain_goals (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  statement TEXT NOT NULL,
  current_state TEXT,
  state_updates TEXT DEFAULT '[]',
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_domain_goals_domain ON domain_goals (domain);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  location TEXT,
  attendees TEXT DEFAULT '[]',
  calendar_name TEXT,
  domain TEXT,
  source TEXT DEFAULT 'manual',
  external_id TEXT,
  notes TEXT,
  customer_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(external_id, source)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_time ON calendar_events(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_domain ON calendar_events(domain);
CREATE INDEX IF NOT EXISTS idx_calendar_events_customer ON calendar_events(customer_id);
`

/**
 * SQLite data adapter using better-sqlite3.
 * Zero config, local-only, fully offline.
 * Stores data at ~/.hughmann/data/hughmann.db
 */
export class SQLiteAdapter implements DataAdapter {
  private db: Database.Database
  private ready = false
  private vecEnabled = false

  constructor(hughmannHome: string) {
    const dataDir = join(hughmannHome, 'data')
    mkdirSync(dataDir, { recursive: true })
    this.db = new Database(join(dataDir, 'hughmann.db'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    // Load sqlite-vec extension for native vector search
    try {
      sqliteVec.load(this.db)
      this.vecEnabled = true
    } catch {
      // sqlite-vec not available — fall back to JS cosine similarity
    }
  }

  async init(): Promise<{ success: boolean; error?: string }> {
    try {
      this.db.exec(SCHEMA_SQL)
      // Verify tables
      const tables = this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','memories','tasks','projects','briefings','advisors')`
      ).all() as { name: string }[]
      if (tables.length < 6) {
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
    let rows: { content: string; domain: string | null; embedding: string; memory_date: string }[] = []
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

  // ─── Knowledge Base ──────────────────────────────────────────────────

  async upsertKbNode(node: {
    vault: string
    filePath: string
    title: string
    content: string
    nodeType?: string
    contentHash?: string
    lastModified?: string
    embedding?: number[]
    customerId?: string
  }): Promise<string | null> {
    if (!this.ready) return null

    const existing = this.db.prepare(
      `SELECT id FROM kb_nodes WHERE vault = ? AND file_path = ?`
    ).get(node.vault, node.filePath) as { id: string } | undefined

    const id = existing?.id ?? randomUUID()

    this.db.prepare(`
      INSERT INTO kb_nodes (id, vault, file_path, title, content, node_type, content_hash, last_modified, customer_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(vault, file_path) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        node_type = excluded.node_type,
        content_hash = excluded.content_hash,
        last_modified = excluded.last_modified,
        updated_at = datetime('now')
    `).run(id, node.vault, node.filePath, node.title, node.content, node.nodeType ?? 'chunk', node.contentHash ?? null, node.lastModified ?? null, node.customerId ?? null)

    // Store embedding if provided
    if (node.embedding) {
      this.db.prepare(`DELETE FROM kb_embeddings WHERE node_id = ?`).run(id)
      this.db.prepare(`INSERT INTO kb_embeddings (node_id, embedding) VALUES (?, ?)`).run(id, JSON.stringify(node.embedding))
    }

    return id
  }

  async searchKbNodes(queryEmbedding: number[], options?: {
    limit?: number
    vault?: string
    nodeType?: string
    threshold?: number
  }): Promise<{ id: string; vault: string; filePath: string; title: string; content: string; similarity: number }[]> {
    if (!this.ready) return []

    const limit = options?.limit ?? 5
    const threshold = options?.threshold ?? 0.5

    // Load all embeddings with their node data and compute similarity in JS
    let rows: { id: string; vault: string; file_path: string; title: string; content: string; embedding: string }[] = []

    if (options?.vault) {
      rows = this.db.prepare(`
        SELECT kn.id, kn.vault, kn.file_path, kn.title, kn.content, ke.embedding
        FROM kb_nodes kn
        JOIN kb_embeddings ke ON ke.node_id = kn.id
        WHERE kn.vault = ?
      `).all(options.vault) as typeof rows
    } else {
      rows = this.db.prepare(`
        SELECT kn.id, kn.vault, kn.file_path, kn.title, kn.content, ke.embedding
        FROM kb_nodes kn
        JOIN kb_embeddings ke ON ke.node_id = kn.id
      `).all() as typeof rows
    }

    return rows
      .map(row => {
        const emb = JSON.parse(row.embedding) as number[]
        return {
          id: row.id,
          vault: row.vault,
          filePath: row.file_path,
          title: row.title,
          content: row.content,
          similarity: cosineSimilarity(queryEmbedding, emb),
        }
      })
      .filter(r => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
  }

  async deleteKbNode(vault: string, filePath: string): Promise<void> {
    if (!this.ready) return
    this.db.prepare(`DELETE FROM kb_nodes WHERE vault = ? AND file_path = ?`).run(vault, filePath)
  }

  async getKbNodeByPath(vault: string, filePath: string): Promise<{
    id: string
    contentHash?: string
    lastModified?: string
  } | null> {
    if (!this.ready) return null
    const row = this.db.prepare(
      `SELECT id, content_hash, last_modified FROM kb_nodes WHERE vault = ? AND file_path = ?`
    ).get(vault, filePath) as { id: string; content_hash: string | null; last_modified: string | null } | undefined
    if (!row) return null
    return {
      id: row.id,
      contentHash: row.content_hash ?? undefined,
      lastModified: row.last_modified ?? undefined,
    }
  }

  // ─── Tasks ──────────────────────────────────────────────────────────────

  async listTasks(filters?: TaskFilters): Promise<Task[]> {
    if (!this.ready) return []

    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`status IN (${filters.status.map(() => '?').join(',')})`)
        params.push(...filters.status)
      } else {
        conditions.push('status = ?')
        params.push(filters.status)
      }
    }
    if (filters?.domain) {
      conditions.push('domain = ?')
      params.push(filters.domain)
    }
    if (filters?.project_id) {
      conditions.push('project_id = ?')
      params.push(filters.project_id)
    }
    if (filters?.assignee) {
      conditions.push('assignee = ?')
      params.push(filters.assignee)
    }
    if (filters?.assigneeOrUnassigned) {
      conditions.push('(assignee = ? OR assignee IS NULL)')
      params.push(filters.assigneeOrUnassigned)
    }
    if (filters?.task_type) {
      if (Array.isArray(filters.task_type)) {
        conditions.push(`task_type IN (${filters.task_type.map(() => '?').join(',')})`)
        params.push(...filters.task_type)
      } else {
        conditions.push('task_type = ?')
        params.push(filters.task_type)
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters?.limit ? `LIMIT ${filters.limit}` : ''

    return this.db.prepare(`
      SELECT * FROM tasks ${where}
      ORDER BY priority ASC, created_at ASC ${limit}
    `).all(...params) as Task[]
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString()
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'todo',
      task_type: input.task_type ?? 'standard',
      domain: input.domain ?? null,
      project_id: input.project_id ?? null,
      priority: input.priority ?? 3,
      due_date: input.due_date ?? null,
      cwd: input.cwd ?? null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      completion_notes: null,
      assignee: input.assignee ?? null,
      assigned_agent_id: input.assigned_agent_id ?? null,
      blocked_reason: input.blocked_reason ?? null,
      sprint: input.sprint ?? null,
    }

    this.db.prepare(`
      INSERT INTO tasks (id, title, description, status, task_type, domain, project_id, priority, due_date, cwd, created_at, updated_at, completed_at, completion_notes, assignee, assigned_agent_id, blocked_reason, sprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.title, task.description, task.status, task.task_type,
      task.domain, task.project_id, task.priority, task.due_date, task.cwd,
      task.created_at, task.updated_at, task.completed_at, task.completion_notes,
      task.assignee, task.assigned_agent_id, task.blocked_reason, task.sprint,
    )

    return task
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    if (!this.ready) return null

    const sets: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(input)) {
      sets.push(`${key} = ?`)
      params.push(value ?? null)
    }

    if (sets.length === 0) return this.getTask(id)

    sets.push('updated_at = ?')
    params.push(new Date().toISOString())
    params.push(id)

    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return this.getTask(id)
  }

  async completeTask(id: string, notes?: string): Promise<Task | null> {
    if (!this.ready) return null

    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?, completion_notes = ?
      WHERE id = ?
    `).run(now, now, notes ?? null, id)

    return this.getTask(id)
  }

  async getTask(id: string): Promise<Task | null> {
    if (!this.ready) return null

    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as (Task & Record<string, unknown>) | undefined
    if (!row) return null
    return {
      ...row,
      project_id: (row.project_id as string | null) ?? null,
      assignee: (row.assignee as string | null) ?? null,
      assigned_agent_id: (row.assigned_agent_id as string | null) ?? null,
      blocked_reason: (row.blocked_reason as string | null) ?? null,
      sprint: (row.sprint as string | null) ?? null,
    }
  }

  // ─── Projects ──────────────────────────────────────────────────────────────

  async listProjects(filters?: ProjectFilters): Promise<Project[]> {
    if (!this.ready) return []

    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.domain) {
      conditions.push('domain = ?')
      params.push(filters.domain)
    }
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`status IN (${filters.status.map(() => '?').join(',')})`)
        params.push(...filters.status)
      } else {
        conditions.push('status = ?')
        params.push(filters.status)
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters?.limit ? `LIMIT ${filters.limit}` : ''

    const rows = this.db.prepare(`
      SELECT * FROM projects ${where}
      ORDER BY priority ASC, created_at ASC ${limit}
    `).all(...params) as Record<string, unknown>[]

    return rows.map(parseSqliteProject)
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const now = new Date().toISOString()
    const slug = input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const project: Project = {
      id: randomUUID(),
      name: input.name,
      slug,
      description: input.description ?? null,
      domain: input.domain,
      status: input.status ?? 'planning',
      priority: input.priority ?? 3,
      domain_goal_id: input.domain_goal_id ?? null,
      north_star: input.north_star ?? null,
      guardrails: input.guardrails ?? [],
      infrastructure: input.infrastructure ?? {},
      refinement_cadence: input.refinement_cadence ?? 'weekly',
      last_refinement_at: null,
      approval_mode: input.approval_mode ?? 'required',
      local_path: input.local_path ?? null,
      stack: input.stack ?? [],
      claude_md_exists: input.claude_md_exists ?? false,
      created_at: now,
      updated_at: now,
    }

    this.db.prepare(`
      INSERT INTO projects (id, name, slug, description, domain, status, priority, domain_goal_id, north_star, guardrails, infrastructure, refinement_cadence, approval_mode, local_path, stack, claude_md_exists, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.name, project.slug, project.description, project.domain,
      project.status, project.priority, project.domain_goal_id,
      project.north_star, JSON.stringify(project.guardrails),
      JSON.stringify(project.infrastructure), project.refinement_cadence,
      project.approval_mode, project.local_path,
      JSON.stringify(project.stack), project.claude_md_exists ? 1 : 0,
      project.created_at, project.updated_at,
    )

    return project
  }

  async updateProject(id: string, input: UpdateProjectInput): Promise<Project | null> {
    if (!this.ready) return null

    const sets: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(input)) {
      if (['guardrails', 'infrastructure', 'stack'].includes(key)) {
        sets.push(`${key} = ?`)
        params.push(JSON.stringify(value))
      } else if (key === 'claude_md_exists') {
        sets.push(`${key} = ?`)
        params.push(value ? 1 : 0)
      } else {
        sets.push(`${key} = ?`)
        params.push(value ?? null)
      }
    }

    if (sets.length === 0) return this.getProject(id)

    sets.push('updated_at = ?')
    params.push(new Date().toISOString())
    params.push(id)

    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return this.getProject(id)
  }

  async getProject(id: string): Promise<Project | null> {
    if (!this.ready) return null

    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? parseSqliteProject(row) : null
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    if (!this.ready) return null

    const row = this.db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as Record<string, unknown> | undefined
    return row ? parseSqliteProject(row) : null
  }

  // ─── Approval Bundles ──────────────────────────────────────────────────

  async createApprovalBundle(input: Omit<ApprovalBundle, 'id' | 'created_at'>): Promise<ApprovalBundle> {
    const id = randomUUID()
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO approval_bundles (id, project_id, domain, status, summary, proposed_tasks, reasoning, expires_at, resolved_at, resolved_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.project_id, input.domain, input.status, input.summary,
      JSON.stringify(input.proposed_tasks), input.reasoning,
      input.expires_at ?? null, input.resolved_at ?? null, input.resolved_by ?? null, now,
    )

    return {
      id,
      ...input,
      created_at: now,
    }
  }

  async listApprovalBundles(filters?: ApprovalBundleFilters): Promise<ApprovalBundle[]> {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.project_id) {
      conditions.push('project_id = ?')
      params.push(filters.project_id)
    }
    if (filters?.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    }
    if (filters?.domain) {
      conditions.push('domain = ?')
      params.push(filters.domain)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.db.prepare(`
      SELECT * FROM approval_bundles ${where} ORDER BY created_at DESC
    `).all(...params) as Record<string, unknown>[]

    return rows.map(parseSqliteApprovalBundle)
  }

  async updateApprovalBundle(id: string, input: { status: string; resolved_at?: string; resolved_by?: string }): Promise<ApprovalBundle | null> {
    const sets: string[] = ['status = ?']
    const params: unknown[] = [input.status]

    if (input.resolved_at !== undefined) {
      sets.push('resolved_at = ?')
      params.push(input.resolved_at)
    }
    if (input.resolved_by !== undefined) {
      sets.push('resolved_by = ?')
      params.push(input.resolved_by)
    }

    params.push(id)

    this.db.prepare(`UPDATE approval_bundles SET ${sets.join(', ')} WHERE id = ?`).run(...params)

    const row = this.db.prepare('SELECT * FROM approval_bundles WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? parseSqliteApprovalBundle(row) : null
  }

  // ─── Domain Goals ──────────────────────────────────────────────────────

  async listDomainGoals(domain?: string): Promise<DomainGoal[]> {
    const rows = domain
      ? this.db.prepare('SELECT * FROM domain_goals WHERE domain = ? ORDER BY domain').all(domain) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM domain_goals ORDER BY domain').all() as Record<string, unknown>[]
    return rows.map(row => ({
      id: String(row.id),
      domain: String(row.domain),
      statement: String(row.statement),
      current_state: row.current_state ? String(row.current_state) : null,
      state_updates: row.state_updates ? JSON.parse(String(row.state_updates)) : [],
      reviewed_at: String(row.reviewed_at),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }))
  }

  async getDomainGoal(id: string): Promise<DomainGoal | null> {
    const row = this.db.prepare('SELECT * FROM domain_goals WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: String(row.id),
      domain: String(row.domain),
      statement: String(row.statement),
      current_state: row.current_state ? String(row.current_state) : null,
      state_updates: row.state_updates ? JSON.parse(String(row.state_updates)) : [],
      reviewed_at: String(row.reviewed_at),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }
  }

  async updateDomainGoal(id: string, updates: {
    statement?: string
    current_state?: string
    state_updates?: StateUpdate[]
  }): Promise<DomainGoal | null> {
    const now = new Date().toISOString()
    const sets: string[] = ['reviewed_at = ?', 'updated_at = ?']
    const params: unknown[] = [now, now]

    if (updates.statement !== undefined) {
      sets.push('statement = ?')
      params.push(updates.statement)
    }
    if (updates.current_state !== undefined) {
      sets.push('current_state = ?')
      params.push(updates.current_state)
    }
    if (updates.state_updates !== undefined) {
      sets.push('state_updates = ?')
      params.push(JSON.stringify(updates.state_updates))
    }

    params.push(id)
    this.db.prepare(`UPDATE domain_goals SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return this.getDomainGoal(id)
  }

  // ─── Planning Sessions ─────────────────────────────────────────────────────

  async savePlanningSession(record: Omit<PlanningSessionRecord, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID()

    this.db.prepare(`
      INSERT INTO planning_sessions (id, session_id, focus_area, topics_covered, decisions_made, tasks_created, projects_touched, open_questions, next_steps)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, record.session_id, record.focus_area,
      JSON.stringify(record.topics_covered),
      JSON.stringify(record.decisions_made),
      JSON.stringify(record.tasks_created),
      JSON.stringify(record.projects_touched),
      JSON.stringify(record.open_questions),
      JSON.stringify(record.next_steps),
    )

    return id
  }

  async getRecentPlanningSessions(limit = 5): Promise<PlanningSessionRecord[]> {
    if (!this.ready) return []

    const rows = this.db.prepare(`
      SELECT * FROM planning_sessions ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Record<string, unknown>[]

    return rows.map(parseSqlitePlanningSession)
  }

  async getLatestPlanningSession(): Promise<PlanningSessionRecord | null> {
    if (!this.ready) return null

    const row = this.db.prepare(`
      SELECT * FROM planning_sessions ORDER BY created_at DESC LIMIT 1
    `).get() as Record<string, unknown> | undefined

    return row ? parseSqlitePlanningSession(row) : null
  }

  // ─── Briefings ─────────────────────────────────────────────────────────

  async saveBriefing(type: 'morning' | 'closeout' | 'weekly_review' | 'custom', content: string, domain?: string): Promise<string> {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO briefings (id, type, content, domain, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(...[id, type, content, domain ?? null, now])
    return id
  }

  async getLatestBriefing(type?: string): Promise<{
    id: string
    type: string
    domain: string | null
    content: string
    created_at: string
  } | null> {
    if (!this.ready) return null

    if (type) {
      return (this.db.prepare(
        'SELECT id, type, domain, content, created_at FROM briefings WHERE type = ? ORDER BY created_at DESC LIMIT 1'
      ).get(type) as {
        id: string; type: string; domain: string | null; content: string; created_at: string
      } | undefined) ?? null
    }

    return (this.db.prepare(
      'SELECT id, type, domain, content, created_at FROM briefings ORDER BY created_at DESC LIMIT 1'
    ).get() as {
      id: string; type: string; domain: string | null; content: string; created_at: string
    } | undefined) ?? null
  }

  async listBriefings(limit = 10, type?: string): Promise<{
    id: string
    type: string
    domain: string | null
    content: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    if (type) {
      return this.db.prepare(
        'SELECT id, type, domain, content, created_at FROM briefings WHERE type = ? ORDER BY created_at DESC LIMIT ?'
      ).all(type, limit) as {
        id: string; type: string; domain: string | null; content: string; created_at: string
      }[]
    }

    return this.db.prepare(
      'SELECT id, type, domain, content, created_at FROM briefings ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as {
      id: string; type: string; domain: string | null; content: string; created_at: string
    }[]
  }

  // ─── Advisors ──────────────────────────────────────────────────────────

  async listAdvisors(expertise?: string): Promise<Advisor[]> {
    if (!this.ready) return []

    const rows = this.db.prepare(
      'SELECT * FROM advisors ORDER BY name ASC'
    ).all() as (Omit<Advisor, 'expertise'> & { expertise: string })[]

    const parsed = rows.map(parseAdvisorRow)

    if (expertise) {
      return parsed.filter(a => a.expertise.some(e => e.toLowerCase().includes(expertise.toLowerCase())))
    }

    return parsed
  }

  async getAdvisor(id: string): Promise<Advisor | null> {
    if (!this.ready) return null

    const row = this.db.prepare(
      'SELECT * FROM advisors WHERE id = ?'
    ).get(id) as (Omit<Advisor, 'expertise'> & { expertise: string }) | undefined

    return row ? parseAdvisorRow(row) : null
  }

  async getAdvisorByName(name: string): Promise<Advisor | null> {
    if (!this.ready) return null

    const row = this.db.prepare(
      'SELECT * FROM advisors WHERE name = ?'
    ).get(name) as (Omit<Advisor, 'expertise'> & { expertise: string }) | undefined

    return row ? parseAdvisorRow(row) : null
  }

  // ─── Content ───────────────────────────────────────────────────────────

  async listContent(filters?: {
    status?: ContentStatus | ContentStatus[]
    domain?: string
    topic_id?: string
    limit?: number
  }): Promise<ContentPiece[]> {
    if (!this.ready) return []

    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`status IN (${filters.status.map(() => '?').join(',')})`)
        params.push(...filters.status)
      } else {
        conditions.push('status = ?')
        params.push(filters.status)
      }
    }
    if (filters?.domain) {
      conditions.push('domain = ?')
      params.push(filters.domain)
    }
    if (filters?.topic_id) {
      conditions.push('topic_id = ?')
      params.push(filters.topic_id)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters?.limit ? `LIMIT ${filters.limit}` : ''

    const rows = this.db.prepare(`
      SELECT * FROM content ${where}
      ORDER BY created_at DESC ${limit}
    `).all(...params) as Record<string, unknown>[]

    return rows.map(parseSqliteContentRow)
  }

  async createContent(input: {
    domain: string
    title: string
    topic_id?: string
    project_id?: string
    status?: ContentStatus
    platform?: ContentPlatform
    body?: string
    source_material?: { url: string; title: string; summary: string }[]
    created_by?: string
  }): Promise<ContentPiece> {
    const now = new Date().toISOString()
    const id = randomUUID()

    this.db.prepare(`
      INSERT INTO content (id, domain, topic_id, project_id, title, status, platform, body, source_material, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.domain, input.topic_id ?? null, input.project_id ?? null,
      input.title, input.status ?? 'idea', input.platform ?? 'blog',
      input.body ?? null, JSON.stringify(input.source_material ?? []),
      input.created_by ?? 'hughmann', now, now,
    )

    return {
      id, domain: input.domain, topic_id: input.topic_id ?? null,
      project_id: input.project_id ?? null, title: input.title,
      status: input.status ?? 'idea', platform: input.platform ?? 'blog',
      body: input.body ?? null, source_material: input.source_material ?? [],
      scheduled_at: null, published_at: null, published_url: null,
      created_by: input.created_by ?? 'hughmann', created_at: now, updated_at: now,
    }
  }

  async updateContent(id: string, input: {
    title?: string
    status?: ContentStatus
    platform?: ContentPlatform
    body?: string
    topic_id?: string
    project_id?: string
    source_material?: { url: string; title: string; summary: string }[]
    scheduled_at?: string
    published_at?: string
    published_url?: string
  }): Promise<ContentPiece | null> {
    if (!this.ready) return null

    const sets: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(input)) {
      if (key === 'source_material') {
        sets.push(`${key} = ?`)
        params.push(JSON.stringify(value))
      } else {
        sets.push(`${key} = ?`)
        params.push(value ?? null)
      }
    }

    if (sets.length === 0) return this.getContent(id)

    sets.push('updated_at = ?')
    params.push(new Date().toISOString())
    params.push(id)

    this.db.prepare(`UPDATE content SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return this.getContent(id)
  }

  async getContent(id: string): Promise<ContentPiece | null> {
    if (!this.ready) return null

    const row = this.db.prepare('SELECT * FROM content WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? parseSqliteContentRow(row) : null
  }

  // ─── Topics ───────────────────────────────────────────────────────────

  async listTopics(filters?: { domain?: string; active?: boolean }): Promise<Topic[]> {
    if (!this.ready) return []

    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.domain) {
      conditions.push('domain = ?')
      params.push(filters.domain)
    }
    if (filters?.active !== undefined) {
      conditions.push('active = ?')
      params.push(filters.active ? 1 : 0)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.db.prepare(`
      SELECT * FROM topics ${where} ORDER BY name ASC
    `).all(...params) as Record<string, unknown>[]

    return rows.map(row => ({
      id: String(row.id),
      domain: String(row.domain),
      name: String(row.name),
      description: row.description != null ? String(row.description) : null,
      active: row.active === 1 || row.active === true,
      created_at: String(row.created_at),
    }))
  }

  async createTopic(input: { domain: string; name: string; description?: string }): Promise<Topic> {
    const now = new Date().toISOString()
    const id = randomUUID()

    this.db.prepare(`
      INSERT INTO topics (id, domain, name, description, active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, input.domain, input.name, input.description ?? null, now)

    return {
      id, domain: input.domain, name: input.name,
      description: input.description ?? null, active: true, created_at: now,
    }
  }

  async updateTopic(id: string, input: { name?: string; description?: string; active?: boolean }): Promise<Topic | null> {
    if (!this.ready) return null

    const sets: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(input)) {
      if (key === 'active') {
        sets.push(`${key} = ?`)
        params.push(value ? 1 : 0)
      } else {
        sets.push(`${key} = ?`)
        params.push(value ?? null)
      }
    }

    if (sets.length === 0) return null
    params.push(id)

    this.db.prepare(`UPDATE topics SET ${sets.join(', ')} WHERE id = ?`).run(...params)

    const row = this.db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: String(row.id), domain: String(row.domain), name: String(row.name),
      description: row.description != null ? String(row.description) : null,
      active: row.active === 1 || row.active === true, created_at: String(row.created_at),
    }
  }

  // ─── Content Sources ──────────────────────────────────────────────────

  async listContentSources(filters?: { domain?: string; active?: boolean; type?: ContentSourceType }): Promise<ContentSource[]> {
    if (!this.ready) return []

    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.domain) {
      conditions.push('domain = ?')
      params.push(filters.domain)
    }
    if (filters?.active !== undefined) {
      conditions.push('active = ?')
      params.push(filters.active ? 1 : 0)
    }
    if (filters?.type) {
      conditions.push('type = ?')
      params.push(filters.type)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.db.prepare(`
      SELECT * FROM content_sources ${where} ORDER BY name ASC
    `).all(...params) as Record<string, unknown>[]

    return rows.map(row => ({
      id: String(row.id), domain: String(row.domain), name: String(row.name),
      type: String(row.type) as ContentSourceType, url: row.url != null ? String(row.url) : null,
      active: row.active === 1 || row.active === true, created_at: String(row.created_at),
    }))
  }

  async createContentSource(input: { domain: string; name: string; type?: ContentSourceType; url?: string }): Promise<ContentSource> {
    const now = new Date().toISOString()
    const id = randomUUID()

    this.db.prepare(`
      INSERT INTO content_sources (id, domain, name, type, url, active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(id, input.domain, input.name, input.type ?? 'manual', input.url ?? null, now)

    return {
      id, domain: input.domain, name: input.name,
      type: input.type ?? 'manual', url: input.url ?? null,
      active: true, created_at: now,
    }
  }

  async updateContentSource(id: string, input: { name?: string; url?: string; active?: boolean }): Promise<ContentSource | null> {
    if (!this.ready) return null

    const sets: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(input)) {
      if (key === 'active') {
        sets.push(`${key} = ?`)
        params.push(value ? 1 : 0)
      } else {
        sets.push(`${key} = ?`)
        params.push(value ?? null)
      }
    }

    if (sets.length === 0) return null
    params.push(id)

    this.db.prepare(`UPDATE content_sources SET ${sets.join(', ')} WHERE id = ?`).run(...params)

    const row = this.db.prepare('SELECT * FROM content_sources WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: String(row.id), domain: String(row.domain), name: String(row.name),
      type: String(row.type) as ContentSourceType, url: row.url != null ? String(row.url) : null,
      active: row.active === 1 || row.active === true, created_at: String(row.created_at),
    }
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

    this.db.prepare(`
      INSERT INTO feedback (category, signal, content, context, domain)
      VALUES (?, ?, ?, ?, ?)
    `).run(entry.category, entry.signal, entry.content, entry.context ?? null, entry.domain ?? null)
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

    const conditions: string[] = []
    const params: unknown[] = []

    if (options?.domain) {
      conditions.push('domain = ?')
      params.push(options.domain)
    }
    if (options?.category) {
      conditions.push('category = ?')
      params.push(options.category)
    }
    if (options?.since) {
      conditions.push('created_at >= ?')
      params.push(options.since)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = options?.limit ?? 50

    return this.db.prepare(`
      SELECT category, signal, content, domain, created_at
      FROM feedback ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit) as {
      category: string
      signal: string
      content: string
      domain: string | null
      created_at: string
    }[]
  }

  // ─── Calendar Events ─────────────────────────────────────────────────

  async listCalendarEvents(startDate: string, endDate: string, domain?: string): Promise<CalendarEvent[]> {
    if (!this.ready) return []
    const params: string[] = [startDate, endDate]
    let sql = 'SELECT * FROM calendar_events WHERE start_time >= ? AND start_time <= ?'
    if (domain) { sql += ' AND domain = ?'; params.push(domain) }
    sql += ' ORDER BY start_time ASC'
    return this.db.prepare(sql).all(...params) as CalendarEvent[]
  }

  async upsertCalendarEvent(event: Partial<CalendarEvent>): Promise<CalendarEvent> {
    if (!this.ready) throw new Error('SQLite adapter not initialized')
    const id = event.id || randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO calendar_events (id, title, start_time, end_time, location, attendees, calendar_name, domain, source, external_id, notes, customer_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id, source) DO UPDATE SET
        title = excluded.title, start_time = excluded.start_time, end_time = excluded.end_time,
        location = excluded.location, attendees = excluded.attendees, notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(...[id, event.title ?? '', event.start_time ?? '', event.end_time ?? '', event.location ?? null,
      JSON.stringify(event.attendees ?? []), event.calendar_name ?? null, event.domain ?? null,
      event.source ?? 'manual', event.external_id ?? null, event.notes ?? null,
      event.customer_id ?? null, now, now])
    return { ...event, id, source: event.source ?? 'manual', created_at: now, updated_at: now } as CalendarEvent
  }
}

/** Parse a SQLite row into a typed ApprovalBundle */
function parseSqliteApprovalBundle(row: Record<string, unknown>): ApprovalBundle {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    domain: String(row.domain),
    status: String(row.status) as ApprovalBundle['status'],
    summary: String(row.summary),
    proposed_tasks: JSON.parse(String(row.proposed_tasks ?? '[]')),
    reasoning: String(row.reasoning),
    expires_at: row.expires_at != null ? String(row.expires_at) : null,
    resolved_at: row.resolved_at != null ? String(row.resolved_at) : null,
    resolved_by: row.resolved_by != null ? String(row.resolved_by) : null,
    created_at: String(row.created_at),
  }
}

/** Parse a SQLite row into a typed Project (JSON-encoded arrays) */
function parseSqliteProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: row.description != null ? String(row.description) : null,
    domain: String(row.domain ?? ''),
    status: String(row.status) as Project['status'],
    priority: Number(row.priority),
    domain_goal_id: row.domain_goal_id != null ? String(row.domain_goal_id) : null,
    north_star: row.north_star != null ? String(row.north_star) : null,
    guardrails: JSON.parse(String(row.guardrails ?? '[]')),
    infrastructure: JSON.parse(String(row.infrastructure ?? '{}')),
    refinement_cadence: (row.refinement_cadence as Project['refinement_cadence']) ?? 'weekly',
    last_refinement_at: row.last_refinement_at != null ? String(row.last_refinement_at) : null,
    approval_mode: (row.approval_mode as Project['approval_mode']) ?? 'required',
    local_path: row.local_path != null ? String(row.local_path) : null,
    stack: JSON.parse(String(row.stack ?? '[]')),
    claude_md_exists: Boolean(row.claude_md_exists),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function parseSqlitePlanningSession(row: Record<string, unknown>): PlanningSessionRecord {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    focus_area: String(row.focus_area),
    topics_covered: JSON.parse(String(row.topics_covered ?? '[]')),
    decisions_made: JSON.parse(String(row.decisions_made ?? '[]')),
    tasks_created: JSON.parse(String(row.tasks_created ?? '[]')),
    projects_touched: JSON.parse(String(row.projects_touched ?? '[]')),
    open_questions: JSON.parse(String(row.open_questions ?? '[]')),
    next_steps: JSON.parse(String(row.next_steps ?? '[]')),
    created_at: String(row.created_at),
  }
}

function parseAdvisorRow(row: Omit<Advisor, 'expertise'> & { expertise: string }): Advisor {
  return {
    ...row,
    expertise: JSON.parse(row.expertise ?? '[]') as string[],
  }
}

function parseSqliteContentRow(row: Record<string, unknown>): ContentPiece {
  return {
    id: String(row.id),
    domain: String(row.domain),
    topic_id: row.topic_id != null ? String(row.topic_id) : null,
    project_id: row.project_id != null ? String(row.project_id) : null,
    title: String(row.title),
    status: String(row.status) as ContentStatus,
    platform: String(row.platform) as ContentPlatform,
    body: row.body != null ? String(row.body) : null,
    source_material: JSON.parse(String(row.source_material ?? '[]')),
    scheduled_at: row.scheduled_at != null ? String(row.scheduled_at) : null,
    published_at: row.published_at != null ? String(row.published_at) : null,
    published_url: row.published_url != null ? String(row.published_url) : null,
    created_by: String(row.created_by ?? 'hughmann'),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}
