# Unified Supabase Schema — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild HughMann's Supabase schema into a clean 15-table unified database, preserving KB/vector data, and update all code (types, adapters, tools, Trigger.dev) to match.

**Architecture:** Drop all non-KB tables from HughMann's existing Supabase project, create 13 new tables per the unified schema design, update the DataAdapter interface and all three implementations (Supabase, SQLite, Turso), update internal tools and Trigger.dev tasks. Migrate advisor prompts from Platform's Supabase.

**Tech Stack:** TypeScript/ESM, Supabase (PostgreSQL + pgvector), Vitest, better-sqlite3, @libsql/client

---

### Task 1: Export Advisor Data from Platform

Before we touch any database, export the 22 advisor system prompts from Platform's Supabase so we can seed them into the new schema.

**Files:**
- Create: `supabase/seed/advisors.json`

**Step 1: Extract advisor data from Platform's seed SQL**

Read the Platform seed file at `/Users/waynebridges/FreeBeerStudio/INT_platform.freebeer.ai/supabase/migrations/20260117_advisory_seed.sql`. Extract each advisor's `name`, `role`, `system_prompt`, and `avatar_url`.

Save as JSON:

```json
[
  {
    "name": "steve-jobs",
    "display_name": "Steve Jobs",
    "role": "Product visionary, design thinker, business strategist",
    "expertise": ["product", "design", "strategy", "innovation"],
    "system_prompt": "...(full prompt from seed SQL)...",
    "avatar_url": null
  },
  ...
]
```

Map the `expertise` array by reading each advisor's system prompt and identifying their 3-5 core expertise keywords. These are used by Hugh to auto-select advisors during conversations.

**Step 2: Verify the export**

Ensure all 22 advisors are captured. Count entries in the JSON file.

**Step 3: Commit**

```bash
mkdir -p supabase/seed
git add supabase/seed/advisors.json
git commit -m "chore: export advisor data from Platform for migration"
```

---

### Task 2: Write the Migration SQL

Create the full migration that drops old tables and creates the new unified schema. This is the most critical file — it must preserve KB data.

**Files:**
- Create: `supabase/migrations/20260308_unified_schema.sql`

**Step 1: Write the migration SQL**

