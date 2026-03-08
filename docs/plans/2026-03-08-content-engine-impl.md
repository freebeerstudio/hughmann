# Content Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the content pipeline — radar scans RSS sources, scores relevance, surfaces ideas via MCP tools, Mark drafts approved content, manual publishing.

**Architecture:** Trigger.dev weekly radar fetches RSS → LLM scores against topics → creates content ideas in DB. Hugh reviews via MCP tools. Mark drafts approved ideas locally. Manual publish.

**Tech Stack:** TypeScript/ESM, Supabase (Postgres), Trigger.dev v4, OpenRouter (cloud LLM), RSS XML parsing, Zod schemas.

---

### Task 1: Add content tables to SQLite and Turso schemas

**Files:**
- Modify: `src/adapters/data/sqlite.ts` (SCHEMA_SQL, add 3 tables)
- Modify: `src/adapters/data/turso.ts` (SCHEMA_STATEMENTS, add 3 tables)

**Step 1: Add tables to SQLite SCHEMA_SQL**

Add after the `advisors` table in SCHEMA_SQL:

```sql
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
```

**Step 2: Add same tables to Turso SCHEMA_STATEMENTS**

Add as individual statement strings (no semicolons) in the same format as existing Turso statements.

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no new type errors, just schema additions)

**Step 4: Commit**

```bash
git add src/adapters/data/sqlite.ts src/adapters/data/turso.ts
git commit -m "feat: add content, topics, content_sources tables to SQLite/Turso schemas"
```

---

### Task 2: Add Supabase migration for content tables

**Files:**
- Create: `supabase/migrations/20260308120000_content_tables.sql`

**Step 1: Write migration SQL**

```sql
-- Content pipeline tables (topics, content_sources, content)
-- These may already exist from the unified schema migration.
-- Use IF NOT EXISTS for safety.

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
```

**Step 2: Push migration**

Run: `npx supabase db push`
Expected: Migration applied successfully.

**Step 3: Commit**

```bash
git add supabase/migrations/20260308120000_content_tables.sql
git commit -m "feat: add Supabase migration for content pipeline tables"
```

---

### Task 3: Add content methods to DataAdapter interface

**Files:**
- Modify: `src/adapters/data/types.ts`

**Step 1: Add imports**

Add to existing imports:

```typescript
import type { ContentPiece, Topic, ContentSource, ContentStatus, ContentPlatform, ContentSourceType } from '../../types/content.js'
```

**Step 2: Add content section to DataAdapter**

Add after the Advisors section, before Feedback:

