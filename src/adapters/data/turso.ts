import { createClient, type Client } from '@libsql/client'
import { randomUUID } from 'node:crypto'
import type { DataAdapter, CalendarEvent } from './types.js'
import { cosineSimilarity } from '../../util/math.js'
import type { Task, TaskFilters, CreateTaskInput, UpdateTaskInput } from '../../types/tasks.js'
import type { Project, ProjectFilters, CreateProjectInput, UpdateProjectInput, PlanningSessionRecord, ProjectStatus, DomainGoal, ApprovalBundle, ApprovalBundleFilters, StateUpdate } from '../../types/projects.js'
import type { Advisor } from '../../types/advisors.js'
import type { ContentPiece, Topic, ContentSource, ContentStatus, ContentPlatform, ContentSourceType } from '../../types/content.js'

/**
 * Schema SQL for Turso (identical to SQLite).
 * Split into individual statements for batch execution.
 */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Untitled',
    domain TEXT,
    messages TEXT NOT NULL DEFAULT '[]',
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions (updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_domain ON sessions (domain)`,

  `CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(id),
    domain TEXT,
    content TEXT NOT NULL,
    memory_date TEXT NOT NULL DEFAULT (date('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memories_date ON memories (memory_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories (domain)`,

  `CREATE TABLE IF NOT EXISTS memory_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id INTEGER,
    content TEXT NOT NULL,
    domain TEXT,
    embedding TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_embeddings_domain ON memory_embeddings (domain)`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'blocked')),
    task_type TEXT NOT NULL DEFAULT 'standard' CHECK (task_type IN ('must', 'mit', 'big_rock', 'standard')),
    domain TEXT,
    project_id TEXT,
    sprint TEXT,
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
    assignee TEXT,
    assigned_agent_id TEXT,
    blocked_reason TEXT,
    due_date TEXT,
    cwd TEXT,
    completion_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks (domain)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks (task_type)`,

  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'incubator', 'active', 'paused', 'completed', 'archived')),
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects (domain)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug)`,

  `CREATE TABLE IF NOT EXISTS approval_bundles (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_approval_bundles_project ON approval_bundles (project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_bundles_status ON approval_bundles (status)`,

  `CREATE TABLE IF NOT EXISTS planning_sessions (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_planning_sessions_created ON planning_sessions (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS briefings (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('morning', 'closeout', 'weekly_review', 'custom')),
    domain TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_briefings_type ON briefings (type)`,
  `CREATE INDEX IF NOT EXISTS idx_briefings_created ON briefings (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS advisors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT,
    expertise TEXT NOT NULL DEFAULT '[]',
    system_prompt TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_advisors_name ON advisors (name)`,

  `CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_topics_domain ON topics (domain)`,
  `CREATE INDEX IF NOT EXISTS idx_topics_active ON topics (active)`,

  `CREATE TABLE IF NOT EXISTS content_sources (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'rss' CHECK (type IN ('rss', 'youtube', 'newsletter', 'manual')),
    url TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_content_sources_domain ON content_sources (domain)`,
  `CREATE INDEX IF NOT EXISTS idx_content_sources_active ON content_sources (active)`,

  `CREATE TABLE IF NOT EXISTS content (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_content_status ON content (status)`,
  `CREATE INDEX IF NOT EXISTS idx_content_domain ON content (domain)`,
  `CREATE INDEX IF NOT EXISTS idx_content_topic ON content (topic_id)`,

  `CREATE TABLE IF NOT EXISTS domain_goals (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    statement TEXT NOT NULL,
    current_state TEXT,
    state_updates TEXT DEFAULT '[]',
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_domain_goals_domain ON domain_goals (domain)`,

  `CREATE TABLE IF NOT EXISTS calendar_events (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_calendar_events_time ON calendar_events(start_time, end_time)`,
  `CREATE INDEX IF NOT EXISTS idx_calendar_events_domain ON calendar_events(domain)`,
  `CREATE INDEX IF NOT EXISTS idx_calendar_events_customer ON calendar_events(customer_id)`,
]

export interface TursoConfig {
  url: string
  authToken: string
}

/**
 * Turso data adapter using @libsql/client.
 * Cloud SQLite with edge replication via libSQL.
 * Schema identical to local SQLite adapter.
 */
