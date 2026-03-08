-- Content pipeline tables (topics, content_sources, content)
-- Safe to re-run: uses IF NOT EXISTS.

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

CREATE TABLE IF NOT EXISTS content_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rss' CHECK (type IN ('rss', 'youtube', 'newsletter', 'manual')),
  url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_sources_domain ON content_sources (domain);
CREATE INDEX IF NOT EXISTS idx_content_sources_active ON content_sources (active);

CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  topic_id UUID REFERENCES topics(id),
  project_id UUID REFERENCES projects(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'drafting', 'review', 'approved', 'scheduled', 'published', 'rejected')),
  platform TEXT NOT NULL DEFAULT 'blog' CHECK (platform IN ('blog', 'linkedin', 'x', 'newsletter', 'youtube', 'shorts')),
  body TEXT,
  source_material JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  published_url TEXT,
  created_by TEXT NOT NULL DEFAULT 'radar',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_status ON content (status);
CREATE INDEX IF NOT EXISTS idx_content_domain ON content (domain);
CREATE INDEX IF NOT EXISTS idx_content_topic ON content (topic_id);