```typescript
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
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL — all 3 adapters now missing the new methods (this is correct).

**Step 4: Commit**

```bash
git add src/adapters/data/types.ts
git commit -m "feat: add content, topics, content_sources methods to DataAdapter interface"
```

---

### Task 4: Implement content methods in Supabase adapter

**Files:**
- Modify: `src/adapters/data/supabase.ts`

**Step 1: Add import**

```typescript
import type { ContentPiece, Topic, ContentSource, ContentStatus, ContentSourceType } from '../../types/content.js'
```

**Step 2: Add Content section**

Add after the Advisors section. Pattern follows existing adapter methods (query builder with filters, upsert for updates).

```typescript
  // ─── Content ──────────────────────────────────────────────────────────

  async listContent(filters?: {
    status?: ContentStatus | ContentStatus[]
    domain?: string
    topic_id?: string
    limit?: number
  }): Promise<ContentPiece[]> {
    if (!this.ready) return []
    let query = this.client.from('content').select('*')
      .order('created_at', { ascending: false })
    if (filters?.status) {
      if (Array.isArray(filters.status)) query = query.in('status', filters.status)
      else query = query.eq('status', filters.status)
    }
    if (filters?.domain) query = query.eq('domain', filters.domain)
    if (filters?.topic_id) query = query.eq('topic_id', filters.topic_id)
    if (filters?.limit) query = query.limit(filters.limit)
    const { data } = await query
    return (data ?? []).map(parseContentRow)
  }

  async createContent(input: {
    domain: string; title: string; topic_id?: string; project_id?: string
    status?: ContentStatus; platform?: ContentPlatform; body?: string
    source_material?: { url: string; title: string; summary: string }[]
    created_by?: string
  }): Promise<ContentPiece> {
    const id = randomUUID()
    const { data, error } = await this.client.from('content').insert({
      id, domain: input.domain, title: input.title,
      topic_id: input.topic_id ?? null, project_id: input.project_id ?? null,
      status: input.status ?? 'idea', platform: input.platform ?? 'blog',
      body: input.body ?? null, source_material: input.source_material ?? [],
      created_by: input.created_by ?? 'manual',
    }).select('*').single()
    if (error) throw new Error(error.message)
    return parseContentRow(data)
  }

  async updateContent(id: string, input: Record<string, unknown>): Promise<ContentPiece | null> {
    const updates = stripUndefined({ ...input, updated_at: new Date().toISOString() })
    const { data, error } = await this.client.from('content').update(updates).eq('id', id).select('*').single()
    if (error || !data) return null
    return parseContentRow(data)
  }

  async getContent(id: string): Promise<ContentPiece | null> {
    const { data } = await this.client.from('content').select('*').eq('id', id).single()
    return data ? parseContentRow(data) : null
  }

  // ─── Topics ───────────────────────────────────────────────────────────

  async listTopics(filters?: { domain?: string; active?: boolean }): Promise<Topic[]> {
    if (!this.ready) return []
    let query = this.client.from('topics').select('*').order('name')
    if (filters?.domain) query = query.eq('domain', filters.domain)
    if (filters?.active !== undefined) query = query.eq('active', filters.active)
    const { data } = await query
    return data ?? []
  }

  async createTopic(input: { domain: string; name: string; description?: string }): Promise<Topic> {
    const id = randomUUID()
    const { data, error } = await this.client.from('topics').insert({
      id, domain: input.domain, name: input.name, description: input.description ?? null,
    }).select('*').single()
    if (error) throw new Error(error.message)
    return data
  }

  async updateTopic(id: string, input: { name?: string; description?: string; active?: boolean }): Promise<Topic | null> {
    const updates = stripUndefined(input as Record<string, unknown>)
    const { data } = await this.client.from('topics').update(updates).eq('id', id).select('*').single()
    return data ?? null
  }

  // ─── Content Sources ──────────────────────────────────────────────────

  async listContentSources(filters?: { domain?: string; active?: boolean; type?: ContentSourceType }): Promise<ContentSource[]> {
    if (!this.ready) return []
    let query = this.client.from('content_sources').select('*').order('name')
    if (filters?.domain) query = query.eq('domain', filters.domain)
    if (filters?.active !== undefined) query = query.eq('active', filters.active)
    if (filters?.type) query = query.eq('type', filters.type)
    const { data } = await query
    return data ?? []
  }

  async createContentSource(input: { domain: string; name: string; type?: ContentSourceType; url?: string }): Promise<ContentSource> {
    const id = randomUUID()
    const { data, error } = await this.client.from('content_sources').insert({
      id, domain: input.domain, name: input.name, type: input.type ?? 'rss', url: input.url ?? null,
    }).select('*').single()
    if (error) throw new Error(error.message)
    return data
  }

  async updateContentSource(id: string, input: { name?: string; url?: string; active?: boolean }): Promise<ContentSource | null> {
    const updates = stripUndefined(input as Record<string, unknown>)
    const { data } = await this.client.from('content_sources').update(updates).eq('id', id).select('*').single()
    return data ?? null
  }
```

Also add a `parseContentRow` helper and `stripUndefined` if not already available as a module-level function:

```typescript
function parseContentRow(row: Record<string, unknown>): ContentPiece {
  return {
    ...row,
    source_material: Array.isArray(row.source_material) ? row.source_material : JSON.parse(String(row.source_material || '[]')),
  } as ContentPiece
}
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Supabase adapter errors gone. SQLite and Turso still missing.