export class TursoAdapter implements DataAdapter {
  private client: Client
  private ready = false

  constructor(config: TursoConfig) {
    this.client = createClient({
      url: config.url,
      authToken: config.authToken,
    })
  }

  async init(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.batch(SCHEMA_STATEMENTS)

      // Verify tables
      const result = await this.client.execute({
        sql: `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','memories','tasks','projects','briefings','advisors')`,
        args: [],
      })
      if (result.rows.length < 6) {
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

    await this.client.execute({
      sql: `INSERT INTO sessions (id, title, domain, messages, message_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              domain = excluded.domain,
              messages = excluded.messages,
              message_count = excluded.message_count,
              updated_at = excluded.updated_at`,
      args: [
        session.id,
        session.title,
        session.domain,
        JSON.stringify(session.messages),
        session.messages.length,
        session.createdAt,
        session.updatedAt,
      ],
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

    const result = await this.client.execute({
      sql: `SELECT id, title, domain, message_count, created_at, updated_at
            FROM sessions ORDER BY updated_at DESC LIMIT ?`,
      args: [limit],
    })

    return result.rows.map(row => ({
      id: String(row.id),
      title: String(row.title),
      domain: row.domain != null ? String(row.domain) : null,
      message_count: Number(row.message_count),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }))
  }

  async getSession(id: string): Promise<{
    id: string
    title: string
    domain: string | null
    messages: { role: string; content: string; timestamp: string }[]
  } | null> {
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM sessions WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    const row = result.rows[0]
    return {
      id: String(row.id),
      title: String(row.title),
      domain: row.domain != null ? String(row.domain) : null,
      messages: JSON.parse(String(row.messages)),
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

    await this.client.execute({
      sql: `INSERT INTO memories (session_id, domain, content, memory_date)
            VALUES (?, ?, ?, ?)`,
      args: [entry.sessionId, entry.domain, entry.content, entry.date],
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
    const sinceStr = since.toISOString().split('T')[0]

    let result
    if (domain) {
      if (Array.isArray(domain)) {
        const placeholders = domain.map(() => '?').join(',')
        result = await this.client.execute({
          sql: `SELECT content, domain, memory_date, created_at
                FROM memories WHERE memory_date >= ? AND domain IN (${placeholders})
                ORDER BY created_at DESC`,
          args: [sinceStr, ...domain],
        })
      } else {
        result = await this.client.execute({
          sql: `SELECT content, domain, memory_date, created_at
                FROM memories WHERE memory_date >= ? AND domain = ?
                ORDER BY created_at DESC`,
          args: [sinceStr, domain],
        })
      }
    } else {
      result = await this.client.execute({
        sql: `SELECT content, domain, memory_date, created_at
              FROM memories WHERE memory_date >= ?
              ORDER BY created_at DESC`,
        args: [sinceStr],
      })
    }

    return result.rows.map(row => ({
      content: String(row.content),
      domain: row.domain != null ? String(row.domain) : null,
      memory_date: String(row.memory_date),
      created_at: String(row.created_at),
    }))
  }

  // ─── Vector Memory ─────────────────────────────────────────────────────
  //
  // Turso (libSQL) doesn't have native vector operations, so we store embeddings
  // as JSON arrays and do brute-force cosine similarity in JS.
  // Same approach as the local SQLite adapter.

  async saveMemoryEmbedding(entry: {
    memoryId: number
    content: string
    domain: string | null
    embedding: number[]
  }): Promise<void> {
    if (!this.ready) return

    await this.client.execute({
      sql: `INSERT INTO memory_embeddings (memory_id, content, domain, embedding)
            VALUES (?, ?, ?, ?)`,
      args: [entry.memoryId, entry.content, entry.domain, JSON.stringify(entry.embedding)],
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

    // Use batch for transaction-like behavior
    const results = await this.client.batch([
      {
        sql: `INSERT INTO memories (session_id, domain, content, memory_date)
              VALUES (?, ?, ?, ?)`,
        args: [entry.sessionId, entry.domain, entry.content, entry.date],
      },
    ])

    const memoryId = Number(results[0].lastInsertRowid)

    await this.client.execute({
      sql: `INSERT INTO memory_embeddings (memory_id, content, domain, embedding)
            VALUES (?, ?, ?, ?)`,
      args: [memoryId, entry.content, entry.domain, JSON.stringify(entry.embedding)],
    })

    return memoryId
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
    const result = options?.domain
      ? await this.client.execute({
          sql: `SELECT me.content, me.domain, me.embedding, m.memory_date
                FROM memory_embeddings me
                LEFT JOIN memories m ON m.id = me.memory_id
                WHERE me.domain = ?`,
          args: [options.domain],
        })
      : await this.client.execute({
          sql: `SELECT me.content, me.domain, me.embedding, m.memory_date
                FROM memory_embeddings me
                LEFT JOIN memories m ON m.id = me.memory_id`,
          args: [],
        })

    // Compute cosine similarity in JS
    const results = (result.rows ?? [])
      .map(row => {
        const emb = JSON.parse(String(row.embedding)) as number[]
        const sim = cosineSimilarity(queryEmbedding, emb)
        return {
          content: String(row.content),
          domain: row.domain != null ? String(row.domain) : null,
          similarity: sim,
          memory_date: row.memory_date ? String(row.memory_date) : new Date().toISOString().split('T')[0],
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

    const result = await this.client.execute({
      sql: `SELECT * FROM tasks ${where} ORDER BY priority ASC, created_at ASC ${limit}`,
      args: params as (string | number | null)[],
    })

    return result.rows.map(parseTursoTask)
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
      sprint: input.sprint ?? null,
      priority: input.priority ?? 3,
      assignee: input.assignee ?? null,
      assigned_agent_id: input.assigned_agent_id ?? null,
      blocked_reason: input.blocked_reason ?? null,
      due_date: input.due_date ?? null,
      cwd: input.cwd ?? null,
      completion_notes: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    }

    await this.client.execute({
      sql: `INSERT INTO tasks (id, title, description, status, task_type, domain, project_id, sprint, priority, assignee, assigned_agent_id, blocked_reason, due_date, cwd, completion_notes, created_at, updated_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        task.id, task.title, task.description, task.status, task.task_type,
        task.domain, task.project_id, task.sprint, task.priority,
        task.assignee, task.assigned_agent_id, task.blocked_reason,
        task.due_date, task.cwd, task.completion_notes,
        task.created_at, task.updated_at, task.completed_at,
      ],
    })

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

    await this.client.execute({
      sql: `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`,
      args: params as (string | number | null)[],
    })

    return this.getTask(id)
  }

  async completeTask(id: string, notes?: string): Promise<Task | null> {
    if (!this.ready) return null

    const now = new Date().toISOString()
    await this.client.execute({
      sql: `UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?, completion_notes = ? WHERE id = ?`,
      args: [now, now, notes ?? null, id],
    })

    return this.getTask(id)
  }

  async getTask(id: string): Promise<Task | null> {
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM tasks WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    return parseTursoTask(result.rows[0])
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

    const result = await this.client.execute({
      sql: `SELECT * FROM projects ${where} ORDER BY priority ASC, created_at ASC ${limit}`,
      args: params as (string | number | null)[],
    })

    return result.rows.map(parseTursoProject)
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

    await this.client.execute({
      sql: `INSERT INTO projects (id, name, slug, description, domain, status, priority, domain_goal_id, north_star, guardrails, infrastructure, refinement_cadence, approval_mode, local_path, stack, claude_md_exists, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        project.id, project.name, project.slug, project.description, project.domain,
        project.status, project.priority, project.domain_goal_id,
        project.north_star, JSON.stringify(project.guardrails),
        JSON.stringify(project.infrastructure), project.refinement_cadence,
        project.approval_mode, project.local_path,
        JSON.stringify(project.stack), project.claude_md_exists ? 1 : 0,
        project.created_at, project.updated_at,
      ],
    })

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

    await this.client.execute({
      sql: `UPDATE projects SET ${sets.join(', ')} WHERE id = ?`,
      args: params as (string | number | null)[],
    })

    return this.getProject(id)
  }

  async getProject(id: string): Promise<Project | null> {
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM projects WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    return parseTursoProject(result.rows[0])
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM projects WHERE slug = ?',
      args: [slug],
    })

    if (result.rows.length === 0) return null
    return parseTursoProject(result.rows[0])
  }

  // ─── Approval Bundles ──────────────────────────────────────────────────

  async createApprovalBundle(input: Omit<ApprovalBundle, 'id' | 'created_at'>): Promise<ApprovalBundle> {
    const id = randomUUID()
    const now = new Date().toISOString()

    await this.client.execute({
      sql: `INSERT INTO approval_bundles (id, project_id, domain, status, summary, proposed_tasks, reasoning, expires_at, resolved_at, resolved_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, input.project_id, input.domain, input.status, input.summary,
        JSON.stringify(input.proposed_tasks), input.reasoning,
        input.expires_at ?? null, input.resolved_at ?? null, input.resolved_by ?? null, now,
      ],
    })

    return {
      id,
      ...input,
      created_at: now,
    }
  }

  async listApprovalBundles(filters?: ApprovalBundleFilters): Promise<ApprovalBundle[]> {
    const conditions: string[] = []
    const params: (string | number | null)[] = []

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

    const result = await this.client.execute({
      sql: `SELECT * FROM approval_bundles ${where} ORDER BY created_at DESC`,
      args: params,
    })

    return result.rows.map(parseTursoApprovalBundle)
  }

  async updateApprovalBundle(id: string, input: { status: string; resolved_at?: string; resolved_by?: string }): Promise<ApprovalBundle | null> {
    const sets: string[] = ['status = ?']
    const params: (string | number | null)[] = [input.status]

    if (input.resolved_at !== undefined) {
      sets.push('resolved_at = ?')
      params.push(input.resolved_at ?? null)
    }
    if (input.resolved_by !== undefined) {
      sets.push('resolved_by = ?')
      params.push(input.resolved_by ?? null)
    }

    params.push(id)

    await this.client.execute({
      sql: `UPDATE approval_bundles SET ${sets.join(', ')} WHERE id = ?`,
      args: params,
    })

    const result = await this.client.execute({
      sql: 'SELECT * FROM approval_bundles WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    return parseTursoApprovalBundle(result.rows[0])
  }

  // ─── Domain Goals ──────────────────────────────────────────────────────

  async listDomainGoals(domain?: string): Promise<DomainGoal[]> {
    if (!this.ready) return []

    const result = domain
      ? await this.client.execute({
          sql: 'SELECT * FROM domain_goals WHERE domain = ? ORDER BY domain',
          args: [domain],
        })
      : await this.client.execute({
          sql: 'SELECT * FROM domain_goals ORDER BY domain',
          args: [],
        })

    return result.rows.map(row => ({
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
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM domain_goals WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    const row = result.rows[0]
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
    if (!this.ready) return null

    const now = new Date().toISOString()
    const sets: string[] = ['reviewed_at = ?', 'updated_at = ?']
    const params: (string | null)[] = [now, now]

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
    await this.client.execute({
      sql: `UPDATE domain_goals SET ${sets.join(', ')} WHERE id = ?`,
      args: params,
    })

    return this.getDomainGoal(id)
  }

  // ─── Planning Sessions ─────────────────────────────────────────────────────

  async savePlanningSession(record: Omit<PlanningSessionRecord, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID()

    await this.client.execute({
      sql: `INSERT INTO planning_sessions (id, session_id, focus_area, topics_covered, decisions_made, tasks_created, projects_touched, open_questions, next_steps)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, record.session_id ?? '', record.focus_area,
        JSON.stringify(record.topics_covered),
        JSON.stringify(record.decisions_made),
        JSON.stringify(record.tasks_created ?? []),
        JSON.stringify(record.projects_touched ?? []),
        JSON.stringify(record.open_questions ?? []),
        JSON.stringify(record.next_steps ?? []),
      ],
    })

    return id
  }

  async getRecentPlanningSessions(limit = 5): Promise<PlanningSessionRecord[]> {
    if (!this.ready) return []

    const result = await this.client.execute({
      sql: 'SELECT * FROM planning_sessions ORDER BY created_at DESC LIMIT ?',
      args: [limit],
    })

    return result.rows.map(parseTursoPlanningSession)
  }

  async getLatestPlanningSession(): Promise<PlanningSessionRecord | null> {
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM planning_sessions ORDER BY created_at DESC LIMIT 1',
      args: [],
    })

    if (result.rows.length === 0) return null
    return parseTursoPlanningSession(result.rows[0])
  }

  // ─── Briefings ────────────────────────────────────────────────────────────

  async saveBriefing(type: 'morning' | 'closeout' | 'weekly_review' | 'custom', content: string, domain?: string): Promise<string> {
    const id = randomUUID()

    await this.client.execute({
      sql: `INSERT INTO briefings (id, type, domain, content) VALUES (?, ?, ?, ?)`,
      args: [id, type, domain ?? null, content],
    })

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

    const result = type
      ? await this.client.execute({
          sql: 'SELECT * FROM briefings WHERE type = ? ORDER BY created_at DESC LIMIT 1',
          args: [type],
        })
      : await this.client.execute({
          sql: 'SELECT * FROM briefings ORDER BY created_at DESC LIMIT 1',
          args: [],
        })

    if (result.rows.length === 0) return null
    const row = result.rows[0]
    return {
      id: String(row.id),
      type: String(row.type),
      domain: row.domain != null ? String(row.domain) : null,
      content: String(row.content),
      created_at: String(row.created_at),
    }
  }

  async listBriefings(limit = 10, type?: string): Promise<{
    id: string
    type: string
    domain: string | null
    content: string
    created_at: string
  }[]> {
    if (!this.ready) return []

    const result = type
      ? await this.client.execute({
          sql: 'SELECT * FROM briefings WHERE type = ? ORDER BY created_at DESC LIMIT ?',
          args: [type, limit],
        })
      : await this.client.execute({
          sql: 'SELECT * FROM briefings ORDER BY created_at DESC LIMIT ?',
          args: [limit],
        })

    return result.rows.map(row => ({
      id: String(row.id),
      type: String(row.type),
      domain: row.domain != null ? String(row.domain) : null,
      content: String(row.content),
      created_at: String(row.created_at),
    }))
  }

  // ─── Advisors ─────────────────────────────────────────────────────────────

  async listAdvisors(expertise?: string): Promise<Advisor[]> {
    if (!this.ready) return []

    const result = await this.client.execute({
      sql: 'SELECT * FROM advisors ORDER BY name ASC',
      args: [],
    })

    let advisors = result.rows.map(parseTursoAdvisor)
    if (expertise) {
      advisors = advisors.filter(a => a.expertise.some(e => e.toLowerCase().includes(expertise.toLowerCase())))
    }
    return advisors
  }

  async getAdvisor(id: string): Promise<Advisor | null> {
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM advisors WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    return parseTursoAdvisor(result.rows[0])
  }

  async getAdvisorByName(name: string): Promise<Advisor | null> {
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM advisors WHERE name = ?',
      args: [name],
    })

    if (result.rows.length === 0) return null
    return parseTursoAdvisor(result.rows[0])
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
    const params: (string | number)[] = []

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

    const result = await this.client.execute({
      sql: `SELECT * FROM content ${where} ORDER BY created_at DESC ${limit}`,
      args: params,
    })

    return result.rows.map(parseTursoContentRow)
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

    await this.client.execute({
      sql: `INSERT INTO content (id, domain, topic_id, project_id, title, status, platform, body, source_material, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, input.domain, input.topic_id ?? null, input.project_id ?? null,
        input.title, input.status ?? 'idea', input.platform ?? 'blog',
        input.body ?? null, JSON.stringify(input.source_material ?? []),
        input.created_by ?? 'hughmann', now, now,
      ],
    })

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

    await this.client.execute({
      sql: `UPDATE content SET ${sets.join(', ')} WHERE id = ?`,
      args: params as (string | number | null)[],
    })

    return this.getContent(id)
  }

  async getContent(id: string): Promise<ContentPiece | null> {
    if (!this.ready) return null

    const result = await this.client.execute({
      sql: 'SELECT * FROM content WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    return parseTursoContentRow(result.rows[0])
  }

  // ─── Topics ───────────────────────────────────────────────────────────

  async listTopics(filters?: { domain?: string; active?: boolean }): Promise<Topic[]> {
    if (!this.ready) return []

    const conditions: string[] = []
    const params: (string | number)[] = []

    if (filters?.domain) {
      conditions.push('domain = ?')
      params.push(filters.domain)
    }
    if (filters?.active !== undefined) {
      conditions.push('active = ?')
      params.push(filters.active ? 1 : 0)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const result = await this.client.execute({
      sql: `SELECT * FROM topics ${where} ORDER BY name ASC`,
      args: params,
    })

    return result.rows.map(row => ({
      id: String(row.id),
      domain: String(row.domain),
      name: String(row.name),
      description: row.description != null ? String(row.description) : null,
      active: row.active === 1,
      created_at: String(row.created_at),
    }))
  }

  async createTopic(input: { domain: string; name: string; description?: string }): Promise<Topic> {
    const now = new Date().toISOString()
    const id = randomUUID()

    await this.client.execute({
      sql: `INSERT INTO topics (id, domain, name, description, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      args: [id, input.domain, input.name, input.description ?? null, now],
    })

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

    await this.client.execute({
      sql: `UPDATE topics SET ${sets.join(', ')} WHERE id = ?`,
      args: params as (string | number | null)[],
    })

    const result = await this.client.execute({
      sql: 'SELECT * FROM topics WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    const row = result.rows[0]
    return {
      id: String(row.id), domain: String(row.domain), name: String(row.name),
      description: row.description != null ? String(row.description) : null,
      active: row.active === 1, created_at: String(row.created_at),
    }
  }

  // ─── Content Sources ──────────────────────────────────────────────────

  async listContentSources(filters?: { domain?: string; active?: boolean; type?: ContentSourceType }): Promise<ContentSource[]> {
    if (!this.ready) return []

    const conditions: string[] = []
    const params: (string | number)[] = []

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

    const result = await this.client.execute({
      sql: `SELECT * FROM content_sources ${where} ORDER BY name ASC`,
      args: params,
    })

    return result.rows.map(row => ({
      id: String(row.id), domain: String(row.domain), name: String(row.name),
      type: String(row.type) as ContentSourceType, url: row.url != null ? String(row.url) : null,
      active: row.active === 1, created_at: String(row.created_at),
    }))
  }

  async createContentSource(input: { domain: string; name: string; type?: ContentSourceType; url?: string }): Promise<ContentSource> {
    const now = new Date().toISOString()
    const id = randomUUID()

    await this.client.execute({
      sql: `INSERT INTO content_sources (id, domain, name, type, url, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`,
      args: [id, input.domain, input.name, input.type ?? 'manual', input.url ?? null, now],
    })

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

    await this.client.execute({
      sql: `UPDATE content_sources SET ${sets.join(', ')} WHERE id = ?`,
      args: params as (string | number | null)[],
    })

    const result = await this.client.execute({
      sql: 'SELECT * FROM content_sources WHERE id = ?',
      args: [id],
    })

    if (result.rows.length === 0) return null
    const row = result.rows[0]
    return {
      id: String(row.id), domain: String(row.domain), name: String(row.name),
      type: String(row.type) as ContentSourceType, url: row.url != null ? String(row.url) : null,
      active: row.active === 1, created_at: String(row.created_at),
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
    await this.client.execute({
      sql: 'INSERT INTO feedback (category, signal, content, context, domain) VALUES (?, ?, ?, ?, ?)',
      args: [entry.category, entry.signal, entry.content, entry.context ?? null, entry.domain ?? null],
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
    const conditions: string[] = []
    const args: (string | number)[] = []
    if (options?.domain) { conditions.push('domain = ?'); args.push(options.domain) }
    if (options?.category) { conditions.push('category = ?'); args.push(options.category) }
    if (options?.since) { conditions.push('created_at >= ?'); args.push(options.since) }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = options?.limit ?? 50
    const result = await this.client.execute({
      sql: `SELECT category, signal, content, domain, created_at FROM feedback ${where} ORDER BY created_at DESC LIMIT ?`,
      args: [...args, limit],
    })
    return result.rows.map(r => ({
      category: String(r.category),
      signal: String(r.signal),
      content: String(r.content),
      domain: r.domain ? String(r.domain) : null,
      created_at: String(r.created_at),
    }))
  }

  // ─── Calendar Events ─────────────────────────────────────────────────

  async listCalendarEvents(startDate: string, endDate: string, domain?: string): Promise<CalendarEvent[]> {
    if (!this.ready) return []
    const args: (string | number)[] = [startDate, endDate]
    let sql = 'SELECT * FROM calendar_events WHERE start_time >= ? AND start_time <= ?'
    if (domain) { sql += ' AND domain = ?'; args.push(domain) }
    sql += ' ORDER BY start_time ASC'
    const result = await this.client.execute({ sql, args })
    return result.rows.map(r => ({
      id: String(r.id),
      title: String(r.title),
      start_time: String(r.start_time),
      end_time: String(r.end_time),
      location: r.location ? String(r.location) : undefined,
      attendees: r.attendees ? JSON.parse(String(r.attendees)) : [],
      calendar_name: r.calendar_name ? String(r.calendar_name) : undefined,
      domain: r.domain ? String(r.domain) : undefined,
      source: String(r.source ?? 'manual'),
      external_id: r.external_id ? String(r.external_id) : undefined,
      notes: r.notes ? String(r.notes) : undefined,
      customer_id: r.customer_id ? String(r.customer_id) : undefined,
      created_at: r.created_at ? String(r.created_at) : undefined,
      updated_at: r.updated_at ? String(r.updated_at) : undefined,
    })) as CalendarEvent[]
  }

  async upsertCalendarEvent(event: Partial<CalendarEvent>): Promise<CalendarEvent> {
    if (!this.ready) throw new Error('Turso adapter not initialized')
    const id = event.id || randomUUID()
    const now = new Date().toISOString()
    await this.client.execute({
      sql: `INSERT INTO calendar_events (id, title, start_time, end_time, location, attendees, calendar_name, domain, source, external_id, notes, customer_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(external_id, source) DO UPDATE SET
          title = excluded.title, start_time = excluded.start_time, end_time = excluded.end_time,
          location = excluded.location, attendees = excluded.attendees, notes = excluded.notes,
          updated_at = excluded.updated_at`,
      args: [id, event.title ?? '', event.start_time ?? '', event.end_time ?? '', event.location ?? null,
        JSON.stringify(event.attendees ?? []), event.calendar_name ?? null, event.domain ?? null,
        event.source ?? 'manual', event.external_id ?? null, event.notes ?? null,
        event.customer_id ?? null, now, now],
    })
    return { ...event, id, source: event.source ?? 'manual', created_at: now, updated_at: now } as CalendarEvent
  }
}

function parseTursoTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description != null ? String(row.description) : null,
    status: String(row.status) as Task['status'],
    task_type: String(row.task_type) as Task['task_type'],
    domain: row.domain != null ? String(row.domain) : null,
    project_id: row.project_id != null ? String(row.project_id) : null,
    sprint: row.sprint != null ? String(row.sprint) : null,
    priority: Number(row.priority),
    assignee: row.assignee != null ? String(row.assignee) : null,
    assigned_agent_id: row.assigned_agent_id != null ? String(row.assigned_agent_id) : null,
    blocked_reason: row.blocked_reason != null ? String(row.blocked_reason) : null,
    due_date: row.due_date != null ? String(row.due_date) : null,
    cwd: row.cwd != null ? String(row.cwd) : null,
    completion_notes: row.completion_notes != null ? String(row.completion_notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
  }
}

function parseTursoApprovalBundle(row: Record<string, unknown>): ApprovalBundle {
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

function parseTursoProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: row.description != null ? String(row.description) : null,
    domain: String(row.domain),
    status: String(row.status) as ProjectStatus,
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

function parseTursoContentRow(row: Record<string, unknown>): ContentPiece {
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

function parseTursoAdvisor(row: Record<string, unknown>): Advisor {
  return {
    id: String(row.id),
    name: String(row.name),
    display_name: String(row.display_name),
    role: row.role != null ? String(row.role) : null,
    expertise: JSON.parse(String(row.expertise ?? '[]')),
    system_prompt: String(row.system_prompt),
    avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
    created_at: String(row.created_at),
  }
}

function parseTursoPlanningSession(row: Record<string, unknown>): PlanningSessionRecord {
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


// ─── Migration SQL ─────────────────────────────────────────────────────────

/**
 * Returns the Turso/libSQL schema SQL for manual use.
 * Identical to SQLite schema — can be run in Turso dashboard shell.
 */
export function getTursoMigrationSQL(): string {
  return SCHEMA_STATEMENTS.join(';\n\n') + ';'
}
