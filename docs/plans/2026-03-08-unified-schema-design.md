# Unified Supabase Schema — Design

## Overview

Consolidate HughMann, Platform, and ChiefOfStaff into a single Supabase project with a clean schema. Reuse HughMann's existing Supabase project (preserving KB and vector data), drop all other tables, and rebuild with 15 tables organized into 6 modules.

## North Star

One database, one source of truth. HughMann CLI, ChiefOfStaff iOS, Trigger.dev tasks, and any future frontends all connect to the same Supabase project. No API middleware — frontends read/write directly, invoke Hugh via Trigger.dev only when AI reasoning is needed.

## Architecture

```
ChiefOfStaff iOS          HughMann CLI          Trigger.dev
        │                       │                     │
        └───────────┬───────────┘─────────────────────┘
                    │
              Supabase (single project)
              ├── Planning (pyramid)
              ├── Memory (sessions, distillation, briefings)
              ├── Knowledge (KB + advisors)
              ├── Content (topics, radar, pipeline)
              ├── CRM (customers)
              └── Operations (feedback, context docs)
```

### iOS App Interaction Model

The ChiefOfStaff app connects directly to Supabase for all CRUD:
- View/edit tasks, mark complete, change priority
- Browse projects, see North Star and sprint status
- Approve/reject content drafts (tap to approve)
- View briefings (morning dashboard, closeout, weekly review)
- Check customer list, view account details
- Quick-capture ideas or tasks

When AI reasoning is needed (planning sessions, content generation, sprint creation), the app invokes Hugh via Trigger.dev.

### Advisor Model

Advisors (Jobs, Buffett, Hormozi, etc.) are database records with rich system prompts. Hugh consults them automatically during conversations — when he detects a topic touching an advisor's expertise, he pulls their prompt and incorporates their perspective into his own thinking. No separate advisor chat UI. The user never has to think about calling an advisor.

## Design Principles

- **Domain is a string, not a FK.** `domain TEXT` column on tables that need isolation. Values: `fbs`, `omnissa`, `personal`.
- **No SaaS overhead.** No auth linking, no billing tables, no module feature flags, no per-tenant RLS. Single user, single service key.
- **Pyramid is the spine.** `domain_goals` → `projects` (North Star + guardrails) → `tasks` (sprint + assignee).
- **Preserved tables stay untouched.** `kb_nodes`, `kb_edges`, `memory_embeddings` keep current schemas.
- **JSONB for flexibility, columns for queries.** Filter/sort fields are columns. Display-only data is JSONB.

## Schema

### Module 1: Planning

```sql
-- Domain Goals: permanent guiding lights
CREATE TABLE domain_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      TEXT NOT NULL,
  statement   TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_domain_goals_domain ON domain_goals(domain);

-- Projects: North Star + guardrails
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

-- Tasks: assigned work
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
```

### Module 2: Memory

```sql
-- Chat sessions
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT,
  domain        TEXT,
  messages      JSONB DEFAULT '[]',
  message_count INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Distilled memories
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

-- Planning session records
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

-- Briefings from Trigger.dev scheduled tasks
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
```

### Module 3: Knowledge

```sql
-- PRESERVED: kb_nodes (unchanged)
-- PRESERVED: kb_edges (unchanged)
-- PRESERVED: memory_embeddings (unchanged)
-- PRESERVED: search_kb_nodes RPC (unchanged)
-- PRESERVED: search_memory_v2 RPC (unchanged)

-- Advisors: expert personas Hugh consults automatically
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
```

### Module 4: Content

```sql
-- Curated feeds for the weekly radar
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

-- Content themes (your strategic filter)
CREATE TABLE topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      TEXT NOT NULL DEFAULT 'fbs',
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Content pipeline: idea → draft → review → publish
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
```

### Module 5: CRM

```sql
-- Customers: reference data for FBS clients and Omnissa accounts
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
```

### Module 6: Operations

