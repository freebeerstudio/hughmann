# Email Processing Pipeline — Design

## Overview

An email processing pipeline for Hugh (wayne@freebeer.ai Gmail) that classifies incoming email, applies Gmail labels, and stores summaries for searchable context. Built on the Google Workspace MCP, Haiku classification via OpenRouter, and Supabase storage.

This is separate from Elle's pipeline (Apple Mail → Obsidian → pgvector for Omnissa). Hugh handles FBS and personal Gmail only.

## Goals

- Classify every email into a meaningful category
- Apply flat Gmail labels for easy filtering
- Store lightweight summaries to Supabase for Hugh's knowledge base
- Clear a ~2000 email backlog, then keep up with new mail ongoing
- Build a foundation for per-category processing in Phase 2

## Architecture

```
Gmail (wayne@freebeer.ai)
  ↓ Google Workspace MCP (gmail_search, gmail_get, gmail_label)
  ↓
Email Processor
  ↓ Haiku via OpenRouter (classification)
  ↓
  ├── Apply Gmail label (flat: billing, newsletter, unwanted, etc.)
  └── Store summary to Supabase (kb_nodes or email_summaries table)
```

## Phase 1: Classify & Label

### Component 1: Discovery Pass (one-time skill)

**Purpose:** Sample the inbox to discover what categories actually exist, rather than guessing.

**How it works:**

1. Fetch ~100 recent emails via `gmail_search` (mix of read/unread for representative spread)
2. Classify each with an open-ended Haiku prompt: "What type of email is this? Propose a short category name and explain why." No predefined categories.
3. Aggregate proposed categories, count per category, merge near-duplicates (e.g., "billing-notice" and "invoice" become one)
4. Present a summary table for review:
   ```
   Category              Count   Example Subject
   billing                 12    "Your March invoice from Vercel"
   ai-newsletter            8    "The Batch: New reasoning models..."
   personal                 7    "Re: Dinner Saturday?"
   saas-notification        6    "Your Figma trial expires in 3 days"
   ...
   ```
5. User refines: merge, rename, split, or drop categories. Final list becomes the classifier config.

**Built-in categories (always present):**
- `unwanted` — junk/spam that got past Gmail's filters. Reserved for "special" processing in Phase 2 (auto-archive, auto-delete, auto-unsubscribe, etc.)
- `unclassified` — model wasn't confident. Queued for manual review.

**Invocation:** Custom skill, run once via `hughmann run discover-email-categories` or `/discover-email-categories` in chat.

### Component 2: Bulk Catch-Up (one-time)

**Purpose:** Process the ~2000 email backlog using the finalized category list.

**How it works:**

1. Fetch emails via `gmail_search` in batches of 50. Process oldest first (chronological cleanup).
2. Classify each with a constrained Haiku prompt: "Classify this email into one of these categories: [list]. If none fit, use `unclassified`." Faster and more accurate than open-ended discovery since the model chooses from a fixed set.
3. Apply the Gmail label via Google Workspace MCP. Create the label on first use if it doesn't exist.
4. Store a lightweight summary to Supabase: message ID, category, sender, subject, date, one-line summary. No full message bodies.
5. Rate limiting: 1-2 emails/second to stay within Gmail and OpenRouter limits. Full 2000 takes ~20-30 minutes.
6. Resume on failure: Track last processed message ID so restarts don't re-process.

**Invocation:** Custom skill, run once via `hughmann run bulk-classify-email`.

### Component 3: Incremental Processor (ongoing, scheduled)

**Purpose:** Keep up with new mail as it arrives.

**Schedule:** 3x daily — 7am, noon, 6pm CST. Gives the user time windows to manually process or respond before automation kicks in.

**How it works:**

1. Query for unlabeled emails: `gmail_search` with a query excluding all known Hugh labels (`in:inbox -label:billing -label:newsletter -label:unwanted -label:unclassified ...`). This naturally finds only unprocessed messages.
2. Classify and label using the same fixed category list and Haiku classifier as the bulk pass.
3. Store summary to Supabase.
4. No state file needed. Gmail labels are the cursor — if an email has a Hugh label, it's been processed. Idempotent by design.
5. Typical volume per cycle: 0-10 emails. Fast, cheap, well under rate limits.

**Execution:** HughMann scheduled skill via launchd:
```bash
hughmann schedule install process-email
```
Schedule config in `~/.hughmann/daemon/schedule.json`:
```json
[
  { "skillId": "process-email", "hour": 7, "minute": 0 },
  { "skillId": "process-email", "hour": 12, "minute": 0 },
  { "skillId": "process-email", "hour": 18, "minute": 0 }
]
```

## Phase 2: Per-Category Handlers (future)

Defined after Phase 1 is running and category distribution is understood. Potential handlers:

- **billing** — Extract amounts, due dates, vendor names. Feed into FBS budget tracker.
- **ai-newsletter** — Parse for content ideas to repurpose in FBS newsletter/social posts.
- **unwanted** — Auto-archive, auto-delete, or auto-unsubscribe.
- **personal** — Flag financial/billing items separately from social.
- Others TBD based on what categories emerge from discovery.

## Classification Config

After discovery, the finalized category list is stored as a JSON config:

```json
{
  "categories": [
    { "name": "billing", "description": "Invoices, payment confirmations, subscription charges" },
    { "name": "ai-newsletter", "description": "AI/automation newsletters and digests" },
    { "name": "personal", "description": "Personal correspondence, family, friends" },
    { "name": "unwanted", "description": "Junk, spam, marketing noise that passed Gmail filters" },
    { "name": "unclassified", "description": "Model not confident, needs manual review" }
  ]
}
```

Location: `~/.hughmann/email/categories.json`

The classifier prompt is dynamically built from this config, so adding or renaming categories is a config change, not a code change.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Gmail access | Google Workspace MCP (`gmail_search`, `gmail_get`, label management) |
| Classification | Haiku via OpenRouter (direct fetch, same pattern as Elle's classifier) |
| Summary storage | Supabase `kb_nodes` table (or new `email_summaries` table) |
| Scheduling | HughMann skills + launchd (3x daily) |
| Config | `~/.hughmann/email/categories.json` |

## Files to Create

| Path | Purpose |
|------|---------|
| `src/skills/discover-email-categories/SKILL.md` | Discovery pass skill |
| `src/skills/bulk-classify-email/SKILL.md` | Bulk catch-up skill |
| `src/skills/process-email/SKILL.md` | Incremental processor skill |
| `src/mail/gmail-classifier.ts` | Gmail-specific classifier (reuses pattern from `mail-classifier.ts`) |
| `src/mail/gmail-processor.ts` | Gmail processing pipeline (fetch, classify, label, store) |

## Constraints

- Google Workspace MCP must be loaded and authenticated (wayne@freebeer.ai)
- OpenRouter API key required for Haiku classification
- Supabase connection required for summary storage
- Gmail API rate limits: ~250 quota units per user per second (search = 100 units, get = 5 units, modify = 5 units)
- Does not touch Elle's pipeline — completely independent
