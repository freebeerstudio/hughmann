-- =============================================================================
-- HughMann Unified Schema Migration — 2026-03-08
-- Drops legacy tables, creates 14 new tables, indexes, RLS, and seed data.
-- Does NOT touch: kb_nodes, kb_edges, memory_embeddings, or RPC functions.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 — Drop old tables (respecting FK order)
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop HughMann legacy tables
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
DROP FUNCTION IF EXISTS hughmann_customer_id(TEXT);

-- Drop Platform tables being rebuilt in unified schema
DROP TABLE IF EXISTS advisors CASCADE;
DROP TABLE IF EXISTS briefings CASCADE;
DROP TABLE IF EXISTS content_sources CASCADE;
DROP TABLE IF EXISTS topics CASCADE;
DROP TABLE IF EXISTS content CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 — Create 14 new tables
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Planning Module ─────────────────────────────────────────────────────────

CREATE TABLE domain_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        TEXT NOT NULL,
  statement     TEXT NOT NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  description         TEXT,
  domain              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'planning'
                        CHECK (status IN ('planning','incubator','active','paused','completed','archived')),
  priority            INTEGER DEFAULT 0,
  domain_goal_id      UUID REFERENCES domain_goals(id),
  north_star          TEXT,
  guardrails          JSONB DEFAULT '[]',
  infrastructure      JSONB DEFAULT '{}',
  refinement_cadence  TEXT DEFAULT 'weekly'
                        CHECK (refinement_cadence IN ('weekly','biweekly','monthly')),
  last_refinement_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'backlog'
                      CHECK (status IN ('backlog','todo','in_progress','blocked','done')),
  task_type         TEXT DEFAULT 'standard'
                      CHECK (task_type IN ('big_rock','must','mit','standard')),
  domain            TEXT,
  project_id        UUID REFERENCES projects(id),
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

-- ── Memory Module ───────────────────────────────────────────────────────────

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

CREATE TABLE planning_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID REFERENCES sessions(id),
  focus_area       TEXT,
  topics_covered   JSONB,
  decisions_made   JSONB,
  tasks_created    JSONB,
  projects_touched JSONB,
  open_questions   JSONB,
  next_steps       JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE briefings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL
               CHECK (type IN ('morning','closeout','weekly_review','custom')),
  domain     TEXT,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Knowledge Module ────────────────────────────────────────────────────────

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

-- ── Content Module ──────────────────────────────────────────────────────────

CREATE TABLE content_sources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain     TEXT NOT NULL DEFAULT 'fbs',
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'rss'
               CHECK (type IN ('rss','youtube','newsletter','manual')),
  url        TEXT,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  topic_id        UUID REFERENCES topics(id),
  project_id      UUID REFERENCES projects(id),
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

-- ── CRM Module ──────────────────────────────────────────────────────────────

CREATE TABLE customers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT,
  company    TEXT,
  domain     TEXT NOT NULL,
  notes      TEXT,
  tags       JSONB DEFAULT '[]',
  project_id UUID REFERENCES projects(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Operations Module ───────────────────────────────────────────────────────

CREATE TABLE feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT,
  signal     TEXT NOT NULL
               CHECK (signal IN ('positive','negative','correction')),
  category   TEXT,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 — Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- domain_goals
CREATE INDEX idx_domain_goals_domain ON domain_goals(domain);

-- projects
CREATE INDEX idx_projects_domain ON projects(domain);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_domain_goal_id ON projects(domain_goal_id);
CREATE INDEX idx_projects_created_at ON projects(created_at);

-- tasks
CREATE INDEX idx_tasks_domain ON tasks(domain);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_sprint ON tasks(sprint);
CREATE INDEX idx_tasks_assignee ON tasks(assignee);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);

-- sessions
CREATE INDEX idx_sessions_domain ON sessions(domain);
CREATE INDEX idx_sessions_created_at ON sessions(created_at);

-- memories
CREATE INDEX idx_memories_domain ON memories(domain);
CREATE INDEX idx_memories_session_id ON memories(session_id);
CREATE INDEX idx_memories_memory_date ON memories(memory_date);
CREATE INDEX idx_memories_created_at ON memories(created_at);

-- planning_sessions
CREATE INDEX idx_planning_sessions_session_id ON planning_sessions(session_id);
CREATE INDEX idx_planning_sessions_created_at ON planning_sessions(created_at);

-- briefings
CREATE INDEX idx_briefings_type ON briefings(type);
CREATE INDEX idx_briefings_domain ON briefings(domain);
CREATE INDEX idx_briefings_created_at ON briefings(created_at);

-- advisors
CREATE INDEX idx_advisors_name ON advisors(name);

-- content_sources
CREATE INDEX idx_content_sources_domain ON content_sources(domain);
CREATE INDEX idx_content_sources_active ON content_sources(active);

-- topics
CREATE INDEX idx_topics_domain ON topics(domain);
CREATE INDEX idx_topics_active ON topics(active);

-- content
CREATE INDEX idx_content_domain ON content(domain);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_content_platform ON content(platform);
CREATE INDEX idx_content_topic_id ON content(topic_id);
CREATE INDEX idx_content_project_id ON content(project_id);
CREATE INDEX idx_content_created_at ON content(created_at);
CREATE INDEX idx_content_scheduled_at ON content(scheduled_at);

-- customers
CREATE INDEX idx_customers_domain ON customers(domain);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_company ON customers(company);
CREATE INDEX idx_customers_project_id ON customers(project_id);
CREATE INDEX idx_customers_created_at ON customers(created_at);

-- feedback
CREATE INDEX idx_feedback_session_id ON feedback(session_id);
CREATE INDEX idx_feedback_signal ON feedback(signal);
CREATE INDEX idx_feedback_created_at ON feedback(created_at);

-- context_docs
CREATE INDEX idx_context_docs_doc_type ON context_docs(doc_type);
CREATE INDEX idx_context_docs_domain_slug ON context_docs(domain_slug);
CREATE INDEX idx_context_docs_isolation_zone ON context_docs(isolation_zone);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4 — Enable RLS with full-access policies
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE domain_goals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_sources    ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics             ENABLE ROW LEVEL SECURITY;
ALTER TABLE content            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback           ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_docs       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "full_access_domain_goals"      ON domain_goals      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_projects"           ON projects           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_tasks"              ON tasks              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_sessions"           ON sessions           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_memories"           ON memories           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_planning_sessions"  ON planning_sessions  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_briefings"          ON briefings          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_advisors"           ON advisors           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_content_sources"    ON content_sources    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_topics"             ON topics             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_content"            ON content            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_customers"          ON customers          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_feedback"           ON feedback           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access_context_docs"       ON context_docs       FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5 — Seed domain goals
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO domain_goals (domain, statement) VALUES
  ('fbs',      'Increase revenue daily'),
  ('omnissa',  'Win every deal in my territory'),
  ('personal', 'Build the life I want'),
  ('health',   'Live longer and healthier'),
  ('ica',      'Amplify human cognition and creativity through AI'),
  ('masonic',  'Help lodges connect with each other and their communities');

COMMIT;