**Step 4: Commit**

```bash
git add src/adapters/data/supabase.ts
git commit -m "feat: implement content methods in Supabase adapter"
```

---

### Task 5: Implement content methods in SQLite adapter

**Files:**
- Modify: `src/adapters/data/sqlite.ts`

**Step 1: Add import**

```typescript
import type { ContentPiece, Topic, ContentSource, ContentStatus, ContentPlatform, ContentSourceType } from '../../types/content.js'
```

**Step 2: Add content methods**

Follow the same pattern as existing SQLite methods (prepared statements, `...params` spread for better-sqlite3).

Key patterns:
- `listContent`: `SELECT * FROM content WHERE ... ORDER BY created_at DESC`
- `createContent`: `INSERT INTO content (...) VALUES (...) RETURNING *`
- `updateContent`: Build SET clause dynamically from non-undefined fields
- `source_material`: Store as JSON text, parse on read
- `active` field: SQLite uses INTEGER (0/1) but return as boolean
- Topics/Sources follow same pattern

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: SQLite adapter errors gone. Turso still missing.

**Step 4: Commit**

```bash
git add src/adapters/data/sqlite.ts
git commit -m "feat: implement content methods in SQLite adapter"
```

---

### Task 6: Implement content methods in Turso adapter

**Files:**
- Modify: `src/adapters/data/turso.ts`

**Step 1: Add import**

Same as SQLite.

**Step 2: Add content methods**

Mirror SQLite logic but use `client.execute({ sql, args })` pattern. Parse rows through extractor functions.

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — all adapters implement the interface.

**Step 4: Run tests**

Run: `npm test`
Expected: All existing tests pass.

**Step 5: Commit**

```bash
git add src/adapters/data/turso.ts
git commit -m "feat: implement content methods in Turso adapter"
```

---

### Task 7: Add content MCP tools to internal-tools.ts

**Files:**
- Modify: `src/tools/internal-tools.ts`

**Step 1: Add imports**

```typescript
import type { ContentStatus, ContentPlatform, ContentSourceType } from '../types/content.js'
```

**Step 2: Add 6 content tools**

Add before the toolList array. Follow existing tool pattern (Zod schema, try/catch, errorResult):

1. **`list_content`** — List content by status, domain, topic. Params: `status` (optional), `domain` (optional), `topic_id` (optional), `limit` (optional, default 20).

2. **`create_content`** — Create a content idea manually. Params: `domain` (required), `title` (required), `topic_id` (optional), `platform` (optional), `body` (optional), `source_url` (optional), `source_title` (optional), `source_summary` (optional).

3. **`update_content`** — Update content status, body, notes. Params: `id` (required), `status` (optional), `title` (optional), `body` (optional), `platform` (optional), `scheduled_at` (optional), `published_url` (optional).

4. **`manage_topics`** — List/create/update topics. Params: `action` (enum: list/create/update), `domain` (optional for list), `name` (for create), `description` (optional), `id` (for update), `active` (for update).

5. **`manage_content_sources`** — List/create/update sources. Params: `action` (enum: list/create/update), `domain` (optional for list), `name` (for create), `url` (for create), `type` (optional), `id` (for update), `active` (for update).

6. **`review_content_radar`** — Show latest radar results (ideas). Shortcut that calls `listContent({ status: 'idea', limit: 20 })`.

**Step 3: Add new tools to toolList**

```typescript
const toolList = [
  // ... existing tools ...
  // Content
  listContent, createContent, updateContent,
  manageTopics, manageContentSources, reviewContentRadar,
  // ... rest
]
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/internal-tools.ts
git commit -m "feat: add 6 content MCP tools (list, create, update, topics, sources, radar review)"
```

---

### Task 8: Add content tool references to system prompt builder

