# Chief of Staff Architecture — Design

## Overview

Hugh becomes the unified Chief of Staff runtime for Free Beer Studio, Omnissa, and Personal domains. He orchestrates a team of agent personas, manages projects from vision to delivery, and connects to multiple frontends (iOS, Watch, Web) through a shared Supabase backend. This design replaces Foundry's daemon/orchestration layer and simplifies Platform to a frontend + database role.

## North Star

Hugh is Wayne's Chief of Staff. He sees all work across all domains, assigns it to the right agent or human, executes autonomously where possible, and surfaces what needs Wayne's attention. Every project traces back to a domain-level goal. Every task justifies its existence by moving a project closer to its North Star. Hugh doesn't just execute — he chooses the right work.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontends                         │
│  iOS/iPadOS  ·  Watch  ·  Widgets  ·  Siri  ·  Web │
│         (read/write Supabase directly)               │
└──────────────────────┬──────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │        Supabase           │
         │  (single source of truth) │
         │  Data · Vectors · Auth    │
         │  RLS tenant isolation     │
         └─────────────┬─────────────┘
                       │
         ┌─────────────┴─────────────┐
         │     Hugh (CLI Runtime)    │
         │  Orchestrator · Planner   │
         │  Agent Persona Loader     │
         │  Sub-Agent Coordinator    │
         └─────────┬───────┬─────────┘
                   │       │
        ┌──────────┘       └──────────┐
        │                             │
  Trigger.dev                   Local (launchd)
  (serverless execution)        (macOS-native only)
  - Scheduled skills            - Apple Calendar
  - Event-driven tasks          - Apple Mail
  - Webhook handlers            - Obsidian vault sync
  - Sprint execution
```

### Three Layers

**Frontends** read and write Supabase directly for all data operations. RLS enforces tenant isolation — no API middleware needed. Frontends invoke Hugh (via Trigger.dev) only when AI work is required: planning sessions, task decomposition, content generation, code reviews.

**Supabase** is the single source of truth. Projects, tasks, agent activity, customer intelligence, planning records, content pipeline, KB vectors — all here. Platform's existing schema is the canonical model. HughMann's simpler local tables (tasks, projects) are deprecated in favor of Platform's richer versions.

**Hugh** is the orchestration runtime. He loads agent personas as skills, spins up sub-agents for parallel work, manages sprint execution, and makes autonomous prioritization decisions based on domain goals and project North Stars. Trigger.dev handles scheduled and event-driven execution. LaunchD remains only for macOS-native integrations (Calendar, Mail, Obsidian sync on Elle's Mac).

## The Pyramid — Goal Hierarchy

Every piece of work traces back to a domain goal through a clear hierarchy:

```
Domain Goal (simple, permanent, reviewed quarterly)
  "FBS: Increase revenue daily"
  "Omnissa: Win every deal in my territory"
  "Personal: Build the life I want"
    │
    ├── Project (has a North Star + guardrails)
    │   North Star: vivid qualitative picture of success
    │   Guardrails: 2-3 constraints for prioritization decisions
    │     │
    │     ├── Sprint (generated from refinement sessions)
    │     │     │
    │     │     ├── Task (Big Rock / MUST / MIT / Standard)
    │     │     │   Assigned to agent or human
    │     │     ...
    │     ...
    ...
```

### Domain Goals

One sentence each. Reviewed quarterly. These are permanent guiding lights, not SMART targets.

### Project North Stars

A vivid, qualitative statement of what success looks and feels like. Not a metric — a picture.

Example:
> "Free Beer Studio has a steady stream of small business clients who find us through our reputation and referrals. We charge premium rates because our work is exceptional. Wayne spends mornings on creative work and afternoons closing deals. The business runs profitably without Wayne touching every deliverable."

### Project Guardrails

2-3 simple constraints that help Hugh make prioritization calls autonomously.

Example:
> - Revenue: Monthly recurring revenue covers all business costs
> - Quality: Every site we ship is portfolio-worthy
> - Leverage: Prefer work that compounds (content, templates, systems) over one-off effort

The North Star tells Hugh where we're going. The guardrails tell him how to choose between two good options.

### Omnissa Customer Accounts as Projects

Each customer account is a project with a North Star. This gives Hugh the same planning and tracking structure for deals as for FBS products.

```
Domain Goal: "Win every deal in my territory"
  │
  ├── Tarrant College
  │   North Star: "Close 500-seat Horizon deal by Fall 2026"
  │   Guardrails: POC must prove SAML, budget approved by March
  │
  ├── Lake Worth ISD
  │   North Star: "Expand from WS1 UEM to full Horizon stack"
  │   Guardrails: Contract renews June, need business case by April
