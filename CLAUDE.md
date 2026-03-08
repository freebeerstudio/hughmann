# CLAUDE.md — HughMann Contributor Guide

This file tells Claude Code (and any AI agent) how to work on the HughMann codebase.

## Build & Test Commands

```bash
npm run build        # tsc && copy bundled skills to dist/skills
npm run typecheck    # tsc --noEmit (fast type check, no emit)
npm test             # vitest run (all tests, single pass)
npm run test:watch   # vitest (watch mode)
npm run lint         # eslint src/ tests/
npm run dev          # tsx src/cli.ts (run from source)
npm run chat         # tsx src/cli.ts chat (quick chat session)
```

The build step copies `src/skills/` to `dist/skills/` because bundled skills contain non-TS assets (SKILL.md, scripts, references) that tsc doesn't emit.

## Architecture Overview

HughMann is a **personal AI operating system** — a CLI agent that acts with full tool access in every conversation, remembers across sessions, and runs autonomously via a daemon.

### Core Principles

- **File-first, cloud-optional**: All state writes to local files under `HUGHMANN_HOME` (`~/.hughmann/`). Database sync (Supabase/Turso/SQLite) is additive — never the only copy.
- **Single model**: Every call uses `claude-opus-4-6`. No complexity tiers, no model routing. The `ModelRouter.selectProvider()` method hardcodes this.
- **Adapter pattern**: All external integrations go through typed interfaces (`DataAdapter`, `ModelAdapter`, `EmbeddingAdapter`, `FrontendAdapter`). Never import a concrete adapter directly.
- **Best-effort ancillary ops**: Memory saves, embedding writes, vault sync, gap analysis — all `.catch(() => {})`. These must never block the chat loop.
- **Tools always on**: Every conversation gets full MCP tool access. No pre-filtering, no complexity gating.
- **ESM throughout**: The project is `"type": "module"` with Node >= 20.

### Layered Architecture

```
Frontends (CLI / Telegram / MCP Server / Daemon)
  ↓
Runtime (Context / Session / Memory / Skills)
  ↓
Model Router (claude-opus-4-6 — always)
  ↓
Adapters (Model / Data / Embedding / MCP Client / Sub-Agents)
```

### Domain Isolation

```typescript
type IsolationZone = 'isolated' | 'personal'
```

- `isolated` domains (e.g., customer accounts) get ONLY their own memories and context — nothing from other domains leaks in.
- `personal` domains share context freely with each other.
- Customer ID mapping lives in `src/util/domain.ts:domainToCustomerId()` (re-exported from `supabase.ts` for backwards compat).

## Key Patterns

### HUGHMANN_HOME

All paths derive from a single root:

```typescript
// src/config.ts
const HUGHMANN_HOME = process.env.HUGHMANN_HOME || join(homedir(), '.hughmann')
```

Never hardcode `~/.hughmann/` or assume a home directory. Always resolve from `HUGHMANN_HOME`.

### DataAdapter Contract

The `DataAdapter` interface in `src/adapters/data/types.ts` has 22+ methods across 9 sections: Sessions, Memories, Decisions, Domain Notes, Vector Memory, Knowledge Base, Tasks, Projects, Planning Sessions, and Feedback.

Three implementations exist: `supabase.ts`, `sqlite.ts`, `turso.ts`. Code outside the adapter layer must never import these directly — always go through the `DataAdapter` interface.

### better-sqlite3 Gotcha

SQLite adapter uses `better-sqlite3` which requires spread params:

```typescript
// CORRECT
stmt.run(...params)

// WRONG — silently fails or throws
stmt.run(params)
```

### Skills: SKILL.md Directory Format

```
~/.hughmann/skills/
  my-skill/
    SKILL.md          # Required: YAML frontmatter + prompt body
    references/       # Optional: reference docs
    scripts/          # Optional: eval/helper scripts
    assets/           # Optional: templates, HTML, etc.
```

SKILL.md frontmatter fields:
- `name` (required) — display name
- `description` (required) — shown in skill listings
- `domain` (optional) — auto-switches domain before running (Hugh extension)