**Files:**
- Modify: `src/runtime/system-prompt-builder.ts`

**Step 1: Update tools section**

In the `hasTools` section that lists tools, add content tools:

```typescript
- **list_content** / **create_content** / **update_content** — Manage content pipeline (ideas, drafts, published)
- **manage_topics** — Manage content topics for radar matching
- **manage_content_sources** — Manage RSS feeds and content sources
- **review_content_radar** — Review latest content ideas from the radar scan
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/runtime/system-prompt-builder.ts
git commit -m "feat: add content tools to system prompt builder"
```

---

### Task 9: Build Trigger.dev content radar task

**Files:**
- Create: `src/trigger/content-radar.ts`

**Step 1: Write the radar task**

```typescript
import { task, schedules } from '@trigger.dev/sdk/v3'
import { getSupabaseClient, callModel } from './utils.js'

export const contentRadar = task({
  id: 'content-radar',
  run: async () => {
    const client = getSupabaseClient()

    // 1. Fetch active sources
    const { data: sources } = await client
      .from('content_sources')
      .select('*')
      .eq('active', true)

    if (!sources?.length) return { success: true, ideas: 0, message: 'No active sources' }

    // 2. Fetch active topics
    const { data: topics } = await client
      .from('topics')
      .select('*')
      .eq('active', true)

    if (!topics?.length) return { success: true, ideas: 0, message: 'No active topics' }

    // 3. Fetch RSS feeds (best-effort)
    const articles: { title: string; url: string; summary: string; source: string }[] = []
    for (const source of sources) {
      if (source.type !== 'rss' || !source.url) continue
      try {
        const items = await fetchRssFeed(source.url, source.name)
        articles.push(...items)
      } catch {
        // Skip failed feeds
      }
    }

    if (!articles.length) return { success: true, ideas: 0, message: 'No new articles found' }

    // 4. Deduplicate against existing content
    const { data: existing } = await client
      .from('content')
      .select('source_material')

    const existingUrls = new Set(
      (existing ?? []).flatMap((c: Record<string, unknown>) => {
        const sm = Array.isArray(c.source_material) ? c.source_material : []
        return sm.map((s: { url: string }) => s.url)
      })
    )

    const newArticles = articles
      .filter(a => !existingUrls.has(a.url))
      .slice(0, 50)

    if (!newArticles.length) return { success: true, ideas: 0, message: 'All articles already seen' }

    // 5. Score relevance via LLM
    const topicList = topics.map((t: { name: string; description: string }) =>
      `- ${t.name}: ${t.description || 'No description'}`
    ).join('\n')

    const articleList = newArticles.map((a, i) =>
      `${i + 1}. "${a.title}" (${a.source})\n   ${a.summary}`
    ).join('\n\n')

    const scoringPrompt = `You are a content relevance scorer. Given these topics and articles, identify which articles are relevant to which topics.

## Topics
${topicList}

## Articles
${articleList}

For each relevant match (relevance >= 0.6), output a JSON array of objects:
[{ "article_index": 1, "topic_name": "Topic Name", "relevance": 0.8, "angle": "Brief suggested angle" }]

Only include matches with relevance >= 0.6. If no matches, return [].
Return ONLY the JSON array, no other text.`

    let matches: { article_index: number; topic_name: string; relevance: number; angle: string }[] = []
    try {
      const response = await callModel(scoringPrompt)
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (jsonMatch) matches = JSON.parse(jsonMatch[0])
    } catch {
      // If scoring fails, skip — don't create unscored ideas
    }

    // 6. Create content rows for matches
    let created = 0
    for (const match of matches) {
      const article = newArticles[match.article_index - 1]
      if (!article) continue

      const topic = topics.find((t: { name: string }) =>
        t.name.toLowerCase() === match.topic_name.toLowerCase()
      )

      await client.from('content').insert({
        domain: 'fbs',
        title: article.title,
        topic_id: topic?.id ?? null,
        status: 'idea',
        platform: 'blog',
        source_material: [{ url: article.url, title: article.title, summary: article.summary }],
        created_by: 'radar',
      })
      created++
    }

    // 7. Send Telegram summary (best-effort)
    if (created > 0) {
      try {
        const summary = `📡 Content Radar: ${created} new ideas from ${sources.length} sources`
        await sendTelegramNotification(summary)
      } catch {
        // Non-critical
      }
    }

    return { success: true, ideas: created, articles_scanned: newArticles.length }
  },
})
```

