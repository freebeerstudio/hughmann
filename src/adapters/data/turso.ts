import { createClient, type Client } from '@libsql/client'
import { randomUUID } from 'node:crypto'
import type { DataAdapter } from './types.js'
import { cosineSimilarity } from '../../util/math.js'
import type { Task, TaskFilters, CreateTaskInput, UpdateTaskInput } from '../../types/tasks.js'
import type { Project, ProjectFilters, CreateProjectInput, UpdateProjectInput, PlanningSessionRecord, ProjectStatus, DomainGoal } from '../../types/projects.js'
import type { Advisor } from '../../types/advisors.js'

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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects (domain)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug)`,

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
      created_at: now,
      updated_at: now,
    }

    await this.client.execute({
      sql: `INSERT INTO projects (id, name, slug, description, domain, status, priority, domain_goal_id, north_star, guardrails, infrastructure, refinement_cadence, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        project.id, project.name, project.slug, project.description, project.domain,
        project.status, project.priority, project.domain_goal_id,
        project.north_star, JSON.stringify(project.guardrails),
        JSON.stringify(project.infrastructure), project.refinement_cadence,
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
      if (['guardrails', 'infrastructure'].includes(key)) {
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

  // ─── Domain Goals ──────────────────────────────────────────────────────

  async listDomainGoals(_domain?: string): Promise<DomainGoal[]> { return [] }
  async getDomainGoal(_id: string): Promise<DomainGoal | null> { return null }
  async updateDomainGoal(_id: string, _statement: string): Promise<DomainGoal | null> { return null }

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
