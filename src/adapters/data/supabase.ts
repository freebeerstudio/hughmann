import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { DataAdapter, CalendarEvent } from './types.js'
import type { Task, TaskFilters, CreateTaskInput, UpdateTaskInput } from '../../types/tasks.js'
import type { Project, ProjectFilters, CreateProjectInput, UpdateProjectInput, PlanningSessionRecord, DomainGoal, ApprovalBundle, ApprovalBundleFilters } from '../../types/projects.js'
import type { Advisor } from '../../types/advisors.js'
import type { ContentPiece, Topic, ContentSource, ContentStatus, ContentPlatform, ContentSourceType } from '../../types/content.js'

export interface SupabaseConfig {
  url: string
  key: string
}

/**
 * Supabase data adapter for structured persistence.
 * Syncs sessions, memories, briefings, advisors, and domain data to Supabase tables.
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

  // ─── Vector Memory ──────────────────────────────────────────────────────

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
    if (filters?.project_id) {
      query = query.eq('project_id', filters.project_id)
    }
    if (filters?.assignee) {
      query = query.eq('assignee', filters.assignee)
    }
    if (filters?.assigneeOrUnassigned) {
      query = query.or(`assignee.eq.${filters.assigneeOrUnassigned},assignee.is.null`)
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

    const row = {
      id: randomUUID(),
      name: input.name,
      slug,
      description: input.description ?? null,
      domain: input.domain,
      status: input.status ?? 'planning',
      priority: input.priority ?? 3,
      north_star: input.north_star ?? null,
      guardrails: input.guardrails ?? [],
      domain_goal_id: input.domain_goal_id ?? null,
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

    await this.client.from('projects').insert(row)
    return parseProject(row)
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

  // ─── Approval Bundles ──────────────────────────────────────────────────

  async createApprovalBundle(input: Omit<ApprovalBundle, 'id' | 'created_at'>): Promise<ApprovalBundle> {
    const { data, error } = await this.client
      .from('approval_bundles')
      .insert(input)
      .select()
      .single()
    if (error) throw error
    return data as ApprovalBundle
  }

  async listApprovalBundles(filters?: ApprovalBundleFilters): Promise<ApprovalBundle[]> {
    let query = this.client.from('approval_bundles').select('*').order('created_at', { ascending: false })
    if (filters?.project_id) query = query.eq('project_id', filters.project_id)
    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.domain) query = query.eq('domain', filters.domain)
    const { data, error } = await query
    if (error) throw error
    return (data || []) as ApprovalBundle[]
  }

  async updateApprovalBundle(id: string, input: { status: string; resolved_at?: string; resolved_by?: string }): Promise<ApprovalBundle | null> {
    const { data, error } = await this.client
      .from('approval_bundles')
      .update(input)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as ApprovalBundle
  }

  // ─── Domain Goals ──────────────────────────────────────────────────────

  async listDomainGoals(domain?: string): Promise<DomainGoal[]> {
    if (!this.ready) return []

    let query = this.client
      .from('domain_goals')
      .select('*')
      .order('updated_at', { ascending: false })

    if (domain) {
      query = query.eq('domain', domain)
    }

    const { data } = await query
    return (data ?? []) as DomainGoal[]
  }

  async getDomainGoal(id: string): Promise<DomainGoal | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('domain_goals')
      .select('*')
      .eq('id', id)
      .single()

    return (data as DomainGoal) ?? null
  }

  async updateDomainGoal(id: string, statement: string): Promise<DomainGoal | null> {
    if (!this.ready) return null

    const now = new Date().toISOString()
    const { data } = await this.client
      .from('domain_goals')
      .update({ statement, reviewed_at: now, updated_at: now })
      .eq('id', id)
      .select('*')
      .single()

    return (data as DomainGoal) ?? null
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

  // ─── Briefings ───────────────────────────────────────────────────────────

  async saveBriefing(type: 'morning' | 'closeout' | 'weekly_review' | 'custom', content: string, domain?: string): Promise<string> {
    const id = randomUUID()
    await this.client.from('briefings').insert({ id, type, content, domain: domain ?? null })
    return id
  }

  async getLatestBriefing(type?: string): Promise<{ id: string; type: string; domain: string | null; content: string; created_at: string } | null> {
    let query = this.client.from('briefings').select('*').order('created_at', { ascending: false }).limit(1)
    if (type) query = query.eq('type', type)
    const { data } = await query
    return data?.[0] ?? null
  }

  async listBriefings(limit?: number, type?: string): Promise<{ id: string; type: string; domain: string | null; content: string; created_at: string }[]> {
    let query = this.client.from('briefings').select('*').order('created_at', { ascending: false }).limit(limit ?? 10)
    if (type) query = query.eq('type', type)
    const { data } = await query
    return data ?? []
  }

  // ─── Advisors ────────────────────────────────────────────────────────────

  async listAdvisors(expertise?: string): Promise<Advisor[]> {
    let query = this.client.from('advisors').select('*').order('name')
    if (expertise) query = query.contains('expertise', [expertise])
    const { data } = await query
    return (data ?? []) as Advisor[]
  }

  async getAdvisor(id: string): Promise<Advisor | null> {
    const { data } = await this.client.from('advisors').select('*').eq('id', id).single()
    return (data as Advisor) ?? null
  }

  async getAdvisorByName(name: string): Promise<Advisor | null> {
    const { data } = await this.client.from('advisors').select('*').eq('name', name).single()
    return (data as Advisor) ?? null
  }

  // ─── Content ───────────────────────────────────────────────────────────

  async listContent(filters?: {
    status?: ContentStatus | ContentStatus[]
    domain?: string
    topic_id?: string
    limit?: number
  }): Promise<ContentPiece[]> {
    if (!this.ready) return []

    let query = this.client
      .from('content')
      .select('*')
      .order('created_at', { ascending: false })

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
    if (filters?.topic_id) {
      query = query.eq('topic_id', filters.topic_id)
    }
    if (filters?.limit) {
      query = query.limit(filters.limit)
    }

    const { data } = await query
    return (data ?? []).map(parseContentRow)
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
    const row = {
      id: randomUUID(),
      domain: input.domain,
      title: input.title,
      topic_id: input.topic_id ?? null,
      project_id: input.project_id ?? null,
      status: input.status ?? 'idea',
      platform: input.platform ?? 'blog',
      body: input.body ?? null,
      source_material: input.source_material ?? [],
      created_by: input.created_by ?? 'hughmann',
      scheduled_at: null,
      published_at: null,
      published_url: null,
      created_at: now,
      updated_at: now,
    }

    await this.client.from('content').insert(row)
    return parseContentRow(row)
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

    const { data } = await this.client
      .from('content')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()

    return data ? parseContentRow(data) : null
  }

  async getContent(id: string): Promise<ContentPiece | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('content')
      .select('*')
      .eq('id', id)
      .single()

    return data ? parseContentRow(data) : null
  }

  // ─── Topics ───────────────────────────────────────────────────────────

  async listTopics(filters?: { domain?: string; active?: boolean }): Promise<Topic[]> {
    if (!this.ready) return []

    let query = this.client
      .from('topics')
      .select('*')
      .order('name', { ascending: true })

    if (filters?.domain) {
      query = query.eq('domain', filters.domain)
    }
    if (filters?.active !== undefined) {
      query = query.eq('active', filters.active)
    }

    const { data } = await query
    return (data ?? []) as Topic[]
  }

  async createTopic(input: { domain: string; name: string; description?: string }): Promise<Topic> {
    const now = new Date().toISOString()
    const row = {
      id: randomUUID(),
      domain: input.domain,
      name: input.name,
      description: input.description ?? null,
      active: true,
      created_at: now,
    }

    await this.client.from('topics').insert(row)
    return row as Topic
  }

  async updateTopic(id: string, input: { name?: string; description?: string; active?: boolean }): Promise<Topic | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('topics')
      .update(input)
      .eq('id', id)
      .select('*')
      .single()

    return (data as Topic) ?? null
  }

  // ─── Content Sources ──────────────────────────────────────────────────

  async listContentSources(filters?: { domain?: string; active?: boolean; type?: ContentSourceType }): Promise<ContentSource[]> {
    if (!this.ready) return []

    let query = this.client
      .from('content_sources')
      .select('*')
      .order('name', { ascending: true })

    if (filters?.domain) {
      query = query.eq('domain', filters.domain)
    }
    if (filters?.active !== undefined) {
      query = query.eq('active', filters.active)
    }
    if (filters?.type) {
      query = query.eq('type', filters.type)
    }

    const { data } = await query
    return (data ?? []) as ContentSource[]
  }

  async createContentSource(input: { domain: string; name: string; type?: ContentSourceType; url?: string }): Promise<ContentSource> {
    const now = new Date().toISOString()
    const row = {
      id: randomUUID(),
      domain: input.domain,
      name: input.name,
      type: input.type ?? 'manual',
      url: input.url ?? null,
      active: true,
      created_at: now,
    }

    await this.client.from('content_sources').insert(row)
    return row as ContentSource
  }

  async updateContentSource(id: string, input: { name?: string; url?: string; active?: boolean }): Promise<ContentSource | null> {
    if (!this.ready) return null

    const { data } = await this.client
      .from('content_sources')
      .update(input)
      .eq('id', id)
      .select('*')
      .single()

    return (data as ContentSource) ?? null
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
      session_id: null,
      category: entry.category,
      signal: entry.signal,
      content: entry.content,
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

  // ─── Calendar Events ─────────────────────────────────────────────────

  async listCalendarEvents(startDate: string, endDate: string, domain?: string): Promise<CalendarEvent[]> {
    if (!this.ready) return []
    let query = this.client
      .from('calendar_events')
      .select('*')
      .gte('start_time', startDate)
      .lte('start_time', endDate)
      .order('start_time', { ascending: true })
    if (domain) query = query.eq('domain', domain)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as CalendarEvent[]
  }

  async upsertCalendarEvent(event: Partial<CalendarEvent>): Promise<CalendarEvent> {
    if (!this.ready) throw new Error('Supabase adapter not initialized')
    const { data, error } = await this.client
      .from('calendar_events')
      .upsert(event, { onConflict: 'external_id,source' })
      .select()
      .single()
    if (error) throw error
    return data as CalendarEvent
  }
}

/** Parse a Supabase row into a typed ContentPiece (ensures source_material is always an array) */
function parseContentRow(row: Record<string, unknown>): ContentPiece {
  return {
    id: String(row.id),
    domain: String(row.domain),
    topic_id: row.topic_id != null ? String(row.topic_id) : null,
    project_id: row.project_id != null ? String(row.project_id) : null,
    title: String(row.title),
    status: String(row.status) as ContentStatus,
    platform: String(row.platform) as ContentPlatform,
    body: row.body != null ? String(row.body) : null,
    source_material: Array.isArray(row.source_material) ? row.source_material as { url: string; title: string; summary: string }[] : [],
    scheduled_at: row.scheduled_at != null ? String(row.scheduled_at) : null,
    published_at: row.published_at != null ? String(row.published_at) : null,
    published_url: row.published_url != null ? String(row.published_url) : null,
    created_by: String(row.created_by ?? 'hughmann'),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

/** Parse a Supabase row into a typed Project (handles JSONB arrays) */
function parseProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: row.description != null ? String(row.description) : null,
    domain: String(row.domain),
    status: String(row.status) as Project['status'],
    priority: Number(row.priority),
    domain_goal_id: row.domain_goal_id != null ? String(row.domain_goal_id) : null,
    north_star: row.north_star != null ? String(row.north_star) : null,
    guardrails: Array.isArray(row.guardrails) ? row.guardrails as string[] : [],
    infrastructure: (row.infrastructure && typeof row.infrastructure === 'object') ? row.infrastructure as Project['infrastructure'] : {},
    refinement_cadence: (row.refinement_cadence as Project['refinement_cadence']) ?? 'weekly',
    last_refinement_at: row.last_refinement_at != null ? String(row.last_refinement_at) : null,
    approval_mode: (row.approval_mode as Project['approval_mode']) ?? 'required',
    local_path: row.local_path != null ? String(row.local_path) : null,
    stack: Array.isArray(row.stack) ? row.stack as string[] : [],
    claude_md_exists: Boolean(row.claude_md_exists),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

// ─── Domain → Customer ID Mapping ───────────────────────────────────────────

// Re-export from shared utility so existing callers don't break
export { domainToCustomerId } from '../../util/domain.js'
import { domainToCustomerId } from '../../util/domain.js'

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
  task_type TEXT NOT NULL DEFAULT 'standard' CHECK (task_type IN ('must', 'mit', 'big_rock', 'standard')),
  domain TEXT,
  project_id UUID REFERENCES projects(id),
  sprint TEXT,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
  assignee TEXT,
  assigned_agent_id TEXT,
  blocked_reason TEXT,
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
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks (project_id);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'paused', 'completed', 'archived', 'incubator')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 0 AND priority <= 5),
  domain_goal_id UUID,
  north_star TEXT,
  guardrails JSONB NOT NULL DEFAULT '[]',
  infrastructure JSONB NOT NULL DEFAULT '{}',
  refinement_cadence TEXT NOT NULL DEFAULT 'weekly',
  last_refinement_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- Domain goals table