```sql
-- =============================================================================
-- Unified Schema Migration
-- Preserves: kb_nodes, kb_edges, memory_embeddings, search_kb_nodes RPC,
--            search_memory_v2 RPC
-- Drops: everything else
-- Creates: 13 new tables across 6 modules
-- =============================================================================

-- ─── PHASE 1: DROP OLD TABLES (order matters for FKs) ───────────────────────

DROP TABLE IF EXISTS planning_sessions CASCADE;
DROP TABLE IF EXISTS domain_notes CASCADE;
DROP TABLE IF EXISTS decisions CASCADE;
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS memories CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS domain_goals CASCADE;
DROP TABLE IF EXISTS context_docs CASCADE;

-- Drop the old customer_id mapping function
DROP FUNCTION IF EXISTS hughmann_customer_id(TEXT);

-- ─── PHASE 2: PLANNING MODULE ───────────────────────────────────────────────

CREATE TABLE domain_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      TEXT NOT NULL,
  statement   TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_domain_goals_domain ON domain_goals(domain);

CREATE TABLE projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  description         TEXT,
  domain              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'planning'
                      CHECK (status IN ('planning','incubator','active','paused','completed','archived')),
  priority            INTEGER DEFAULT 0,
  domain_goal_id      UUID REFERENCES domain_goals(id) ON DELETE SET NULL,
  north_star          TEXT,
  guardrails          JSONB DEFAULT '[]',
  infrastructure      JSONB DEFAULT '{}',
  refinement_cadence  TEXT DEFAULT 'weekly'
                      CHECK (refinement_cadence IN ('weekly','biweekly','monthly')),
  last_refinement_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_domain ON projects(domain);
CREATE INDEX idx_projects_status ON projects(status);

CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'backlog'
                    CHECK (status IN ('backlog','todo','in_progress','blocked','done')),
  task_type         TEXT DEFAULT 'standard'
                    CHECK (task_type IN ('big_rock','must','mit','standard')),
  domain            TEXT,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  sprint            TEXT,
  priority          INTEGER DEFAULT 0,
  assignee          TEXT,
  assigned_agent_id TEXT,
  blocked_reason    TEXT,
  due_date          TEXT,
  cwd               TEXT,
  completion_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_domain ON tasks(domain);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee);

-- ─── PHASE 3: MEMORY MODULE ─────────────────────────────────────────────────

CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT,
  domain        TEXT,
  messages      JSONB DEFAULT '[]',
  message_count INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT,
  domain      TEXT,
  content     TEXT NOT NULL,
  memory_date DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memories_date ON memories(memory_date);
CREATE INDEX idx_memories_domain ON memories(domain);

CREATE TABLE planning_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID REFERENCES sessions(id) ON DELETE SET NULL,
  focus_area       TEXT,
  topics_covered   JSONB DEFAULT '[]',
  decisions_made   JSONB DEFAULT '[]',
  tasks_created    JSONB DEFAULT '[]',
  projects_touched JSONB DEFAULT '[]',
  open_questions   JSONB DEFAULT '[]',
  next_steps       JSONB DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE briefings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL
              CHECK (type IN ('morning','closeout','weekly_review','custom')),
  domain      TEXT,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_briefings_type ON briefings(type);
CREATE INDEX idx_briefings_created ON briefings(created_at DESC);

-- ─── PHASE 4: KNOWLEDGE MODULE ──────────────────────────────────────────────
-- kb_nodes and kb_edges PRESERVED — do not touch
-- memory_embeddings PRESERVED — do not touch
-- search_kb_nodes RPC PRESERVED — do not touch
-- search_memory_v2 RPC PRESERVED — do not touch

CREATE TABLE advisors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT,
  expertise     TEXT[] DEFAULT '{}',
  system_prompt TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PHASE 5: CONTENT MODULE ────────────────────────────────────────────────

CREATE TABLE content_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      TEXT NOT NULL DEFAULT 'fbs',
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'rss'
              CHECK (type IN ('rss','youtube','newsletter','manual')),
  url         TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      TEXT NOT NULL DEFAULT 'fbs',
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE content (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          TEXT NOT NULL DEFAULT 'fbs',
  topic_id        UUID REFERENCES topics(id) ON DELETE SET NULL,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'idea'
                  CHECK (status IN ('idea','drafting','review','approved','scheduled','published','rejected')),
  platform        TEXT NOT NULL DEFAULT 'blog'
                  CHECK (platform IN ('blog','linkedin','x','newsletter','youtube','shorts')),
  body            TEXT,
  source_material JSONB DEFAULT '[]',
  scheduled_at    TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  published_url   TEXT,
  created_by      TEXT DEFAULT 'mark',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_content_domain ON content(domain);
CREATE INDEX idx_content_platform ON content(platform);

-- ─── PHASE 6: CRM MODULE ────────────────────────────────────────────────────

CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT,
  company     TEXT,
  domain      TEXT NOT NULL,
  notes       TEXT,
  tags        JSONB DEFAULT '[]',
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_domain ON customers(domain);

-- ─── PHASE 7: OPERATIONS MODULE ─────────────────────────────────────────────

CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT,
  signal      TEXT NOT NULL
              CHECK (signal IN ('positive','negative','correction')),
  category    TEXT,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE context_docs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type       TEXT NOT NULL,
  title          TEXT,
  content        TEXT NOT NULL,
  domain_slug    TEXT,
  isolation_zone TEXT DEFAULT 'personal',
  content_hash   TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PHASE 8: RLS ───────────────────────────────────────────────────────────
-- Simple: service role has full access. Authenticated user has full access.

ALTER TABLE domain_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_docs ENABLE ROW LEVEL SECURITY;

-- Full access policies for all tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'domain_goals','projects','tasks','sessions','memories',
    'planning_sessions','briefings','advisors','content_sources',
    'topics','content','customers','feedback','context_docs'
  ])
  LOOP
    EXECUTE format('CREATE POLICY "Full access on %I" ON %I FOR ALL USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- ─── PHASE 9: SEED DOMAIN GOALS ─────────────────────────────────────────────

INSERT INTO domain_goals (domain, statement) VALUES
  ('fbs', 'Increase revenue daily'),
  ('omnissa', 'Win every deal in my territory'),
  ('personal', 'Build the life I want'),
  ('health', 'Live longer and healthier'),
  ('ica', 'Amplify human cognition and creativity through AI'),
  ('masonic', 'Help lodges connect with each other and their communities');
```

**Step 2: Review the SQL carefully**

