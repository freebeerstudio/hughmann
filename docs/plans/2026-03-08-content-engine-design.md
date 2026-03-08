# Content Engine Design

> **Goal:** Automated content pipeline — weekly radar scans RSS sources against active topics, surfaces ideas, Mark agent drafts approved content, user publishes manually.

## Architecture Overview

4-stage pipeline:

1. **Radar** (Trigger.dev, weekly Sunday 8am CST) — Fetches RSS feeds from `content_sources`, scores articles against active `topics` using LLM relevance scoring via OpenRouter, creates `content` rows with status `idea`, sends Telegram summary of top matches.

2. **Planning Review** (User via Hugh MCP tools or ChiefOfStaff app) — User reviews radar output, approves ideas worth pursuing (status → `approved`), optionally adds notes/angle, rejects the rest.

3. **Mark Drafts** (Local via execute-task.ts) — Hugh creates a task assigned to Mark for each approved idea. Mark drafts using existing skill/task execution infrastructure. Draft lands in `content.body` with status `draft`. Runs locally using Max subscription.

4. **Publish** (Manual to start) — User reviews drafts, approves (status → `scheduled`), requests revisions (status → `revision`), or rejects. User manually publishes approved content. Direct API publishing is a later enhancement.

## Data Layer

### New DataAdapter Methods

Content CRUD:
- `listContent(filters)` — filter by status, topic, domain
- `createContent(content)` — new content row
- `updateContent(id, updates)` — status changes, body updates
- `getContent(id)` — single content item

Topics CRUD:
- `listTopics(filters)` — active/inactive filter
- `createTopic(topic)` — new topic
- `updateTopic(id, updates)` — activate/deactivate, rename

Content Sources CRUD:
- `listContentSources(filters)` — active/inactive filter
- `createContentSource(source)` — new source
- `updateContentSource(id, updates)` — activate/deactivate

### New MCP Tools (6)

| Tool | Purpose |
|------|---------|
| `list_content` | List content by status/topic |
| `create_content` | Manually create content idea |
| `update_content` | Change status, edit body/notes |
| `manage_topics` | List/create/update topics |
| `manage_content_sources` | List/create/update RSS sources |
| `review_content_radar` | Show latest radar results for review |

## Trigger.dev Radar Task

**Schedule:** Weekly, Sunday 8am CST
**File:** `src/trigger/content-radar.ts`

**Flow:**
1. Fetch active content sources from Supabase
2. For each source, fetch RSS feed (best-effort, skip failures)
3. Deduplicate by URL against existing content rows
4. Collect new articles (cap at 50 per run)
5. Batch-score relevance against active topics via OpenRouter LLM call
6. Create `content` rows for articles scoring above threshold (status: `idea`)
7. Send Telegram summary of new ideas

**Relevance Scoring:**
- LLM-powered: send article title + summary + list of active topics
- Returns topic match + relevance score (0-1)
- Threshold: 0.6 to create an idea
- Single batched LLM call for efficiency (all articles + all topics in one prompt)

**RSS Fetching:**
- Direct HTTP fetch + XML parsing (no external RSS library)
- Parse both RSS 2.0 and Atom feeds
- Extract: title, link, description/summary, pubDate
- Skip articles older than 7 days

## Mark Agent Drafting Workflow

When user approves a content idea (status → `approved`):

1. Hugh creates a task: "Draft blog post: [title]" assigned to Mark
2. Task context includes: source article URL, summary, matched topic, user notes/angle
3. Mark drafts via existing `execute-task.ts` → skill prompt handles tone, format, brand voice
4. Draft saved to `content.body`, status → `draft`, metadata includes word count and key points
5. User reviews: approve (→ `scheduled`), revise (→ `revision` with notes), or reject (→ `rejected`)

No separate Trigger.dev task for drafting — runs locally through Hugh's task execution using Max subscription.

## Initial Content Sources

~16 high-quality RSS feeds seeded on first run:

**AI & LLM Core:**
- OpenAI Blog
- Anthropic Blog/Research
- Google AI Blog
- Hugging Face Blog

**AI Engineering & Dev Tools:**
- Simon Willison's Weblog
- The Batch (Andrew Ng)
- Latent Space

**Automation & Low-Code:**
- Zapier Blog
- Make (Integromat) Blog
- n8n Blog

**Business + AI:**
- a16z AI Blog
- Lenny's Newsletter
- Stratechery (Ben Thompson)

**Startups & Tech:**
- TechCrunch Startups
- Y Combinator Blog

Each stored with `name`, `url` (RSS feed URL), `source_type: 'rss'`, `active: true`. Relevance scoring filters noise from broader feeds. Curate over time based on radar results.

## Error Handling & Testing

**Error handling — best-effort everywhere:**
- RSS fetch fails → skip source, log warning, continue
- LLM scoring fails → skip scoring, still save raw articles
- Telegram notification fails → log it, radar completes
- No matches found → return `{ ideas: 0 }`, no notification

**Testing:**
- Unit tests for RSS parsing (mock fetch responses)
- Unit tests for relevance scoring logic (mock LLM response)
- Integration test for full radar pipeline with mocked externals
- DataAdapter tests for content/topics/sources CRUD

**YAGNI — explicitly not building:**
- No retry logic beyond Trigger.dev's built-in 3 retries
- No content performance analytics
- No A/B headline testing
- No automated publishing (manual to start)
- No content calendar view
