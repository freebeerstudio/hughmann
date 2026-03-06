import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { DataAdapter } from './types.js'
import type { Task, TaskFilters, CreateTaskInput, UpdateTaskInput } from '../../types/tasks.js'
import type { Project, ProjectFilters, CreateProjectInput, UpdateProjectInput, PlanningSessionRecord, Milestone, ProjectStatus } from '../../types/projects.js'

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

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'blocked')),
  task_type TEXT NOT NULL DEFAULT 'STANDARD' CHECK (task_type IN ('MUST', 'MIT', 'BIG_ROCK', 'STANDARD')),
  domain TEXT,
  project TEXT,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
  due_date TEXT,
  cwd TEXT,
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
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'paused', 'completed', 'archived')),
  goals TEXT NOT NULL DEFAULT '[]',
  quarterly_goal TEXT,
  milestones TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects (domain);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug);

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
    if (filters?.project) {
      conditions.push('project = ?')
      params.push(filters.project)
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

    this.db.prepare(`
      INSERT INTO tasks (id, title, description, status, task_type, domain, project, priority, due_date, cwd, created_at, updated_at, completed_at, completion_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.title, task.description, task.status, task.task_type,
      task.domain, task.project, task.priority, task.due_date, task.cwd,
      task.created_at, task.updated_at, task.completed_at, task.completion_notes,
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
    return row ? { ...row, project_id: (row.project_id as string | null) ?? null } : null
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
    const milestones: Milestone[] = (input.milestones ?? []).map(m => ({
      id: randomUUID(),
      title: m.title,
      target_date: m.target_date ?? null,
      completed: false,
      completed_at: null,
    }))

    const project: Project = {
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

    this.db.prepare(`
      INSERT INTO projects (id, name, slug, description, domain, status, goals, quarterly_goal, milestones, priority, created_at, updated_at, completed_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.name, project.slug, project.description, project.domain,
      project.status, JSON.stringify(project.goals), project.quarterly_goal,
      JSON.stringify(project.milestones), project.priority,
      project.created_at, project.updated_at, project.completed_at,
      JSON.stringify(project.metadata),
    )

    return project
  }

  async updateProject(id: string, input: UpdateProjectInput): Promise<Project | null> {
    if (!this.ready) return null

    const sets: string[] = []
    const params: unknown[] = []

    for (const [key, value] of Object.entries(input)) {
      if (['goals', 'milestones', 'metadata'].includes(key)) {
        sets.push(`${key} = ?`)
        params.push(JSON.stringify(value))
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
}

/** Parse a SQLite row into a typed Project (JSON-encoded arrays) */
function parseSqliteProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: row.description != null ? String(row.description) : null,
    domain: row.domain != null ? String(row.domain) : null,
    status: String(row.status) as ProjectStatus,
    goals: JSON.parse(String(row.goals ?? '[]')),
    quarterly_goal: row.quarterly_goal != null ? String(row.quarterly_goal) : null,
    milestones: JSON.parse(String(row.milestones ?? '[]')),
    priority: Number(row.priority),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    metadata: JSON.parse(String(row.metadata ?? '{}')),
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
