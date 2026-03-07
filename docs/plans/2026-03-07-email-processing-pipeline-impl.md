# Email Processing Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Gmail classification pipeline that discovers categories, labels emails, and stores summaries — using Google Workspace MCP for Gmail access and Haiku via OpenRouter for cheap/fast classification.

**Architecture:** Skills (SKILL.md prompts) orchestrate the pipeline — Claude uses Google Workspace MCP tools for Gmail access, calls a classifier CLI for Haiku classification, and applies labels/stores summaries. The classifier is a standalone TypeScript module with a CLI wrapper so skills can invoke it via Bash.

**Tech Stack:** TypeScript/ESM, Google Workspace MCP, Haiku via OpenRouter, Supabase (summary storage), launchd (scheduling)

---

### Task 1: Category Config Module

**Files:**
- Create: `src/mail/gmail-categories.ts`
- Create: `tests/gmail-categories.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/gmail-categories.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Set HUGHMANN_HOME to a temp dir before importing
const TEST_HOME = join(import.meta.dirname, '.test-gmail-categories')
process.env.HUGHMANN_HOME = TEST_HOME

const { loadCategories, saveCategories, DEFAULT_CATEGORIES, type EmailCategory } = await import('../src/mail/gmail-categories.js')

describe('gmail-categories', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_HOME, 'email'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true })
  })

  it('returns default categories when no config exists', () => {
    const cats = loadCategories()
    expect(cats.length).toBeGreaterThanOrEqual(2)
    expect(cats.find(c => c.name === 'unwanted')).toBeTruthy()
    expect(cats.find(c => c.name === 'unclassified')).toBeTruthy()
  })

  it('saves and loads categories', () => {
    const cats: EmailCategory[] = [
      { name: 'billing', description: 'Invoices and payments' },
      { name: 'unwanted', description: 'Junk' },
      { name: 'unclassified', description: 'Needs review' },
    ]
    saveCategories(cats)
    const loaded = loadCategories()
    expect(loaded).toEqual(cats)
  })

  it('always includes unwanted and unclassified even if missing from file', () => {
    const configPath = join(TEST_HOME, 'email', 'categories.json')
    writeFileSync(configPath, JSON.stringify({
      categories: [{ name: 'billing', description: 'Invoices' }]
    }))
    const loaded = loadCategories()
    expect(loaded.find(c => c.name === 'billing')).toBeTruthy()
    expect(loaded.find(c => c.name === 'unwanted')).toBeTruthy()
    expect(loaded.find(c => c.name === 'unclassified')).toBeTruthy()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gmail-categories.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/mail/gmail-categories.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../config.js'

export interface EmailCategory {
  name: string
  description: string
}

const CONFIG_DIR = join(HUGHMANN_HOME, 'email')
const CONFIG_PATH = join(CONFIG_DIR, 'categories.json')

const REQUIRED_CATEGORIES: EmailCategory[] = [
  { name: 'unwanted', description: 'Junk, spam, marketing noise that passed Gmail filters' },
  { name: 'unclassified', description: 'Model not confident, needs manual review' },
]

export const DEFAULT_CATEGORIES: EmailCategory[] = [...REQUIRED_CATEGORIES]

export function loadCategories(): EmailCategory[] {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CATEGORIES

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    const cats: EmailCategory[] = Array.isArray(raw.categories) ? raw.categories : []

    // Ensure required categories are always present
    for (const req of REQUIRED_CATEGORIES) {
      if (!cats.find(c => c.name === req.name)) {
        cats.push(req)
      }
    }
    return cats
  } catch {
    return DEFAULT_CATEGORIES
  }
}

export function saveCategories(categories: EmailCategory[]): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify({ categories }, null, 2), 'utf-8')
}

export function categoryNames(categories: EmailCategory[]): string[] {
  return categories.map(c => c.name)
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gmail-categories.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mail/gmail-categories.ts tests/gmail-categories.test.ts
git commit -m "feat: add email category config module"
```

---

### Task 2: Gmail Classifier