CREATE TABLE IF NOT EXISTS domain_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  customer_id UUID,
  statement TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_goals_domain ON domain_goals (domain);

-- Briefings table
CREATE TABLE IF NOT EXISTS briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('morning', 'closeout', 'weekly_review', 'custom')),
  domain TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefings_type ON briefings (type);
CREATE INDEX IF NOT EXISTS idx_briefings_created ON briefings (created_at DESC);

-- Advisors table
CREATE TABLE IF NOT EXISTS advisors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT,
  expertise TEXT[] NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT,
  signal TEXT NOT NULL CHECK (signal IN ('positive', 'negative', 'correction')),
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback (category);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);

-- Topics table
CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topics_domain ON topics (domain);
CREATE INDEX IF NOT EXISTS idx_topics_active ON topics (active);

-- Content table
CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  topic_id UUID REFERENCES topics(id),
  project_id UUID REFERENCES projects(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'drafting', 'review', 'approved', 'scheduled', 'published', 'rejected')),
  platform TEXT NOT NULL DEFAULT 'blog' CHECK (platform IN ('blog', 'linkedin', 'x', 'newsletter', 'youtube', 'shorts')),
  body TEXT,
  source_material JSONB NOT NULL DEFAULT '[]',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  published_url TEXT,
  created_by TEXT NOT NULL DEFAULT 'hughmann',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_domain ON content (domain);
CREATE INDEX IF NOT EXISTS idx_content_status ON content (status);
CREATE INDEX IF NOT EXISTS idx_content_topic ON content (topic_id);
CREATE INDEX IF NOT EXISTS idx_content_project ON content (project_id);

-- Content sources table
CREATE TABLE IF NOT EXISTS content_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('rss', 'youtube', 'newsletter', 'manual')),
  url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_sources_domain ON content_sources (domain);
CREATE INDEX IF NOT EXISTS idx_content_sources_active ON content_sources (active);

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
ALTER TABLE kb_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;

-- Allow all operations for service key
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sessions' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON sessions FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memories' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON memories FOR ALL USING (true);
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'domain_goals' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON domain_goals FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'briefings' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON briefings FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'advisors' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON advisors FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON feedback FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'topics' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON topics FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON content FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content_sources' AND policyname = 'Allow all for service key') THEN
    CREATE POLICY "Allow all for service key" ON content_sources FOR ALL USING (true);
  END IF;
END $$;
`

/**
 * Returns the migration SQL for users to run.
 */
export function getMigrationSQL(): string {
  return MIGRATION_SQL
}