Verify:
- All 13 new tables are created (domain_goals, projects, tasks, sessions, memories, planning_sessions, briefings, advisors, content_sources, topics, content, customers, feedback, context_docs — that's 14, but context_docs is operations)
- kb_nodes, kb_edges are NOT dropped
- memory_embeddings is NOT dropped
- search_kb_nodes and search_memory_v2 RPCs are NOT dropped
- The hughmann_customer_id function IS dropped (no longer needed)
- All CHECK constraints match the design doc
- All indexes are created
- RLS is enabled with full-access policies

**Step 3: Commit**

```bash
git add supabase/migrations/20260308_unified_schema.sql
git commit -m "feat: unified schema migration — 14 tables, 6 modules"
```

---

### Task 3: Update TypeScript Types

Update the type definitions to match the new schema. Remove deprecated fields, add new types.

**Files:**
- Modify: `src/types/projects.ts`
- Modify: `src/types/tasks.ts`
- Create: `src/types/content.ts`
- Create: `src/types/advisors.ts`

**Step 1: Rewrite `src/types/projects.ts`**

Remove: `goals`, `quarterly_goal`, `milestones`, `Milestone`, `metadata`, `completed_at` fields from Project. Remove `customer_id` from DomainGoal. These are legacy fields from the old schema.

The clean Project type:

```typescript
export type ProjectStatus = 'planning' | 'incubator' | 'active' | 'paused' | 'completed' | 'archived'

export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  domain: string
  status: ProjectStatus
  priority: number
  domain_goal_id: string | null
  north_star: string | null
  guardrails: string[]
  infrastructure: {
    repo_url?: string
    vercel_project?: string
    production_url?: string
    staging_url?: string
    domain?: string
  }
  refinement_cadence: 'weekly' | 'biweekly' | 'monthly'
  last_refinement_at: string | null
  created_at: string
  updated_at: string
}

export interface DomainGoal {
  id: string
  domain: string
  statement: string
  reviewed_at: string
  created_at: string
  updated_at: string
}

export interface CreateProjectInput {
  name: string
  slug?: string
  description?: string
  domain: string
  status?: ProjectStatus
  priority?: number
  north_star?: string
  guardrails?: string[]
  infrastructure?: Project['infrastructure']
  refinement_cadence?: 'weekly' | 'biweekly' | 'monthly'
  domain_goal_id?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  domain?: string
  status?: ProjectStatus
  priority?: number
  north_star?: string
  guardrails?: string[]
  infrastructure?: Project['infrastructure']
  refinement_cadence?: 'weekly' | 'biweekly' | 'monthly'
  last_refinement_at?: string
  domain_goal_id?: string
}

export interface ProjectFilters {
  domain?: string
  status?: ProjectStatus | ProjectStatus[]
  limit?: number
}

export interface PlanningSessionRecord {
  id?: string
  session_id?: string
  focus_area: string
  topics_covered: string[]
  decisions_made: string[]
  tasks_created?: string[]
  projects_touched?: string[]
  open_questions?: string[]
  next_steps?: string[]
  created_at?: string
}
```

**Step 2: Clean up `src/types/tasks.ts`**

The Task type is already close to the new schema. Remove the `project` string field (replaced by `project_id` UUID). Change `task_type` values to lowercase to match the new CHECK constraint.

```typescript
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'blocked'

export type TaskType = 'big_rock' | 'must' | 'mit' | 'standard'

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  task_type: TaskType
  domain: string | null
  project_id: string | null
  sprint: string | null
  priority: number
  assignee: string | null
  assigned_agent_id: string | null
  blocked_reason: string | null
  due_date: string | null
  cwd: string | null
  completion_notes: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface TaskFilters {
  status?: TaskStatus | TaskStatus[]
  domain?: string
  project_id?: string
  task_type?: TaskType | TaskType[]
  assignee?: string
  limit?: number
}

export interface CreateTaskInput {
  title: string
  description?: string
  status?: TaskStatus
  task_type?: TaskType
  domain?: string
  project_id?: string
  sprint?: string
  priority?: number
  assignee?: string
  assigned_agent_id?: string
  blocked_reason?: string
  due_date?: string
  cwd?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  task_type?: TaskType
  domain?: string
  project_id?: string
  sprint?: string
  priority?: number
  assignee?: string
  assigned_agent_id?: string
  blocked_reason?: string
  due_date?: string
  cwd?: string
  completion_notes?: string
}
```

**IMPORTANT**: The old `TaskType` was uppercase (`'MUST' | 'MIT' | 'BIG_ROCK' | 'STANDARD'`). The new schema uses lowercase (`'must' | 'mit' | 'big_rock' | 'standard'`). This change affects the Supabase CHECK constraint, SQLite CHECK constraint, internal tools, and task executor. Every reference to uppercase task types must be updated.

Also remove the `project` string field from TaskFilters (was `project?: string`). Replace with `project_id?: string`. Add `assignee?: string` filter.

**Step 3: Create `src/types/content.ts`**

```typescript
export type ContentStatus = 'idea' | 'drafting' | 'review' | 'approved' | 'scheduled' | 'published' | 'rejected'

export type ContentPlatform = 'blog' | 'linkedin' | 'x' | 'newsletter' | 'youtube' | 'shorts'

export type ContentSourceType = 'rss' | 'youtube' | 'newsletter' | 'manual'

export interface ContentPiece {
  id: string
  domain: string
  topic_id: string | null
  project_id: string | null
  title: string
  status: ContentStatus
  platform: ContentPlatform
  body: string | null
  source_material: { url: string; title: string; summary: string }[]
  scheduled_at: string | null
  published_at: string | null
  published_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Topic {
  id: string
  domain: string
  name: string
  description: string | null
  active: boolean
  created_at: string
}

export interface ContentSource {
  id: string
  domain: string
  name: string
  type: ContentSourceType
  url: string | null
  active: boolean
  created_at: string
}
```

**Step 4: Create `src/types/advisors.ts`**

```typescript
export interface Advisor {
  id: string
  name: string
  display_name: string
  role: string | null
  expertise: string[]
  system_prompt: string
  avatar_url: string | null
  created_at: string
}
```

**Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL — DataAdapter and other code still reference old types. That's fine, we fix those next.

**Step 6: Commit types**

```bash
git add src/types/projects.ts src/types/tasks.ts src/types/content.ts src/types/advisors.ts
git commit -m "feat: clean types for unified schema — remove legacy fields, add content and advisor types"
```

---

### Task 4: Update DataAdapter Interface

Update the DataAdapter interface to match the new schema. Remove deprecated methods, add new ones for briefings, advisors, and content.

**Files:**
- Modify: `src/adapters/data/types.ts`

**Step 1: Read and rewrite `src/adapters/data/types.ts`**

The new interface. Remove: `logDecision`, `getDecisions`, `addDomainNote`, `getDomainNotes` (these tables are dropped). Add: briefing methods, advisor methods. Keep everything else but update type imports.

```typescript
import type { Task, TaskFilters, CreateTaskInput, UpdateTaskInput } from '../../types/tasks.js'
import type { Project, ProjectFilters, CreateProjectInput, UpdateProjectInput, DomainGoal, PlanningSessionRecord } from '../../types/projects.js'
import type { Advisor } from '../../types/advisors.js'

export interface DataAdapter {
  init(): Promise<void>

  // Sessions
  saveSession(session: { id: string; title: string; domain: string | null; messages: unknown[]; messageCount: number; createdAt: string; updatedAt: string }): Promise<void>
  listSessions(limit?: number): Promise<{ id: string; title: string; domain: string | null; messageCount: number; createdAt: string; updatedAt: string }[]>
  getSession(id: string): Promise<{ id: string; title: string; domain: string | null; messages: unknown[]; messageCount: number; createdAt: string; updatedAt: string } | null>

  // Memories
  saveMemory(entry: { sessionId: string; domain: string | null; content: string; date: string }): Promise<void>
  getRecentMemories(days?: number, domain?: string | string[]): Promise<{ content: string; domain: string | null; memoryDate: string; createdAt: string }[]>

  // Vector Memory
  saveMemoryEmbedding(content: string, domain: string | null, embedding: number[]): Promise<void>
  saveMemoryWithEmbedding(entry: { sessionId: string; domain: string | null; content: string; date: string }, embedding: number[]): Promise<string>
  searchMemories(queryEmbedding: number[], options?: { limit?: number; threshold?: number; domain?: string }): Promise<{ content: string; domain: string | null; similarity: number; memoryDate?: string }[]>

  // Knowledge Base
  upsertKbNode(node: { vault: string; filePath: string; title: string; content: string; embedding?: number[]; frontmatter?: Record<string, unknown>; nodeType?: string; lastModified?: string; customerId?: string }): Promise<string>
  searchKbNodes(queryEmbedding: number[], options?: { limit?: number; threshold?: number; vault?: string; nodeType?: string; customerId?: string }): Promise<{ id: string; vault: string; filePath: string; title: string; content: string; similarity: number }[]>
  deleteKbNode(vault: string, filePath: string): Promise<void>
  getKbNodeByPath(vault: string, filePath: string): Promise<{ id: string; lastModified: string | null } | null>

  // Tasks
  listTasks(filters?: TaskFilters): Promise<Task[]>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: string, input: UpdateTaskInput): Promise<Task | null>
  completeTask(id: string, notes?: string): Promise<Task | null>
  getTask(id: string): Promise<Task | null>

  // Projects
  listProjects(filters?: ProjectFilters): Promise<Project[]>
  createProject(input: CreateProjectInput): Promise<Project>
  updateProject(id: string, input: UpdateProjectInput): Promise<Project | null>
  getProject(id: string): Promise<Project | null>
  getProjectBySlug(slug: string): Promise<Project | null>

  // Planning Sessions
  savePlanningSession(record: PlanningSessionRecord): Promise<string>
  getRecentPlanningSessions(limit?: number): Promise<PlanningSessionRecord[]>
  getLatestPlanningSession(): Promise<PlanningSessionRecord | null>

  // Domain Goals
  listDomainGoals(domain?: string): Promise<DomainGoal[]>
  getDomainGoal(id: string): Promise<DomainGoal | null>
  updateDomainGoal(id: string, statement: string): Promise<DomainGoal | null>

  // Briefings
  saveBriefing(type: 'morning' | 'closeout' | 'weekly_review' | 'custom', content: string, domain?: string): Promise<string>
  getLatestBriefing(type?: string): Promise<{ id: string; type: string; domain: string | null; content: string; created_at: string } | null>
  listBriefings(limit?: number, type?: string): Promise<{ id: string; type: string; domain: string | null; content: string; created_at: string }[]>

  // Advisors
  listAdvisors(expertise?: string): Promise<Advisor[]>
  getAdvisor(id: string): Promise<Advisor | null>
  getAdvisorByName(name: string): Promise<Advisor | null>

  // Feedback
  saveFeedback(entry: { category: string; signal: 'positive' | 'negative' | 'correction'; content: string; context?: string; domain?: string }): Promise<void>
  getFeedbackPatterns(options?: { domain?: string; category?: string; since?: string; limit?: number }): Promise<{ category: string; signal: string; content: string; domain: string | null; created_at: string }[]>
}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL — All three adapter implementations now don't match the interface. That's expected.

**Step 3: Commit**

```bash
git add src/adapters/data/types.ts
git commit -m "feat: update DataAdapter interface — add briefings, advisors; drop decisions, domain notes"
```

---

### Task 5: Update Supabase Adapter

Rewrite the Supabase adapter to match the new schema. This is the largest code change.

**Files:**
- Modify: `src/adapters/data/supabase.ts`

**Step 1: Read the current file**

Read `src/adapters/data/supabase.ts` completely.

**Step 2: Update MIGRATION_SQL**

Replace the entire `MIGRATION_SQL` constant with the SQL from `supabase/migrations/20260308_unified_schema.sql`. This ensures `init()` can bootstrap a fresh database if needed.

**Step 3: Remove deprecated methods**

Delete: `logDecision()`, `getDecisions()`, `addDomainNote()`, `getDomainNotes()`.

**Step 4: Remove customer_id references**

Remove all references to `customer_id` in session, memory, decision, and domain note methods. The `hughmann_customer_id` function mapping is no longer needed. Remove the `domainToCustomerId` import and re-export.

**Note**: KB methods (`upsertKbNode`, `searchKbNodes`) still use `customer_id` because the preserved `kb_nodes` table still has that column. Keep those as-is.

**Step 5: Update task methods**

- Remove the `project` string field from task inserts/queries (was a legacy string reference)
- `task_type` values are now lowercase: `'big_rock' | 'must' | 'mit' | 'standard'`
- `createTask()` default `task_type` changes from `'STANDARD'` to `'standard'`
- Add `assignee` filter to `listTasks()`:
  ```typescript
  if (filters?.assignee) {
    query = query.eq('assignee', filters.assignee)
  }
  ```

**Step 6: Update project methods**

- Remove `goals`, `quarterly_goal`, `milestones`, `metadata`, `completed_at` from all project queries
- Remove `parseProject()` helper (no more JSONB array parsing needed for goals/milestones)
- `guardrails` is still JSONB so parse it: `guardrails: Array.isArray(row.guardrails) ? row.guardrails : JSON.parse(row.guardrails ?? '[]')`
- `infrastructure` is still JSONB: same parsing pattern

**Step 7: Add briefing methods**

```typescript
async saveBriefing(type: 'morning' | 'closeout' | 'weekly_review' | 'custom', content: string, domain?: string): Promise<string> {
  const id = crypto.randomUUID()
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
```

**Step 8: Add advisor methods**

```typescript
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
```

**Step 9: Update feedback methods**

Remove `context` and `domain` from the feedback insert — the new schema only has `session_id`, `signal`, `category`, `content`. Actually, looking at the design, feedback keeps category, signal, content. Update the insert to match.

**Step 10: Run typecheck**

Run: `npm run typecheck`
Expected: Should get closer to passing. May still fail on SQLite/Turso adapters.

**Step 11: Commit**

```bash
git add src/adapters/data/supabase.ts
git commit -m "feat: rewrite Supabase adapter for unified schema"
```

---

### Task 6: Update SQLite Adapter

Update the SQLite adapter schema and methods to match. This is a local fallback adapter.

**Files:**
- Modify: `src/adapters/data/sqlite.ts`

**Step 1: Read the current file**

Read `src/adapters/data/sqlite.ts` completely.

**Step 2: Update schema statements**

Replace the CREATE TABLE statements to match the new schema (same table structure, adapted for SQLite syntax — no CHECK constraints with parenthesized lists, use TEXT instead).

Key changes:
- Remove `decisions` and `domain_notes` tables
- Add `briefings` table
- Add `advisors` table
- Remove `customer_id` from sessions, memories
- Remove `goals`, `quarterly_goal`, `milestones`, `metadata`, `completed_at` from projects
- Remove `project` string column from tasks (keep only `project_id`)
- Change task_type CHECK to lowercase values
- Add content tables (content_sources, topics, content) — optional, can stub for now since content pipeline runs through Supabase
- Add customers table — optional, can stub

**Step 3: Remove deprecated methods**

Delete: `logDecision()`, `getDecisions()`, `addDomainNote()`, `getDomainNotes()`.

**Step 4: Update task methods**

- Remove `project` string field handling
- Default `task_type` to `'standard'` (lowercase)
- Add `assignee` filter to `listTasks()`
- Add `project_id` filter to `listTasks()`

**Step 5: Update project methods**

- Remove `goals`, `quarterly_goal`, `milestones`, `metadata`, `completed_at` from all queries
- Remove `parseSqliteProject()` helper or simplify it (still need JSON parse for guardrails, infrastructure)

**Step 6: Add briefing methods**

```typescript
async saveBriefing(type: string, content: string, domain?: string): Promise<string> {
  const id = crypto.randomUUID()
  const stmt = this.db.prepare('INSERT INTO briefings (id, type, content, domain, created_at) VALUES (?, ?, ?, ?, ?)')
  stmt.run(id, type, content, domain ?? null, new Date().toISOString())
  return id
}

async getLatestBriefing(type?: string): Promise<...> {
  let sql = 'SELECT * FROM briefings'
  const params: unknown[] = []
  if (type) { sql += ' WHERE type = ?'; params.push(type) }
  sql += ' ORDER BY created_at DESC LIMIT 1'
  const stmt = this.db.prepare(sql)
  const row = stmt.get(...params)
  return row ?? null
}

async listBriefings(limit?: number, type?: string): Promise<...> {
  let sql = 'SELECT * FROM briefings'
  const params: unknown[] = []
  if (type) { sql += ' WHERE type = ?'; params.push(type) }
  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit ?? 10)
  const stmt = this.db.prepare(sql)
  return stmt.all(...params)
}
```

**Step 7: Add advisor methods (stubs)**

SQLite doesn't need full advisor support — advisors are seeded in Supabase and queried from there. Return empty results:

```typescript
async listAdvisors(): Promise<Advisor[]> { return [] }
async getAdvisor(): Promise<Advisor | null> { return null }
async getAdvisorByName(): Promise<Advisor | null> { return null }
```

**Step 8: Implement domain goal methods**

The SQLite adapter currently has stub domain goal methods. If we want SQLite to work offline, implement them against a local `domain_goals` table. If not, keep stubs.

Decision: **Keep stubs.** Domain goals are managed in Supabase. SQLite is a local fallback for sessions, memories, and tasks.

**Step 9: Run typecheck**

Run: `npm run typecheck`
Expected: Should pass or be very close.

**Step 10: Commit**

```bash
git add src/adapters/data/sqlite.ts
git commit -m "feat: update SQLite adapter for unified schema"
```

---

### Task 7: Update Turso Adapter

Same changes as SQLite but for the Turso (cloud SQLite) adapter.

**Files:**
- Modify: `src/adapters/data/turso.ts`

**Step 1: Apply same changes as Task 6**

- Update schema statements
- Remove deprecated methods (decisions, domain notes)
- Update task/project methods (remove legacy fields, lowercase task_type)
- Add briefing methods (async versions using `client.execute()`)
- Add advisor method stubs
- Remove customer_id references

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/adapters/data/turso.ts
git commit -m "feat: update Turso adapter for unified schema"
```

---

### Task 8: Update Tests

Update the SQLite adapter test suite to match the new schema.

**Files:**
- Modify: `tests/sqlite-adapter.test.ts`

**Step 1: Read current tests**

Read `tests/sqlite-adapter.test.ts`.

**Step 2: Update task tests**

- Change `task_type` values from uppercase to lowercase: `'STANDARD'` → `'standard'`, `'MIT'` → `'mit'`, `'MUST'` → `'must'`
- Remove any references to `project` string field
- Use `project_id` instead where needed

**Step 3: Update project tests**

- Remove `goals` array from test project creation
- Use `north_star` and `guardrails` instead
- Remove milestone assertions

**Step 4: Add briefing tests**

```typescript
it('saves and retrieves briefings', async () => {
  const id = await adapter.saveBriefing('morning', 'Test briefing content', 'fbs')
  expect(id).toBeTruthy()

  const latest = await adapter.getLatestBriefing('morning')
  expect(latest).toBeTruthy()
  expect(latest!.content).toBe('Test briefing content')
  expect(latest!.type).toBe('morning')

  const all = await adapter.listBriefings(10)
  expect(all.length).toBe(1)
})
```

**Step 5: Remove decision and domain note tests (if any)**

Check for and remove any tests that reference `logDecision`, `getDecisions`, `addDomainNote`, `getDomainNotes`.

**Step 6: Run tests**

Run: `npm test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add tests/sqlite-adapter.test.ts
git commit -m "test: update adapter tests for unified schema"
```

---

### Task 9: Fix All Remaining Type Errors

After the adapter changes, there will be compilation errors across the codebase from removed/renamed fields. Fix them all.

**Files:**
- Potentially modify: `src/runtime/runtime.ts`, `src/runtime/task-executor.ts`, `src/runtime/gap-analyzer.ts`, `src/runtime/context-writer.ts`, `src/runtime/system-prompt-builder.ts`, `src/daemon/index.ts`, `src/cli.ts`, and any other files that reference old types

**Step 1: Run typecheck and collect all errors**

Run: `npm run typecheck 2>&1 | head -100`

**Step 2: Fix each error**

Common fixes:
- `task.project` → `task.project_id` (string → UUID)
- `task.task_type` uppercase → lowercase
- `project.goals` → removed (use north_star instead)
- `project.quarterly_goal` → removed
- `project.milestones` → removed
- `project.metadata` → removed
- `data.logDecision()` → remove call or comment out
- `data.addDomainNote()` → remove call or comment out
- `data.getDecisions()` → remove call or comment out
- `data.getDomainNotes()` → remove call or comment out
- Any `customer_id` references in non-KB code → remove

**Step 3: Run typecheck again**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Run tests**

Run: `npm test`
Expected: All tests PASS

**Step 5: Run lint**

Run: `npm run lint`
Expected: PASS (may need to fix unused imports)

**Step 6: Commit**

```bash
git add -A
git commit -m "fix: resolve all type errors from unified schema migration"
```

---

### Task 10: Update Internal Tools

Update the MCP tools to match the new schema and add new tools for briefings, advisors, and content.

**Files:**
- Modify: `src/tools/internal-tools.ts`

**Step 1: Read the current file**

Read `src/tools/internal-tools.ts`.

**Step 2: Update task tools**

- `create_task`: Remove `project` string param. Keep `project_id`. Default `task_type` to `'standard'` (lowercase). Remove uppercase task_type references from description.
- `update_task`: Same changes.
- `list_tasks`: Add `assignee` filter param. Update task_type description to lowercase values.
- Tool descriptions: Update to reference lowercase task types.

**Step 3: Update project tools**

- `create_project`: Remove `goals`, `quarterly_goal`, `milestones` params. Keep `north_star`, `guardrails`, `refinement_cadence`.
- `update_project`: Same cleanup.
- `list_projects`: Remove goals/milestones from output formatting. Show north_star, guardrails, refinement_cadence.

**Step 4: Update get_planning_context**

- Remove references to `project.goals`, `project.quarterly_goal`, `project.milestones`
- Remove "Big Rocks" section parsing from master-plan.md
- Keep domain goals section, active projects with North Stars, open tasks, last planning session

**Step 5: Add briefing tools**

```typescript
const saveBriefing = tool(
  'save_briefing',
  'Save a briefing (morning dashboard, closeout, or weekly review)',
  {
    type: z.enum(['morning', 'closeout', 'weekly_review', 'custom']).describe('Briefing type'),
    content: z.string().describe('Briefing content in markdown'),
    domain: z.string().optional().describe('Domain scope (null = cross-domain)'),
  },
  async (args) => {
    const id = await data.saveBriefing(args.type, args.content, args.domain)
    return { content: [{ type: 'text' as const, text: `Briefing saved: ${id}` }] }
  }
)

const getLatestBriefing = tool(
  'get_latest_briefing',
  'Get the most recent briefing, optionally filtered by type',
  {
    type: z.enum(['morning', 'closeout', 'weekly_review', 'custom']).optional(),
  },
  async (args) => {
    const briefing = await data.getLatestBriefing(args.type)
    if (!briefing) return { content: [{ type: 'text' as const, text: 'No briefings found.' }] }
    return { content: [{ type: 'text' as const, text: `**${briefing.type}** (${briefing.created_at})\n\n${briefing.content}` }] }
  }
)
```

**Step 6: Add advisor tools**

```typescript
const listAdvisors = tool(
  'list_advisors',
  'List available advisors, optionally filtered by expertise area',
  {
    expertise: z.string().optional().describe('Filter by expertise keyword (e.g., "pricing", "product", "leadership")'),
  },
  async (args) => {
    const advisors = await data.listAdvisors(args.expertise)
    if (advisors.length === 0) return { content: [{ type: 'text' as const, text: 'No advisors found.' }] }
    const text = advisors.map(a => `**${a.display_name}** (${a.role})\nExpertise: ${a.expertise.join(', ')}`).join('\n\n')
    return { content: [{ type: 'text' as const, text }] }
  }
)

const getAdvisorPrompt = tool(
  'get_advisor_prompt',
  'Get an advisor\'s full system prompt for consultation. Use when a conversation topic matches an advisor\'s expertise.',
  {
    name: z.string().describe('Advisor name slug (e.g., "steve-jobs", "warren-buffett")'),
  },
  async (args) => {
    const advisor = await data.getAdvisorByName(args.name)
    if (!advisor) return errorResult(`Advisor "${args.name}" not found.`)
    return { content: [{ type: 'text' as const, text: advisor.system_prompt }] }
  }
)
```

**Step 7: Add tools to the tool list**

Add `saveBriefing`, `getLatestBriefing`, `listAdvisors`, `getAdvisorPrompt` to the `toolList` array in the factory function.

**Step 8: Run typecheck and tests**

Run: `npm run typecheck && npm test && npm run lint`
Expected: All PASS

**Step 9: Commit**

```bash
git add src/tools/internal-tools.ts
git commit -m "feat: update internal tools — add briefings, advisors; clean up legacy fields"
```

---

### Task 11: Update Trigger.dev Tasks

Update the cloud tasks to use the new schema and write briefings to the database.

**Files:**
- Modify: `src/trigger/utils.ts`
- Modify: `src/trigger/morning.ts`
- Modify: `src/trigger/closeout.ts`
- Modify: `src/trigger/review.ts`
- Modify: `src/trigger/execute-task.ts`

**Step 1: Update `src/trigger/utils.ts`**

- Remove `customer_id` from any queries that reference it (keep it in KB queries only)
- `getCloudTasks()`: Remove `project` string field, ensure `project_id` is used
- `getCloudProjects()`: Remove `goals`, `quarterly_goal`, `milestones`, `metadata` from select — use `name, domain, north_star, guardrails, status, refinement_cadence`
- Add `saveBriefing()` utility:

```typescript
export async function saveBriefing(
  client: SupabaseClient,
  type: 'morning' | 'closeout' | 'weekly_review',
  content: string,
  domain?: string,
): Promise<string> {
  const id = crypto.randomUUID()
  await client.from('briefings').insert({ id, type, content, domain: domain ?? null })
  return id
}
```

**Step 2: Update morning.ts, closeout.ts, review.ts**

In each file, after saving to memories, also save to briefings:

```typescript
// Save to briefings table (for ChiefOfStaff app)
await saveBriefing(client, 'morning', result)
```

Add `saveBriefing` to the import from `./utils.js`.

**Step 3: Update execute-task.ts**

- `task_type` references: ensure lowercase
- Remove any `project` string field references, use `project_id`

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/trigger/
git commit -m "feat: update Trigger.dev tasks — save briefings, clean up legacy fields"
```

---

### Task 12: Update System Prompt Builder

Ensure the system prompt references the correct tool names and schema.

**Files:**
- Modify: `src/runtime/system-prompt-builder.ts`

**Step 1: Read the current file**

Read `src/runtime/system-prompt-builder.ts`.

**Step 2: Update tool references**

- Add `save_briefing`, `get_latest_briefing` to the tools section
- Add `list_advisors`, `get_advisor_prompt` to the tools section
- Update task_type descriptions to lowercase
- Remove any references to `goals`, `milestones`, `quarterly_goal`

**Step 3: Add advisor consultation guidance**

Add to the system prompt (in the planning framework section or a new section):

```
## Advisors

You have access to expert advisors who can inform your thinking. When a conversation touches on product design, pricing, leadership, marketing, or other specialized topics, use `list_advisors` to find relevant experts and `get_advisor_prompt` to load their perspective. Weave their insights into your recommendations naturally — don't announce "I'm consulting an advisor" unless Wayne asks.
```

**Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS (system prompt builder tests may need updating if they assert specific strings)

**Step 5: Commit**

```bash
git add src/runtime/system-prompt-builder.ts
git commit -m "feat: update system prompt — add advisor and briefing tool references"
```

---

### Task 13: Run the Migration Against Live Supabase

**This is a destructive operation.** Back up first.

**Step 1: Verify what will be preserved**

Connect to HughMann's Supabase dashboard. Confirm these tables exist and have data:
- `kb_nodes` — should have rows from Elle's Obsidian sync
- `kb_edges` — may have rows
- `memory_embeddings` — should have vector entries

**Step 2: Export backup (optional but recommended)**

From Supabase dashboard SQL editor:
```sql
-- Count rows in tables to be dropped
SELECT 'sessions' as tbl, count(*) FROM sessions
UNION ALL SELECT 'memories', count(*) FROM memories
UNION ALL SELECT 'tasks', count(*) FROM tasks
UNION ALL SELECT 'projects', count(*) FROM projects
UNION ALL SELECT 'domain_goals', count(*) FROM domain_goals;
```

If any important data exists, export it first.

**Step 3: Run the migration**

In Supabase dashboard SQL editor, paste and run the contents of `supabase/migrations/20260308_unified_schema.sql`.

**Step 4: Seed advisor data**

Read `supabase/seed/advisors.json` and generate INSERT statements, then run in SQL editor. Or write a quick script:

```bash
node -e "
const advisors = require('./supabase/seed/advisors.json');
for (const a of advisors) {
  const prompt = a.system_prompt.replace(/'/g, \"''\");
  console.log(\`INSERT INTO advisors (name, display_name, role, expertise, system_prompt, avatar_url) VALUES ('\${a.name}', '\${a.display_name}', '\${a.role}', ARRAY[\${a.expertise.map(e => \"'\" + e + \"'\").join(',')}], '\${prompt}', \${a.avatar_url ? \"'\" + a.avatar_url + \"'\" : 'NULL'});\`);
}
"
```

**Step 5: Verify migration**

```sql
-- Should return 14 tables (excluding preserved ones)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Should return 6 domain goals
SELECT * FROM domain_goals;

-- Should return advisors
SELECT name, role FROM advisors;

-- KB data should be intact
SELECT count(*) FROM kb_nodes;
```

**Step 6: Rebuild and test locally**

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

**Step 7: Commit and push**

```bash
git add -A
git commit -m "chore: migration verified against live Supabase"
git push
```

---

### Task 14: Full Verification and Smoke Test

**Step 1: Run all checks**

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

All must pass.

**Step 2: Smoke test Hugh**

```bash
npm run dev
```

Try these commands:
- "List domain goals" — should show 6 goals
- "List projects" — should show empty (fresh start)
- "Create a project called 'freebeer.ai' in the fbs domain with North Star: 'Steady stream of small business clients...'" — should create project
- "List tasks" — should be empty
- "List advisors" — should show all migrated advisors

**Step 3: Test Trigger.dev connection**

Verify Trigger.dev tasks still deploy and can read from the new tables.

**Step 4: Final commit and push**

```bash
git push
```

---

## File Summary

| Path | Action | Purpose |
|------|--------|---------|
| `supabase/seed/advisors.json` | Create | Exported advisor data from Platform |
| `supabase/migrations/20260308_unified_schema.sql` | Create | Full migration: drop old + create new |
| `src/types/projects.ts` | Rewrite | Clean Project, DomainGoal types |
| `src/types/tasks.ts` | Rewrite | Clean Task types, lowercase task_type |
| `src/types/content.ts` | Create | ContentPiece, Topic, ContentSource types |
| `src/types/advisors.ts` | Create | Advisor type |
| `src/adapters/data/types.ts` | Rewrite | Updated DataAdapter interface |
| `src/adapters/data/supabase.ts` | Rewrite | New schema queries, briefings, advisors |
| `src/adapters/data/sqlite.ts` | Modify | Match new schema, add briefings |
| `src/adapters/data/turso.ts` | Modify | Match new schema, add briefings |
| `src/tools/internal-tools.ts` | Modify | Add briefing/advisor tools, clean legacy |
| `src/trigger/utils.ts` | Modify | Add saveBriefing, clean legacy fields |
| `src/trigger/morning.ts` | Modify | Save to briefings table |
| `src/trigger/closeout.ts` | Modify | Save to briefings table |
| `src/trigger/review.ts` | Modify | Save to briefings table |
| `src/trigger/execute-task.ts` | Modify | Lowercase task_type, clean legacy |
| `src/runtime/system-prompt-builder.ts` | Modify | Add advisor/briefing tool docs |
| `tests/sqlite-adapter.test.ts` | Modify | Match new schema, add briefing tests |
| Various runtime files | Modify | Fix type errors from schema changes |