**Files:**
- Create: `src/mail/gmail-classifier.ts`
- Create: `tests/gmail-classifier.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/gmail-classifier.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildClassificationPrompt, buildDiscoveryPrompt, parseClassificationResponse } from '../src/mail/gmail-classifier.js'

describe('gmail-classifier', () => {
  describe('buildClassificationPrompt', () => {
    it('builds a constrained prompt with category list', () => {
      const categories = [
        { name: 'billing', description: 'Invoices' },
        { name: 'newsletter', description: 'Newsletters' },
      ]
      const prompt = buildClassificationPrompt(categories)
      expect(prompt).toContain('billing')
      expect(prompt).toContain('newsletter')
      expect(prompt).toContain('Classify this email')
    })
  })

  describe('buildDiscoveryPrompt', () => {
    it('builds an open-ended discovery prompt', () => {
      const prompt = buildDiscoveryPrompt()
      expect(prompt).toContain('category')
      expect(prompt).not.toContain('Choose from')
    })
  })

  describe('parseClassificationResponse', () => {
    it('parses valid JSON response', () => {
      const raw = '{"category": "billing", "confidence": 0.95, "summary": "Invoice from Vercel"}'
      const result = parseClassificationResponse(raw)
      expect(result.category).toBe('billing')
      expect(result.confidence).toBe(0.95)
      expect(result.summary).toBe('Invoice from Vercel')
    })

    it('handles markdown-wrapped JSON', () => {
      const raw = '```json\n{"category": "billing", "confidence": 0.9, "summary": "test"}\n```'
      const result = parseClassificationResponse(raw)
      expect(result.category).toBe('billing')
    })

    it('returns unclassified on parse failure', () => {
      const result = parseClassificationResponse('not json at all')
      expect(result.category).toBe('unclassified')
      expect(result.confidence).toBe(0)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gmail-classifier.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/mail/gmail-classifier.ts
/**
 * gmail-classifier.ts — Haiku classification for Gmail emails.
 *
 * Uses Haiku via OpenRouter (direct fetch) to classify emails into
 * categories defined in ~/.hughmann/email/categories.json.
 *
 * Two modes:
 * - Discovery: open-ended classification (proposes new categories)
 * - Fixed: constrained to a predefined category list
 */

import type { EmailCategory } from './gmail-categories.js'

export interface GmailClassification {
  category: string
  confidence: number
  summary: string
}

export interface DiscoveryClassification {
  proposed_category: string
  reasoning: string
  summary: string
}

const MAX_BODY_CHARS = 12_000

export function buildDiscoveryPrompt(): string {
  return `You are an email classifier for a small business owner. Analyze this email and propose a category.

Return ONLY a JSON object (no markdown fences, no extra text):
{
  "proposed_category": "<short kebab-case category name, e.g. billing, newsletter, personal>",
  "reasoning": "<one sentence explaining why this category fits>",
  "summary": "<one sentence summary of the email>"
}

Rules:
- Category names should be short, lowercase, kebab-case
- Be specific but not too granular (e.g. "billing" not "vercel-invoice")
- Common categories: billing, newsletter, personal, saas-notification, shipping, social, marketing, transactional, unwanted`
}

export function buildClassificationPrompt(categories: EmailCategory[]): string {
  const categoryList = categories
    .map(c => `- ${c.name}: ${c.description}`)
    .join('\n')

  return `You are an email classifier. Classify this email into one of these categories:

${categoryList}

Return ONLY a JSON object (no markdown fences, no extra text):
{
  "category": "<one of the categories listed above>",
  "confidence": <0.0 to 1.0>,
  "summary": "<one sentence summary of the email>"
}

Rules:
- Choose the single best-fitting category
- If none fit well, use "unclassified"
- confidence should reflect how well the email fits the chosen category`
}

function formatEmailForClassification(email: {
  sender: string
  subject: string
  date: string
  snippet?: string
  body?: string
}): string {
  const body = email.body ?? email.snippet ?? ''
  const truncated = body.length > MAX_BODY_CHARS
    ? body.slice(0, MAX_BODY_CHARS) + '\n[... truncated ...]'
    : body

  return `From: ${email.sender}
Subject: ${email.subject}
Date: ${email.date}