```

Hugh already has customer intelligence from the KB (Elle's Obsidian → pgvector pipeline). Adding the project/North Star layer means Hugh can proactively notice "Tarrant's license quote expires in 7 days and we haven't followed up" — not because Wayne created a reminder, but because it violates the guardrail.

## Agent Team Model

Hugh is the single runtime. Agent personas are skills with persistent identity. Sub-agents run in parallel within Hugh's execution context.

### How It Works

Hugh is always the orchestrator. When a task is assigned to an agent, Hugh spins up a sub-agent call with that agent's system prompt, memory namespace, and tool access. Multiple sub-agents can run in parallel. Hugh coordinates, synthesizes, and decides what to do next.

Think of it like a real Chief of Staff — Hugh doesn't become Celine, he calls Celine into the room, gives her a task, and she works on it while he moves to the next thing.

### Agent Personas

Each agent is a skill directory with:

- **Persona prompt** — role, expertise, decision-making style, communication style
- **Domain access** — which domains they can see
- **Memory namespace** — past work, decisions, and learnings persist separately
- **Tool access** — what they're allowed to do

### Initial Team

| Agent | Role | Domains | Responsibilities |
|---|---|---|---|
| **Hugh** | Chief of Staff | All | Orchestrate, plan, prioritize, review, coordinate |
| **Celine** | CRO | FBS, Omnissa | Pipeline, lead tracking, deal strategy, revenue analysis |
| **Mark** | Marketing | FBS | Content, social media, SEO, brand voice |
| **Support agent** | Customer Success | FBS | Support tickets, client comms, onboarding docs |
| **Dev sub-agents** | Engineering | Per-task | Spun up on demand for coding tasks — no persistent identity |

Key principle: agents don't have their own daemon loops. Hugh is the single brain. The personas give him specialized behavior, not independent autonomy.

## Project Lifecycle

### 1. Instantiate

Wayne and Hugh create (or import) a project. Define the North Star and guardrails. Hugh scaffolds infrastructure automatically:

- **GitHub**: Create repo under `freebeerstudio` org. Main = prod, `staging` = preview.
- **Vercel**: Create project, link to repo. Auto-deploy main → production, staging → preview.
- **Cloudflare**: DNS records — production domain + staging subdomain.
- **Supabase**: Project record with slug, repo URL, Vercel project, customer tenant link.

### 2. Refine

On a cadence tied to project priority (weekly for active, monthly for backlog), Wayne and Hugh have a refinement conversation. Hugh pulls: current North Star, last sprint results, deployment state, open PRs, agent activity, blockers. They talk it through. Hugh generates the next sprint.

### 3. Sprint

From each refinement session, Hugh generates concrete tasks classified as Big Rock, MUST, MIT, or Standard. Wayne claims some, Hugh assigns the rest to agent personas. Work begins immediately.

### 4. Build

Wayne and Hugh's team work the sprint. Progress tracked in Supabase, visible on whatever frontend Wayne is using. Hugh executes his tasks via Trigger.dev. Agents work in parallel as sub-agents. Dev work happens in git worktrees.

### 5. Ship

When a sprint completes, Hugh runs a review: what shipped, what's left, how far from the North Star. Results feed into the next refinement session.

## Planning Rhythm

- **Daily**: Morning briefing (what's happening today, across all domains) + afternoon closeout (what got done, what to prep for tomorrow)
- **Weekly**: Sprint-level review across active projects. Generate next sprint for each.
- **Quarterly**: Domain goal + North Star review. Adjust guardrails. Reprioritize projects.

## Execution Layer — Trigger.dev

Trigger.dev replaces three things:

### Scheduled Skills
Morning dashboard at 7am, prep-meetings at 4pm, weekly review Friday. These become Trigger.dev scheduled tasks. No plist files, no daemon polling.

### Autonomous Task Execution
Instead of a 60-second poll loop, Trigger.dev tasks fire on events: task created → evaluate and execute. Sprint started → begin working through assigned tasks. Refinement completed → generate sprint and assign.

### Reactive Work
Webhook-driven: GitHub webhook → Hugh reviews PR. Email arrives → classify and route. Obsidian vault changes → sync to KB.

### What Stays on LaunchD
macOS-native integrations only: Apple Calendar reading, Apple Mail processing, Obsidian vault sync. These require local macOS APIs and run on Elle's Mac.

## Data Model

### Supabase Schema (Platform's existing tables, extended)

**Projects** — extended with:
- `north_star` TEXT — vivid vision statement
- `guardrails` JSONB — array of constraint strings
- `domain_goal_id` UUID — links to parent domain goal
- `infrastructure` JSONB — repo URL, Vercel project, domain, DNS status
- `refinement_cadence` TEXT — 'weekly', 'biweekly', 'monthly'
- `last_refinement_at` TIMESTAMPTZ

**Domain Goals** — new table:
- `id`, `domain`, `customer_id`
- `statement` TEXT — one-sentence goal
- `reviewed_at` TIMESTAMPTZ

**Work Items** (Platform's existing table) — already has:
- status, priority, task_type (MUST/MIT/BIG_ROCK/STANDARD)
- assignee, assigned_agent_id, project_id
- blocked_reason, sprint, completion notes

**Agents** (Platform's existing table) — extended with:
- `memory_namespace` TEXT — isolated memory key prefix
- `persona_skill_id` TEXT — links to skill directory
- `domains` TEXT[] — accessible domains

**Agent Activities** (Platform's existing table) — already has full execution tracing.

**Planning Sessions, KB Nodes, Memory Embeddings** — all exist in Platform's schema already.

### What Gets Deprecated

- HughMann's local `tasks` table (replaced by Platform's `work_items`)
- HughMann's local `projects` table (replaced by Platform's `projects`)
- HughMann's local `planning_sessions` table (replaced by Platform's)
- Foundry's daemon, router, org chart (replaced by Hugh's skill-based agent model)
- Platform's API routes (frontends connect to Supabase directly)

## Dev Workflow

Wayne works locally in git worktrees. Hugh works in his own worktrees (via Trigger.dev tasks). Both push to the same repo. PRs for non-trivial changes, direct pushes to staging for small stuff. Hugh can review Wayne's PRs, Wayne can review Hugh's. Staging auto-deploys for visual review. Merge to main → production.

## Phased Rollout

### Phase 1: Foundation (now)
- Consolidate on Platform's Supabase schema
- Add North Star + guardrails to projects table
- Add domain goals table
- Define agent personas as skills in HughMann
- Hugh starts managing real FBS projects via existing CLI
- **Hugh starts working immediately** — content, outreach research, product tasks

### Phase 2: Agent Team (weeks 2-3)
- Build sub-agent execution model with persistent personas
- Sprint planning skill (refinement → sprint generation → assignment)
- Project instantiation skill (scaffolds GitHub/Vercel/DNS)
- Hugh assigns and coordinates work across agent team

### Phase 3: Trigger.dev Migration (weeks 3-4)
- Replace daemon + launchd with Trigger.dev for non-macOS tasks
- Webhook integrations (GitHub PRs, email classification)
- Event-driven task execution (task created → evaluate → execute)
- Hugh becomes serverless — no always-on process

### Phase 4: ChiefOfStaff App (weeks 4-8)
- SwiftUI app connecting directly to Supabase
- Task management, briefings, approvals, sprint views
- Watch complications for daily win status, next meeting
- Siri intents for voice interaction
- Widget for today's MUSTs and agent activity

### Phase 5: Web Dashboard (weeks 6-10)
- Platform evolves into web frontend
- Content management, customer portal, project dashboards
- Multi-site management for FBS client properties
- Shares same Supabase backend as all other frontends

## Constraints

- Supabase is required — no offline-only mode for the new architecture
- macOS-native integrations (Calendar, Mail) stay on launchd on Elle's Mac
- Agent personas don't have independent daemon loops — Hugh orchestrates everything
- All agent work is traceable via activity feed in Supabase
- Cost tracking per agent, per task, per sprint — visible in all frontends

## What This Eliminates

- **Foundry** — entirely replaced. Daemon, router, org chart, platform client all absorbed into Hugh's skill-based model
- **Platform API routes** — frontends connect to Supabase directly. Edge Functions remain for any server-side logic needed
- **HughMann daemon** — replaced by Trigger.dev for serverless execution
- **HughMann local SQLite** — already unused, formally deprecated
- **LaunchD plist management** — except for macOS-native skills on Elle

## What This Preserves

- **HughMann CLI** — interactive sessions, skills, slash commands
- **HughMann skills system** — extended with agent personas
- **HughMann sub-agent orchestration** — extended with persistent identities
- **Platform Supabase schema** — canonical data model, extended with North Star fields
- **Elle's Obsidian → pgvector pipeline** — customer intelligence keeps flowing
- **Domain isolation** — RLS + domain context, same pattern as today