Directories starting with `_` are ignored. Legacy flat `.md` skill files still load with a deprecation warning.

### Internal Tool Server

The internal MCP server (`src/tools/internal-tools.ts`) exposes 26 tools in 10 categories: Task (4), Project (3), Planning (2), Briefings (2), Advisors (2), Context (1), Knowledge Base (2), Content (6), MCP Management (3), Domain Goals (2), Feedback (2), Utility (1).

### Boot Sequence

`src/runtime/boot.ts` orchestrates startup: load env → validate prereqs → load context docs → create adapters → load MCP config → init all managers → seed self-improvement project (fire-and-forget) → create internal tool server → return `Runtime`.

### Daemon Guardrails

`src/daemon/guardrails.ts` enforces: 5 tasks/day max, 50 turns/task max, 3 consecutive failures trigger 5-minute cooldown, 7am–6pm business hours only. Stats persist to `daemon/stats.json`.

### Gap Analyzer (Self-Improvement)

`src/runtime/gap-analyzer.ts` has three channels:
- **Distillation gaps**: Post-distill LLM analysis creates `backlog` tasks
- **Failure gaps**: Daemon failures create tasks with error context (no LLM)
- **Focus summary**: Surfaces accumulated gaps during `/focus` sessions
- `isDuplicate()` prevents recursive failure loops (substring + 60% word-overlap check)

All gap tasks are created with `backlog` status — the daemon won't auto-execute them.

### Structured Logger

`src/util/logger.ts` provides a `Logger` class that writes JSON-lines entries with `ts`, `level`, `component`, `msg`, and optional extra fields. Output goes to stderr and optionally to a file (best-effort). Use `createDaemonLogger(logDir)` for the daemon. Prefer `Logger` over `console.error` in runtime code.

### Entropy Prevention

`src/runtime/entropy.ts` identifies stale state: backlog tasks untouched for 30+ days, context docs with mtime > 30 days, orphaned sessions (>90 days, ≤1 message). Run via `hughmann entropy` (dry run) or `hughmann entropy --apply` to prune stale backlog tasks.

### ESLint

Flat config in `eslint.config.js`. Key rules:
- `no-floating-promises`: error (src only, type-aware)
- `no-unused-vars`: error (`_` prefix exception)
- `no-explicit-any`: warn
- `consistent-type-imports`: error

Run `npm run lint` before committing. CI enforces this.

### CI

`.github/workflows/ci.yml` runs on push to main and PRs: typecheck → test → lint. No secrets needed.

## How to Add Things

### New Internal Tool

1. Open `src/tools/internal-tools.ts`
2. Add your tool definition to the appropriate category section inside `createInternalToolServer()`
3. Each tool needs:
   - `server.tool("tool_name", "Description", { schema }, async (params) => { ... })`
   - Schema uses Zod (imported as `z`) for parameter validation
   - Return `{ content: [{ type: 'text', text: '...' }] }` on success
   - Return `errorResult("message")` on failure
4. Use `data` (DataAdapter), `context` (ContextStore), `writer` (ContextWriter), or `memory` (MemoryManager) from the closure — never import adapters directly
5. Run `npm run typecheck`, `npm test`, and `npm run lint`

### New DataAdapter Method

1. Add the method signature to the `DataAdapter` interface in `src/adapters/data/types.ts`
2. Implement in all three adapters:
   - `src/adapters/data/supabase.ts`
   - `src/adapters/data/sqlite.ts`
   - `src/adapters/data/turso.ts`
3. If the method needs a new table, add the SQL to the `MIGRATION_SQL` constant in the Supabase adapter and equivalent in SQLite/Turso `init()` methods
4. Run `npm run typecheck` — it will flag any adapter missing the new method

### New Skill