${truncated}`
}

export async function classifyGmail(
  apiKey: string,
  systemPrompt: string,
  email: { sender: string; subject: string; date: string; snippet?: string; body?: string },
): Promise<GmailClassification> {
  const userContent = formatEmailForClassification(email)

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      max_tokens: 500,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) throw new Error('Empty LLM response')

  return parseClassificationResponse(raw)
}

export async function discoverGmail(
  apiKey: string,
  email: { sender: string; subject: string; date: string; snippet?: string; body?: string },
): Promise<DiscoveryClassification> {
  const userContent = formatEmailForClassification(email)

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      max_tokens: 500,
      temperature: 0,
      messages: [
        { role: 'system', content: buildDiscoveryPrompt() },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) throw new Error('Empty LLM response')

  return parseDiscoveryResponse(raw)
}

export function parseClassificationResponse(raw: string): GmailClassification {
  try {
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(jsonStr)
    return {
      category: parsed.category || 'unclassified',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      summary: parsed.summary || '',
    }
  } catch {
    return { category: 'unclassified', confidence: 0, summary: '' }
  }
}

function parseDiscoveryResponse(raw: string): DiscoveryClassification {
  try {
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(jsonStr)
    return {
      proposed_category: parsed.proposed_category || 'other',
      reasoning: parsed.reasoning || '',
      summary: parsed.summary || '',
    }
  } catch {
    return { proposed_category: 'other', reasoning: 'Parse error', summary: '' }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gmail-classifier.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mail/gmail-classifier.ts tests/gmail-classifier.test.ts
git commit -m "feat: add Gmail classifier with discovery and fixed modes"
```

---

### Task 3: Gmail Classifier CLI Wrapper

**Files:**
- Modify: `src/cli.ts` — add `gmail` subcommand
- Create: `src/mail/gmail-cli.ts` — CLI handler for gmail operations

This gives skills a way to classify emails via Bash without importing modules directly.

**Step 1: Create the CLI handler**

```typescript
// src/mail/gmail-cli.ts
/**
 * CLI handler for Gmail email operations.
 * Used by skills via Bash to classify individual emails.
 */

import { classifyGmail, discoverGmail, buildClassificationPrompt } from './gmail-classifier.js'
import { loadCategories } from './gmail-categories.js'

export async function handleGmailClassify(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY')
    process.exit(1)
  }

  // Read email JSON from stdin
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim()
  if (!input) {
    console.error('No input on stdin')
    process.exit(1)
  }

  const email = JSON.parse(input) as {
    sender: string
    subject: string
    date: string
    snippet?: string
    body?: string
  }

  const categories = loadCategories()
  const prompt = buildClassificationPrompt(categories)
  const result = await classifyGmail(apiKey, prompt, email)
  console.log(JSON.stringify(result))
}

export async function handleGmailDiscover(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY')
    process.exit(1)
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim()
  if (!input) {
    console.error('No input on stdin')
    process.exit(1)
  }

  const email = JSON.parse(input)
  const result = await discoverGmail(apiKey, email)
  console.log(JSON.stringify(result))
}
```

**Step 2: Add `gmail` case to `src/cli.ts`**

Find the switch statement in the main CLI handler (around the `case 'mail':` block). Add a new case:

```typescript
case 'gmail': {
  const sub = flags.args[0]
  if (sub === 'classify') {
    const { handleGmailClassify } = await import('./mail/gmail-cli.js')
    await handleGmailClassify()
  } else if (sub === 'discover') {
    const { handleGmailDiscover } = await import('./mail/gmail-cli.js')
    await handleGmailDiscover()
  } else {
    console.log('Usage: hughmann gmail [classify|discover]')
    console.log('  Reads email JSON from stdin, outputs classification JSON')
  }
  break
}
```

Also add to the help text near the `mail` line:
```typescript
console.log(`    ${pc.cyan('gmail')}             Gmail classification ${pc.dim('(classify|discover)')}`)
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/mail/gmail-cli.ts src/cli.ts
git commit -m "feat: add hughmann gmail CLI for skill-driven classification"
```

---

### Task 4: Update Mail Module Exports

**Files:**
- Modify: `src/mail/index.ts`

**Step 1: Add gmail exports**

Add to `src/mail/index.ts`:

```typescript
export { classifyGmail, discoverGmail, buildClassificationPrompt, buildDiscoveryPrompt, parseClassificationResponse } from './gmail-classifier.js'
export { loadCategories, saveCategories, categoryNames, DEFAULT_CATEGORIES } from './gmail-categories.js'
export type { GmailClassification, DiscoveryClassification } from './gmail-classifier.js'
export type { EmailCategory } from './gmail-categories.js'
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mail/index.ts
git commit -m "feat: export gmail classifier and categories from mail module"
```

---

### Task 5: Discovery Skill

**Files:**
- Create: `src/skills/discover-email-categories/SKILL.md`

**Step 1: Write the skill**

```markdown
---
name: discover-email-categories
description: Sample Gmail inbox to discover email categories for classification. Use when setting up the email processing pipeline for the first time, or when you want to re-discover what types of emails are in the inbox.
---

# Discover Email Categories

Sample the Gmail inbox to discover what categories of email actually exist, rather than guessing. This is a one-time setup step before bulk classification.

## Process

### 1. Sample Emails

Use the Google Workspace MCP to fetch a representative spread of recent emails:

```
gmail_search query: "in:inbox" maxResults: 50
```

Then fetch another batch of older/read emails for coverage:

```
gmail_search query: "in:inbox is:read" maxResults: 50
```

### 2. Classify Each Email

For each email, use the CLI classifier in discovery mode. Run via Bash:

```bash
echo '{"sender":"<from>","subject":"<subject>","date":"<date>","snippet":"<snippet>"}' | hughmann gmail discover
```

This returns JSON with `proposed_category`, `reasoning`, and `summary`.

Process emails one at a time. Pause briefly between calls to respect rate limits.

### 3. Aggregate Results

After classifying all samples, aggregate:
- Count emails per proposed category
- Merge near-duplicates (e.g., "billing-notice" and "invoice" → "billing")
- Note the top 3-5 example subjects per category

### 4. Present Summary Table

Show the user a table:

```
Category              Count   Example Subject
billing                 12    "Your March invoice from Vercel"
ai-newsletter            8    "The Batch: New reasoning models..."
personal                 7    "Re: Dinner Saturday?"
saas-notification        6    "Your Figma trial expires in 3 days"
...
```

### 5. Refine with User

Ask the user to:
- Merge categories that are too similar
- Rename any that don't feel right
- Split any that are too broad
- Drop any they don't care about

Remind them that `unwanted` and `unclassified` are always present (built-in).

### 6. Save Config

Once the user approves the final list, save it:

```bash
hughmann gmail save-categories
```

Or write directly to `~/.hughmann/email/categories.json`:

```json
{
  "categories": [
    { "name": "billing", "description": "Invoices, payment confirmations, subscription charges" },
    { "name": "newsletter", "description": "AI/tech newsletters and digests" },
    ...
    { "name": "unwanted", "description": "Junk, spam, marketing noise that passed Gmail filters" },
    { "name": "unclassified", "description": "Model not confident, needs manual review" }
  ]
}
```

Confirm the file was written successfully.
```

**Step 2: Verify skill loads**

Run: `npm run build && hughmann skills`
Expected: `discover-email-categories` appears in the list

**Step 3: Commit**

```bash
git add src/skills/discover-email-categories/SKILL.md
git commit -m "feat: add discover-email-categories skill"
```

---

### Task 6: Bulk Classify Skill

**Files:**
- Create: `src/skills/bulk-classify-email/SKILL.md`

**Step 1: Write the skill**

