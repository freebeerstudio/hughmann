# ChiefOfStaff iOS App Rebuild — Design

## Overview

Modify the existing ChiefOfStaff iOS app (`/Users/waynebridges/chief-of-staff-ios/`) to align with HughMann's current Supabase schema and implement a new 4-tab navigation structure built around the goal pyramid: Domain Goals → Projects → Tasks/Content.

The app looks like a todo app. Underneath, it orchestrates an agent team, content pipeline, and continuous planning flywheel across three business domains.

## Design Principles

- **Print on paper** — warm off-white (#FAFAF8), grayscale SF Pro typography, color only for completion green and urgency red
- **Understated power** — the complexity lives in the data model and Hugh's intelligence, not in the UI
- **Pyramid-first** — every task and content piece traces back to a domain goal through a project. No orphaned work.
- **Chat is the escape hatch** — anything the structured UI can't handle, Hugh can. Always one tap away.

## Navigation Structure

4 tabs, text-only footer (no icons):

```
Today  ·  Work  ·  Plan  ·  Settings
```

Chat bar pinned above footer on every tab. Tap → 85% slide-up sheet.

## Tab 1: Today — Daily Cockpit

The strongest screen in the current app. Stays mostly unchanged.

### Layout

```
┌──────────────────────────────┐
│ Saturday, March 8, 2026    ▾ │  ← date header, tap for calendar
├──────────────────────────────┤
│ ▾ Today                      │
│   MUST                       │
│   ○ Close Tarrant proposal   │
│     Omnissa · Tarrant College│
│                              │
│   MITs                       │
│   ○ Review Mark's drafts     │
│     FBS · Content Engine     │
│   ○ Ship habit widget        │
│     Personal · ChiefOfStaff  │
│   ○ Prep QBR deck            │
│     Omnissa · Lake Worth     │
│                              │
│   All Tasks →                │
├──────────────────────────────┤
│ ▾ Meetings                   │
│   9:00  Tarrant POC call     │
│   2:00  FBS weekly review    │
├──────────────────────────────┤
│ ▸ Habits                     │  ← collapsed by default
│   (expandable checklist)     │
├──────────────────────────────┤
│ ▸ Notes                      │
│   Capture a thought...       │
├──────────────────────────────┤
│ Daily Win: 1/1 MUST · 2/3    │
│ MITs · 5/7 habits            │
╞══════════════════════════════╡
│ Ask Hugh...              🎤  │  ← chat bar
├──────────────────────────────┤
│ Today · Work · Plan · Settings│
└──────────────────────────────┘
```

### Changes from current app

- **Task rows get project labels** — subtitle line: `domain · project name` in caption/tertiary
- **Habits**: Replace `HabitWheelView` with expandable checklist. Same SwiftData `Habit` model, same tap-to-complete interaction, just rendered as a flat list with checkmarks like tasks
- **Daily Win counter** — bottom of Today section. Simple text: "1/1 MUST · 2/3 MITs · 5/7 habits". No progress bars or rings.
- **MUST**: `task_type == 'must'` AND `status == 'todo'`
- **MITs**: `task_type == 'mit'` AND `status == 'todo'`, max 3

### Chat context when opened from Today

Hugh receives: time of day, today's task list with completion status, upcoming meetings. Morning → briefing mode. Afternoon → closeout mode.

## Tab 2: Work — The Pyramid

The core screen. Replaces both "Tasks" and content pipeline with a single hierarchical drill-down.

### Level 1: Domain Goals

Default view when opening Work tab. One card per domain goal.

```
┌──────────────────────────────┐
│ Free Beer Studio              │
│ Increase revenue daily        │
│ 3 active projects · 7 tasks   │
└──────────────────────────────┘
┌──────────────────────────────┐
│ Omnissa                       │
│ Win every deal in my territory│
│ 2 active projects · 4 tasks   │
└──────────────────────────────┘
┌──────────────────────────────┐
│ Personal                      │
│ Build the life I want         │
│ 1 active project · 2 tasks    │
└──────────────────────────────┘
```

Cards use the standard theme — white/surfaceDark background, 0.5pt border, 8pt corner radius. Domain name in headline weight, goal statement in body/light, counts in caption/tertiary.

### Level 2: Project List (tap a domain goal)

Back button returns to goals. Shows projects under that goal.

```
← Free Beer Studio

┌──────────────────────────────┐
│ Content Engine          active│
│ Steady stream of clients     │
│ find us through reputation   │
│ 4 tasks · 3 content pieces   │
│ Next refinement: Mar 14      │
└──────────────────────────────┘
┌──────────────────────────────┐
│ Client Sites            active│
│ Every site is portfolio-     │
│ worthy                       │
│ 2 tasks                      │
│ Next refinement: Mar 21      │
└──────────────────────────────┘
```

Project card shows:
- Name + status pill (active/paused/planning) — right-aligned, caption weight
- North star — 2-line max, italic, light weight
- Task count + content count (if > 0)
- Next refinement date based on `refinement_cadence` + `last_refinement_at`

Tap to expand guardrails inline (collapsible, not a new screen). Tap project name → project detail.

### Level 3: Project Detail

Two sub-views within the project, toggled by segmented control:

```
← Content Engine
        Tasks | Content
```

**Tasks view**:
- Grouped by type: MUST → MIT → Standard (big_rock shown as Standard with a marker)
- Each group is collapsible
- Task rows: checkbox + title + status pill (todo/in_progress/blocked/done)
- Assignee shown if not null: "Hugh" / "Mark" in caption
- Toggle at top: List | Board (Kanban columns: backlog/todo/in_progress/done)

**Content view**:
- Pipeline stages as horizontal tabs: Idea · Drafting · Review · Approved · Scheduled · Published
- List of content pieces in current stage
- Each row: title, platform badge (blog/linkedin/x), created_by
- Swipe right to advance status. Approve → auto-creates Mark drafting task.
- Tap → content detail with body, source material links, topic

### Data flow

```
domain_goals table → Level 1
  ↓ domain_goal_id
projects table → Level 2
  ↓ project_id
tasks table → Level 3 Tasks
content table → Level 3 Content
  ↓ topic_id
topics table → topic labels on content
```

## Tab 3: Plan — The Flywheel

Where you step back from doing and think about direction. Connected to projects and refinement cadences.

### Sub-tabs: Week | Month | Quarter | Year

Same tab bar pattern as current `PlansHubView` — underline indicator, text-only.

### Week

```
Week 10, 2026                ◁ ▷
─────────────────────────────────
┌ NORTH STAR ─────────────────┐
│ 📈 Steady stream of clients │
│ 💼 Win every deal           │
│ 💪 Build the life I want    │
└─────────────────────────────┘

This week's focus
[editable text field]

Sprint W10 Tasks
  Content Engine (3)
    ○ Review radar output
    ○ Approve 2 content ideas
    ○ Review Mark's drafts
  Tarrant College (1)
    ○ Send POC follow-up

──────────────────────────────
[ Refine with Hugh ]
```

- North star snippet (reuse existing `NorthStarSnippet`, update to pull from `projects.north_star`)
- Focus text saved as planning session
- Tasks grouped by project, filtered by `sprint` field
- "Refine with Hugh" → opens chat sheet with project context pre-loaded

### Month

- Projects due for refinement this month (compare `refinement_cadence` + `last_refinement_at` to current date)
- Refinement history — list of planning sessions with `decisions_made`, `tasks_created`
- Content radar summary — content pieces created this month, by status

### Quarter

- Domain goals with `reviewed_at` date — flag if not reviewed this quarter
- Project health cards: project name, north star, active task count, blocked count, guardrail list
- "Start quarterly review with Hugh" button

### Year

- Full north stars (not truncated) for all active projects, grouped by domain
- Guardrails listed under each project
- Projects by status: active / paused / incubating / completed

### The flywheel

Weekly refinements → generate tasks → tasks complete → next refinement reviews results → adjusts sprint → monthly rollup → quarterly goal review → adjusts north stars → back to weekly. Every "Refine with Hugh" and "Start review" button opens the chat sheet with context.

## Chat Sheet — Always Available

### Interaction

Chat bar pinned above footer nav on every screen:

```
┌──────────────────────────────┐
│ Ask Hugh...              🎤  │
└──────────────────────────────┘
```

Tap → slide-up sheet (85% screen height). Drag down to dismiss. Text input + mic button.

### Context injection

Based on the screen where chat was opened, Hugh receives structured context in the system message:

| Source screen | Context loaded |
|---|---|
| Today | Time of day, today's tasks + status, upcoming meetings |
| Work → Domain Goal | Domain name, goal statement, project summaries |
| Work → Project | Project name, north star, guardrails, recent tasks, content pipeline state |
| Work → Content piece | Piece title, status, source material, body draft |
| Plan → Week | Current sprint, tasks by project, what shipped last week |
| Plan → Quarter | Domain goals, project health, quarterly stats |

### "Refine with Hugh" flow

1. Button opens chat sheet
2. System message includes: project name, north star, guardrails, tasks completed since `last_refinement_at`, blocked tasks, content pipeline state
3. Hugh and Wayne have a refinement conversation
4. Hugh creates tasks, updates project, records planning session — all via Supabase
5. Dismiss sheet → Work and Plan tabs reflect new state

### No chat history screen

Conversations are ephemeral in the UI. Hugh's memory system handles persistence. Need to find something Hugh said? Ask Hugh.

## Settings Tab

Minimal. Configuration that rarely changes.

- **Domains** — list active domains, edit goal statements
- **Agents** — see agent personas (Hugh, Mark, Celine), their status, recent activity count
- **Content Sources** — manage RSS feeds (from `content_sources` table)
- **Topics** — manage content topics (from `topics` table)
- **Account** — Supabase auth, sign out
- **About** — version, links

## Data Model Changes (Swift)

### Models to update

| Current | New | Changes |
|---|---|---|
| `WorkItem` | `HMTask` | Rename. Statuses: `backlog/todo/in_progress/done/blocked`. Add: `task_type`, `assignee`, `assigned_agent_id`, `sprint`, `project_id`, `due_date`, `cwd`, `completion_notes` |
| `Idea` + `ContentPiece` | `HMContentPiece` | Merge into one. Status flow: `idea/drafting/review/approved/scheduled/published/rejected`. Add: `topic_id`, `source_material`, `created_by` |
| `NorthStar` | Remove | North star is now `Project.north_star` (a string field) |
| `Project` | `HMProject` | Add: `north_star`, `guardrails`, `domain_goal_id`, `infrastructure`, `refinement_cadence`, `last_refinement_at` |

### Models to add

| Model | Table | Fields |
|---|---|---|
| `HMDomainGoal` | `domain_goals` | `id, domain, statement, reviewed_at, created_at, updated_at` |
| `HMTopic` | `topics` | `id, domain, name, description, active, created_at` |
| `HMContentSource` | `content_sources` | `id, domain, name, type, url, active, created_at` |

### Models that stay

- `Habit` (SwiftData, local) — unchanged
- `CalendarEvent` — unchanged
- `ChatMessage` — unchanged
- `Domain` — update to reference `DomainGoal`
- `Agent` / `AgentPersona` — keep as-is for Settings display

Prefix new models with `HM` to avoid conflicts with SwiftUI/Foundation types.

### Services to update

| Service | Changes |
|---|---|
| `WorkItemService` | → `TaskService`. Query `tasks` table. Add `task_type`, `assignee`, `sprint` filters. |
| `IdeaService` + content handling | → `ContentService`. Single service against `content` table. Status transitions. Approve action creates Mark task via Supabase function or direct insert. |
| `PlanningService` | Connect to `planning_sessions` table. Add project-scoped queries. |
| New: `DomainGoalService` | CRUD against `domain_goals` table. |
| New: `ProjectService` | Replaces current project fetching. Add north_star, guardrails, refinement tracking. |

### Services that stay

- `AuthService` / `SharedAuth` — unchanged
- `CalendarService` — unchanged
- `WeatherService` — unchanged
- `ChatService` — add context injection parameter
- `HabitService` — unchanged (SwiftData)
- `MemoryService` — unchanged
- `NotificationService` — unchanged

## Views: What Changes, What Stays

### Modify

| View | Changes |
|---|---|
| `TodayView` | Add project label to task rows. Replace habit wheel with checklist. Add daily win counter. |
| `FooterNavigationView` | 5 tabs → 4: Today, Work, Plan, Settings |
| `PlanningViews` | Connect to projects + refinement cadence. Add "Refine with Hugh" buttons. Update NorthStarSnippet to use Project.north_star. |
| `ChatBarView` | Add context parameter for screen-aware injection |
| `ChatSheetView` | Accept + display pre-loaded context |
| `TaskDetailView` | Add task_type, assignee, sprint, project fields |
| `HabitWheelView` | → `HabitListView`. Flat checklist. |
| `ContentViews` | Simplify. Remove Idea/ContentPiece split. Single pipeline view with stage tabs. |

### Build new

| View | Purpose |
|---|---|
| `WorkView` | Top-level Work tab — domain goal cards |
| `ProjectListView` | Level 2 — projects under a domain goal |
| `ProjectDetailView` | Level 3 — Tasks + Content sub-tabs for a project |
| `DailyWinView` | Small component — MUST/MIT/habit completion fraction |
| `HabitListView` | Simple expandable checklist replacing HabitWheelView |

### Remove

| View | Reason |
|---|---|
| `StuffView` | Absorbed into Work tab + Settings |
| `KanbanBoardView` | Rebuilt as toggle within ProjectDetailView tasks |
| `AgentsPageView` | Moved to Settings |
| `HabitWheelView` | Replaced by HabitListView |
| `CompactRingsView` | No longer used |
| `PlansHubView` | Rebuilt — same pattern but connected to projects |

## Build Phases

### Phase 1: Foundation (make it functional)

1. Update Swift models to match backend schema (HMTask, HMProject, HMDomainGoal, HMContentPiece, HMTopic)
2. Update services (TaskService, ProjectService, DomainGoalService, ContentService)
3. Build WorkView with pyramid drill-down (goals → projects → tasks)
4. Update TodayView — project labels, habit list, daily win counter
5. Update FooterNavigationView to 4 tabs

### Phase 2: Content + Planning (make it useful)

6. Content pipeline view inside ProjectDetailView
7. Plan tab connected to projects — refinement cadence, planning session history
8. "Refine with Hugh" chat integration — context-aware pre-loading
9. Chat context injection based on current screen

### Phase 3: Polish (make it feel right)

10. Realtime Supabase subscriptions for live updates
11. iPad two-column layout for Work tab
12. Handoff support
13. Rough edge fixes from daily use

### Deferred (not in scope)

- Apple Watch
- Widgets
- Siri intents
- Web dashboard
- Push notifications

## Constraints

- **Supabase required** — no offline-first architecture. If no connection, show cached data read-only.
- **No API middleware** — app talks to Supabase directly. RLS enforces tenant isolation.
- **Hugh invocation** — chat goes through HughMann's MCP server or Trigger.dev task, not direct Claude API calls from the app.
- **Theme unchanged** — `Theme.swift` stays exactly as-is. Print on paper.
- **iOS 17+** — SwiftUI + SwiftData. No UIKit bridging unless absolutely necessary.