```sql
-- Feedback signals for self-improvement
CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT,
  signal      TEXT NOT NULL
              CHECK (signal IN ('positive','negative','correction')),
  category    TEXT,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Context docs for Trigger.dev cloud access
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
```

### RLS Policies

```sql
-- Simple: authenticated user can do everything
-- Applied to all new tables
ALTER TABLE domain_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Full access" ON domain_goals FOR ALL USING (true) WITH CHECK (true);
-- (repeat for all tables)

-- Service role bypasses RLS (HughMann CLI, Trigger.dev)
-- Authenticated role uses policies (ChiefOfStaff iOS app)
```

## Table Summary

| Module | Tables | New/Preserved |
|--------|--------|---------------|
| Planning | domain_goals, projects, tasks | New |
| Memory | sessions, memories, planning_sessions, briefings | New |
| Knowledge | kb_nodes, kb_edges, advisors | 2 preserved + 1 new |
| Content | content_sources, topics, content | New |
| CRM | customers | New |
| Operations | feedback, context_docs | New |

**15 tables total** (down from ~30 across two databases).

Plus preserved: `memory_embeddings` table, `search_kb_nodes` RPC, `search_memory_v2` RPC.

## What Gets Dropped

### From HughMann's current schema
- `decisions` table (rarely used, context writer handles this in files)
- `domain_notes` table (superseded by KB nodes and memory)
- `hughmann_customer_id()` SQL function (no more customer_id mapping)

### From Platform
- `big_rocks` table (pyramid model replaces quarterly goals)
- `tasks` table (incompatible schema, replaced by new tasks)
- `projects` table (incompatible schema, replaced by new projects)
- `brands` table (YAGNI for now — brand voice lives in Mark's skill prompt)
- `customer_auth_links` table (single user, no multi-tenant auth)
- `customer_modules` table (no feature flags needed)
- `time_entries` table (no time tracking)
- `invoices` table (use Stripe/QuickBooks if needed)
- `newsletter_editions` table (content table handles this)
- `newsletter_assignments` table (not needed)
- `chats` table (advisory chats replaced by Hugh consulting advisors internally)
- `messages` table (same)
- `advisors` table (rebuilt with expertise array)
- `teams`, `team_members` tables (agents are skills, not DB records)
- `profiles` table (single user)
- `ideas`, `idea_sources` tables (rebuilt as content, content_sources, topics)
- `schema_migrations` table (using Supabase migrations natively)

## Migration Strategy

1. **Preserve** kb_nodes, kb_edges, memory_embeddings, RPC functions — do not touch
2. **Export** advisor system_prompts from Platform's Supabase before dropping
3. **Export** any customer data from Platform worth keeping
4. **Drop** all other tables in HughMann's Supabase
5. **Run** new migration SQL to create the 13 new tables
6. **Seed** domain goals (3), advisors (migrated from Platform)
7. **Update** HughMann's DataAdapter to match new schema
8. **Update** Trigger.dev tasks to use new table names/columns
9. **Update** internal tools to match new schema

## Content Engine Workflow

### Weekly Rhythm

1. **Radar** (Trigger.dev weekly task): Mark scans content_sources against active topics. Creates `content` rows with `status: 'idea'` and populated `source_material`.
2. **Planning** (you + Hugh): Review radar finds, pick what resonates, add your own ideas. 15-minute conversation.
3. **Drafting** (Mark agent): For each approved topic, Mark writes platform-specific content. One `content` row per platform (blog version, LinkedIn version, etc.).
4. **Review** (you in ChiefOfStaff app): Tap to approve/reject. Approved content moves to `scheduled`.
5. **Publish** (Trigger.dev scheduled task): Posts approved content on schedule. Updates `published_at` and `published_url`.

### Topic Management

You define 5-10 evergreen topics quarterly, aligned to FBS's North Star. The radar only surfaces material related to these topics. This is the filter that prevents the firehose.