```markdown
---
name: bulk-classify-email
description: Process the Gmail inbox backlog by classifying and labeling all unprocessed emails. Use after running discover-email-categories to apply the finalized category list to existing emails.
---

# Bulk Classify Email

Process the Gmail inbox backlog using the finalized category list. Classifies each email, applies a Gmail label, and stores a summary.

## Prerequisites

- Category config must exist at `~/.hughmann/email/categories.json` (run discover-email-categories first)
- Google Workspace MCP must be loaded
- OPENROUTER_API_KEY must be set

## Process

### 1. Load Categories

Read `~/.hughmann/email/categories.json` to get the category list. If it doesn't exist, stop and tell the user to run discover-email-categories first.

### 2. Fetch Unprocessed Emails

Search for emails that don't have any Hugh labels yet. Build a query that excludes all known category labels:

```
gmail_search query: "in:inbox -label:hugh-billing -label:hugh-newsletter ..." maxResults: 50
```

Use the prefix `hugh-` for all labels to avoid conflicts with existing Gmail labels.

### 3. Process Each Email

For each email in the batch:

**a) Get full email content:**
```
gmail_get id: "<message_id>"
```

**b) Classify via CLI:**
```bash
echo '{"sender":"<from>","subject":"<subject>","date":"<date>","body":"<body>"}' | hughmann gmail classify
```

**c) Apply Gmail label:**
```
gmail_label id: "<message_id>" labels: ["hugh-<category>"]
```

Create the label first if it doesn't exist. Use `gmail_create_label` or equivalent.

**d) Log progress:**
Report every 10 emails: "Processed 10/50 — 4 billing, 3 newsletter, 2 personal, 1 unwanted"

### 4. Rate Limiting

Process 1-2 emails per second. After each email, wait briefly to stay within Gmail and OpenRouter rate limits.

### 5. Batch Continuation

After processing a batch of 50, check if there are more unprocessed emails. If so, fetch the next batch and continue. Keep processing until all emails are labeled.

### 6. Summary Report

When done, show a summary:

```
Bulk Classification Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total processed: 2,147
Categories:
  billing:           234 (10.9%)
  newsletter:        456 (21.2%)
  personal:          189 (8.8%)
  saas-notification: 312 (14.5%)
  unwanted:          567 (26.4%)
  unclassified:       89 (4.1%)
  ...
Errors: 3
```

### 7. Error Handling

- If classification fails for an email, log the error and skip it (don't apply a label). It will be picked up on the next run.
- If Gmail label application fails, log and continue.
- Track the last successfully processed message ID so the skill can resume if interrupted.
```

**Step 2: Verify skill loads**

Run: `npm run build && hughmann skills`
Expected: `bulk-classify-email` appears in the list

**Step 3: Commit**

```bash
git add src/skills/bulk-classify-email/SKILL.md
git commit -m "feat: add bulk-classify-email skill"
```

---

### Task 7: Incremental Process Email Skill

**Files:**
- Create: `src/skills/process-email/SKILL.md`

**Step 1: Write the skill**

```markdown
---
name: process-email
description: Classify and label new Gmail emails that haven't been processed yet. Runs as a scheduled skill 3x daily (7am, noon, 6pm) to keep the inbox organized. Can also be run manually.
---

# Process Email

Find and classify new unprocessed Gmail emails. This is the incremental processor that runs after the initial bulk classification is complete.

## Prerequisites

- Category config at `~/.hughmann/email/categories.json`
- Google Workspace MCP loaded
- OPENROUTER_API_KEY set

## Process

### 1. Find Unprocessed Emails

Search for inbox emails without any hugh- labels:

```
gmail_search query: "in:inbox -label:hugh-billing -label:hugh-newsletter -label:hugh-personal -label:hugh-unwanted -label:hugh-unclassified ..." maxResults: 25
```

Build the exclusion query from all categories in `~/.hughmann/email/categories.json`.

If no results, report "No new emails to process" and exit.

### 2. Classify and Label

For each unprocessed email:

**a) Get email content:**
```
gmail_get id: "<message_id>"
```

**b) Classify:**
```bash
echo '{"sender":"<from>","subject":"<subject>","date":"<date>","snippet":"<snippet>"}' | hughmann gmail classify
```

**c) Apply label:**
```
gmail_label id: "<message_id>" labels: ["hugh-<category>"]
```

### 3. Report

Show a brief summary:

```
Processed 7 new emails:
  2 billing, 1 newsletter, 3 personal, 1 unwanted
```

### 4. Quiet Mode

When run with `-q` flag (scheduled/daemon mode), minimize output. Only report errors and the final count.

## Idempotency

Gmail labels are the cursor. If an email has a `hugh-*` label, it's been processed. No state file needed. Safe to run multiple times — already-labeled emails are naturally excluded by the search query.

## Scheduling

This skill is designed to run 3x daily via launchd:
- 7:00 AM CST
- 12:00 PM CST
- 6:00 PM CST

Install with: `hughmann schedule install process-email`
```

**Step 2: Verify skill loads**

Run: `npm run build && hughmann skills`
Expected: `process-email` appears in the list

**Step 3: Commit**

