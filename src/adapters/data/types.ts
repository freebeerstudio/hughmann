import type { Task, TaskFilters, CreateTaskInput, UpdateTaskInput } from '../../types/tasks.js'
import type { Project, ProjectFilters, CreateProjectInput, UpdateProjectInput, PlanningSessionRecord, DomainGoal, ApprovalBundle, ApprovalBundleFilters } from '../../types/projects.js'
import type { Advisor } from '../../types/advisors.js'
import type { ContentPiece, Topic, ContentSource, ContentStatus, ContentPlatform, ContentSourceType } from '../../types/content.js'

export interface CalendarEvent {
  id: string
  title: string
  start_time: string
  end_time: string
  location?: string
  attendees?: string[]
  calendar_name?: string
  domain?: string
  source: string
  external_id?: string
  notes?: string
  customer_id?: string
  created_at?: string
  updated_at?: string
}

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

  // ─── Tasks ──────────────────────────────────────────────────────────

  listTasks(filters?: TaskFilters): Promise<Task[]>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: string, input: UpdateTaskInput): Promise<Task | null>
  completeTask(id: string, notes?: string): Promise<Task | null>
  getTask(id: string): Promise<Task | null>

  // ─── Projects ──────────────────────────────────────────────────────────

  listProjects(filters?: ProjectFilters): Promise<Project[]>
  createProject(input: CreateProjectInput): Promise<Project>
  updateProject(id: string, input: UpdateProjectInput): Promise<Project | null>
  getProject(id: string): Promise<Project | null>
  getProjectBySlug(slug: string): Promise<Project | null>

  // ─── Approval Bundles ──────────────────────────────────────────────────

  createApprovalBundle(input: Omit<ApprovalBundle, 'id' | 'created_at'>): Promise<ApprovalBundle>
  listApprovalBundles(filters?: ApprovalBundleFilters): Promise<ApprovalBundle[]>
  updateApprovalBundle(id: string, input: { status: string; resolved_at?: string; resolved_by?: string }): Promise<ApprovalBundle | null>

  // ─── Planning Sessions ─────────────────────────────────────────────────

  savePlanningSession(record: Omit<PlanningSessionRecord, 'id' | 'created_at'>): Promise<string>
  getRecentPlanningSessions(limit?: number): Promise<PlanningSessionRecord[]>
  getLatestPlanningSession(): Promise<PlanningSessionRecord | null>

  // ─── Domain Goals ──────────────────────────────────────────────────────

  listDomainGoals(domain?: string): Promise<DomainGoal[]>
  getDomainGoal(id: string): Promise<DomainGoal | null>
  updateDomainGoal(id: string, updates: {
    statement?: string
    current_state?: string
    state_updates?: import('../../types/projects.js').StateUpdate[]
  }): Promise<DomainGoal | null>

  // ─── Briefings ─────────────────────────────────────────────────────────

  saveBriefing(type: 'morning' | 'closeout' | 'weekly_review' | 'custom', content: string, domain?: string): Promise<string>

  getLatestBriefing(type?: string): Promise<{
    id: string
    type: string
    domain: string | null
    content: string
    created_at: string
  } | null>

  listBriefings(limit?: number, type?: string): Promise<{
    id: string
    type: string
    domain: string | null
    content: string
    created_at: string
  }[]>

  // ─── Advisors ──────────────────────────────────────────────────────────

  listAdvisors(expertise?: string): Promise<Advisor[]>
  getAdvisor(id: string): Promise<Advisor | null>
  getAdvisorByName(name: string): Promise<Advisor | null>

  // ─── Content ──────────────────────────────────────────────────────────

  listContent(filters?: {
    status?: ContentStatus | ContentStatus[]
    domain?: string
    topic_id?: string
    limit?: number
  }): Promise<ContentPiece[]>

  createContent(input: {
    domain: string
    title: string
    topic_id?: string
    project_id?: string
    status?: ContentStatus
    platform?: ContentPlatform
    body?: string
    source_material?: { url: string; title: string; summary: string }[]
    created_by?: string
  }): Promise<ContentPiece>

  updateContent(id: string, input: {
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
  }): Promise<ContentPiece | null>

  getContent(id: string): Promise<ContentPiece | null>

  // ─── Topics ───────────────────────────────────────────────────────────

  listTopics(filters?: { domain?: string; active?: boolean }): Promise<Topic[]>
  createTopic(input: { domain: string; name: string; description?: string }): Promise<Topic>
  updateTopic(id: string, input: { name?: string; description?: string; active?: boolean }): Promise<Topic | null>

  // ─── Content Sources ──────────────────────────────────────────────────

  listContentSources(filters?: { domain?: string; active?: boolean; type?: ContentSourceType }): Promise<ContentSource[]>
  createContentSource(input: { domain: string; name: string; type?: ContentSourceType; url?: string }): Promise<ContentSource>
  updateContentSource(id: string, input: { name?: string; url?: string; active?: boolean }): Promise<ContentSource | null>

  // ─── Feedback ─────────────────────────────────────────────────────────

  saveFeedback(entry: {
    category: string
    signal: 'positive' | 'negative' | 'correction'
    content: string
    context?: string
    domain?: string
  }): Promise<void>

  getFeedbackPatterns(options?: {
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
  }[]>

  // ─── Calendar Events ─────────────────────────────────────────────────

  listCalendarEvents(startDate: string, endDate: string, domain?: string): Promise<CalendarEvent[]>
  upsertCalendarEvent(event: Partial<CalendarEvent>): Promise<CalendarEvent>
}