Also add helper functions `fetchRssFeed` (HTTP fetch + XML parse for RSS 2.0 and Atom) and `sendTelegramNotification` (HTTP POST to Telegram bot API).

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/trigger/content-radar.ts
git commit -m "feat: add Trigger.dev content radar task with RSS fetch and LLM scoring"
```

---

### Task 10: Seed initial content sources and topics

**Files:**
- Create: `src/trigger/seed-content-sources.ts` (one-shot task)

**Step 1: Write seed task**

Creates a Trigger.dev task that inserts the initial ~16 RSS sources and ~5 starter topics into Supabase. Can also be run via `hughmann trigger seed-content`.

Sources:
- OpenAI Blog, Anthropic Blog, Google AI Blog, Hugging Face Blog
- Simon Willison's Weblog, The Batch, Latent Space
- Zapier Blog, Make Blog, n8n Blog
- a16z AI, Lenny's Newsletter, Stratechery
- TechCrunch Startups, Y Combinator Blog

Topics:
- AI Tools & Applications
- Automation & Workflows
- Small Business Technology
- Content & Marketing Strategy
- Web Development & Design

Each topic gets domain `fbs`. Each source gets domain `fbs`, type `rss`, active `true`.

**Step 2: Also add a CLI command to seed locally**

Add to `src/cli.ts` under the `trigger` command group:
```
hughmann trigger seed-content
```

This calls the Supabase adapter directly (no Trigger.dev needed for local seeding).

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/trigger/seed-content-sources.ts src/cli.ts
git commit -m "feat: add content source seeding (16 RSS feeds + 5 starter topics)"
```

---

### Task 11: Write tests for content adapter methods

**Files:**
- Create: `tests/content-adapter.test.ts`

**Step 1: Write SQLite adapter tests**

Test CRUD for content, topics, and content_sources using the SQLite adapter (in-memory DB).

Tests:
- `listContent` returns empty array initially
- `createContent` creates and returns a ContentPiece
- `listContent` with status filter works
- `updateContent` changes status
- `getContent` returns single item
- `listTopics` returns empty, then created topics
- `createTopic` + `updateTopic` (toggle active)
- `listContentSources` + `createContentSource` + `updateContentSource`
- `source_material` round-trips correctly as JSON

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/content-adapter.test.ts
git commit -m "test: add content pipeline adapter tests"
```

---

### Task 12: Write tests for content MCP tools

**Files:**
- Create: `tests/content-tools.test.ts`

**Step 1: Write tool integration tests**

Test the 6 content tools against a mock DataAdapter. Verify:
- `list_content` returns formatted JSON
- `create_content` creates and returns success
- `update_content` changes status
- `manage_topics` list/create/update actions
- `manage_content_sources` list/create/update actions
- `review_content_radar` returns idea-status content

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/content-tools.test.ts
git commit -m "test: add content MCP tool tests"
```

---

### Task 13: Run full test suite and lint

**Step 1: Run all checks**

```bash
npm run typecheck && npm test && npm run lint
```

Expected: All pass.

**Step 2: Fix any issues found**

**Step 3: Commit fixes if needed**

---

### Task 14: Push Supabase migration and seed data

**Step 1: Push migration**

```bash
npx supabase db push
```

Expected: Content tables created in live Supabase.

**Step 2: Seed content sources**

Run the seeding command to populate initial RSS feeds and topics.

**Step 3: Verify**

Query Supabase to confirm sources and topics exist.