```bash
git add src/skills/process-email/SKILL.md
git commit -m "feat: add process-email skill for incremental Gmail classification"
```

---

### Task 8: Add process-email to Scheduler Defaults

**Files:**
- Modify: `src/scheduler/launchd.ts`

**Step 1: Add process-email schedules to getDefaultSchedules()**

In `src/scheduler/launchd.ts`, find the `getDefaultSchedules()` function. Add process-email entries to both the config-based and fallback schedule arrays.

In the config-based branch (after the review entry around line 52), add:

```typescript
{ skillId: 'process-email', hour: 7, minute: 0, description: 'Process email at 7:00 AM' },
{ skillId: 'process-email', hour: 12, minute: 0, description: 'Process email at 12:00 PM' },
{ skillId: 'process-email', hour: 18, minute: 0, description: 'Process email at 6:00 PM' },
```

In the fallback array (after line 64), add the same three entries.

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Verify schedules show up**

Run: `npx tsx src/cli.ts schedule list`
Expected: process-email appears in available schedules (or install and verify)

**Step 4: Commit**

```bash
git add src/scheduler/launchd.ts
git commit -m "feat: add process-email to default launchd schedules (7am, noon, 6pm)"
```

---

### Task 9: Auto-install Bundled Skills

**Files:**
- Modify: `src/runtime/skills.ts`

**Step 1: Register new skills for auto-install**

In `src/runtime/skills.ts`, find the `installBundledSkill('skill-creator')` call (around line 317). Add the three new skills:

```typescript
this.installBundledSkill('skill-creator')
this.installBundledSkill('discover-email-categories')
this.installBundledSkill('bulk-classify-email')
this.installBundledSkill('process-email')
```

**Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/runtime/skills.ts
git commit -m "feat: auto-install email processing skills on boot"
```

---

### Task 10: Full Integration Test

**Step 1: Build and verify**

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

All must pass.

**Step 2: Verify skills are visible**

```bash
hughmann skills
```

Should list: `discover-email-categories`, `bulk-classify-email`, `process-email`

**Step 3: Verify CLI subcommand**

```bash
echo '{"sender":"test@example.com","subject":"Your invoice","date":"2026-03-07","snippet":"Amount due: $49.99"}' | hughmann gmail classify
```

Should output classification JSON (requires OPENROUTER_API_KEY).

**Step 4: Verify schedule config**

```bash
hughmann schedule list
```

Should include process-email entries.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete email processing pipeline (classify, label, schedule)"
```

---

## File Summary

| Path | Action | Purpose |
|------|--------|---------|
| `src/mail/gmail-categories.ts` | Create | Category config loader/saver |
| `src/mail/gmail-classifier.ts` | Create | Haiku classification via OpenRouter |
| `src/mail/gmail-cli.ts` | Create | CLI wrapper for classify/discover |
| `src/mail/index.ts` | Modify | Add gmail exports |
| `src/cli.ts` | Modify | Add `gmail` subcommand |
| `src/runtime/skills.ts` | Modify | Auto-install new skills |
| `src/scheduler/launchd.ts` | Modify | Add process-email schedules |
| `src/skills/discover-email-categories/SKILL.md` | Create | Discovery pass skill |
| `src/skills/bulk-classify-email/SKILL.md` | Create | Bulk catch-up skill |
| `src/skills/process-email/SKILL.md` | Create | Incremental processor skill |
| `tests/gmail-categories.test.ts` | Create | Category config tests |
| `tests/gmail-classifier.test.ts` | Create | Classifier unit tests |

## Notes for Implementer

- **Google Workspace MCP tools**: The exact tool names depend on the MCP server. Common ones: `gmail_search_emails`, `gmail_get_email`, `gmail_modify_labels`, `gmail_create_label`. Check the MCP server's tool list during skill execution and adjust.
- **Label prefix**: All Hugh labels use `hugh-` prefix to avoid conflicts with existing Gmail labels.
- **OpenRouter API key**: Must be in the environment as `OPENROUTER_API_KEY`. The classifier uses `anthropic/claude-haiku-4-5` model.
- **Don't touch Elle's pipeline**: The existing `mail-reader.ts`, `mail-processor.ts`, and `mail-classifier.ts` are for Elle (Apple Mail → Obsidian). Leave them untouched.