1. Create a directory under `src/skills/<skill-id>/` (for bundled) or `~/.hughmann/skills/<skill-id>/` (for user)
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description`, optional `domain`) and the prompt body
3. Optionally add `references/`, `scripts/`, `assets/` subdirectories
4. For bundled skills: the build step copies `src/skills/` to `dist/skills/`, and `SkillManager.installBundledSkill()` auto-installs to the user's skills dir on boot

### New Trigger.dev Task

1. Add your task file to `src/trigger/`
2. Use utilities from `src/trigger/utils.ts` for Supabase client creation and context loading
3. The `trigger.config.ts` auto-discovers all files in `src/trigger/`
4. Default: 5-minute max duration, 3 retries with exponential backoff

## Prohibited Patterns

- **No direct adapter imports**: Never `import { supabaseAdapter } from './adapters/data/supabase'` outside the boot sequence. Always use the `DataAdapter` interface.
- **No blocking on ancillary ops**: Memory saves, embeddings, vault sync, gap analysis must use `.catch(() => {})`. These are best-effort. If it fails, chat continues.
- **No hardcoded user names**: Use `context.config.ownerName` or `context.config.systemName`. Never write `"Wayne"` or `"Hugh"` as literals.
- **No hardcoded paths**: Derive everything from `HUGHMANN_HOME`. Never assume `~/.hughmann/`.
- **No complexity tiers**: Don't add model selection logic, task complexity routing, or "use a smaller model for simple tasks" patterns. One model, always.
- **No floating promises in the main chat loop**: Ancillary ops get `.catch(() => {})`. Core operations (model calls, session saves) must be awaited.

## File Map

| Path | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point (commander-based) |
| `src/config.ts` | `HUGHMANN_HOME`, config load/save |
| `src/runtime/boot.ts` | Boot sequence → returns `Runtime` |
| `src/runtime/runtime.ts` | `Runtime` class: chat, doTask, distill, prompt building |
| `src/runtime/context-writer.ts` | Writes to context docs (decisions, focus, domain notes, sections) |
| `src/runtime/skills.ts` | `Skill` interface, `SkillManager`, SKILL.md parser |
| `src/runtime/gap-analyzer.ts` | Self-improvement gap detection (3 channels) |
| `src/runtime/entropy.ts` | Entropy prevention: stale tasks, docs, orphaned sessions |
| `src/runtime/vault-sync.ts` | Obsidian vault → KB pipeline |
| `src/runtime/welcome.ts` | Login welcome briefing |
| `src/tools/internal-tools.ts` | Internal MCP tool server (26 tools) |
| `src/adapters/data/types.ts` | `DataAdapter` interface (32+ methods) |
| `src/adapters/data/supabase.ts` | Supabase implementation + migrations |
| `src/adapters/data/sqlite.ts` | SQLite (better-sqlite3) implementation |
| `src/adapters/data/turso.ts` | Turso (cloud SQLite) implementation |
| `src/types/context.ts` | `IsolationZone`, `ContextStore`, `DomainContext` |
| `src/types/tasks.ts` | `Task`, `TaskStatus`, `TaskType` |
| `src/types/projects.ts` | `Project`, `Milestone`, `PlanningSessionRecord` |
| `src/types/content.ts` | `ContentPiece`, `Topic`, `ContentSource` |
| `src/types/advisors.ts` | `Advisor` interface |
| `src/types/model.ts` | `ModelRequest`, `ModelResponse`, `ToolOptions`, `McpServerConfig` |
| `src/types/adapters.ts` | `ModelAdapter`, `FrontendAdapter` interfaces |
| `src/daemon/index.ts` | Daemon: task queue, scheduled skills, mail processing |
| `src/util/domain.ts` | Domain → Customer ID mapping (shared utility) |
| `src/util/logger.ts` | Structured JSON-lines logger |
| `src/daemon/guardrails.ts` | Guardrail config, `canExecuteTask`, cooldown logic |
| `src/skills/skill-creator/` | Bundled skill-creator (auto-installed to user dir) |
| `src/trigger/` | Trigger.dev tasks (morning, closeout, review, context-sync, content-radar, seed-content) |
| `trigger.config.ts` | Trigger.dev project config |
| `tests/` | Vitest test files (17 files, 123 tests) |
| `eslint.config.js` | ESLint flat config (type-aware for src/) |
| `.github/workflows/ci.yml` | CI pipeline: typecheck → test → lint |
| `docs/` | User-facing documentation (10 files) |
