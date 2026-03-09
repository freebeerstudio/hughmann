# Phase 4D: Autonomous Operations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Hugh the ability to autonomously refine projects on cadence, propose work through approval bundles, and manage project lifecycle (register, provision, execute via Claude Code dispatch).

**Architecture:** Two streams — (1) Autonomous Refinement: daemon detects overdue projects → runs auto-refine skill → creates approval bundle → Trigger.dev manages approval lifecycle with timeout behavior per project's `approval_mode`. (2) Project Lifecycle: internal tools scan/provision project directories, Claude Code dispatch executes project-scoped tasks in worktrees.

**Tech Stack:** HughMann (Node/TypeScript), Supabase (PostgreSQL + Edge Functions), Trigger.dev, iOS (SwiftUI)

---

## Task 1: Add `approval_mode` + Infrastructure Fields to Project Type

**Context:** The `Project` interface in `src/types/projects.ts` needs three new fields: `approval_mode` (required for autonomous refinement gating), plus `local_path`, `stack`, and `claude_md_exists` (required for project lifecycle management). The `CreateProjectInput` and `UpdateProjectInput` types must also be updated.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/types/projects.ts`

**Changes:**

Add to `Project` interface:
```typescript
approval_mode: 'required' | 'auto_proceed' | 'notify_only'
local_path: string | null
stack: string[]
claude_md_exists: boolean
```

Add `approval_mode` to `CreateProjectInput` (optional, defaults to `'required'`):
```typescript
approval_mode?: 'required' | 'auto_proceed' | 'notify_only'
local_path?: string
stack?: string[]
claude_md_exists?: boolean
```

Add same fields to `UpdateProjectInput`:
```typescript
approval_mode?: 'required' | 'auto_proceed' | 'notify_only'
local_path?: string
stack?: string[]
claude_md_exists?: boolean
```

**Commit:** `feat: add approval_mode and infrastructure fields to Project type`

---

## Task 2: Supabase Migration for New Project Fields

**Context:** Add the new columns to the `projects` table in Supabase. Default `approval_mode` to `'required'` (safest default — Hugh waits for approval).

**Files:**
- Create: `/Users/waynebridges/Foundry/supabase/migrations/20260309000002_project_approval_mode.sql`

**Migration SQL:**
```sql
-- Add approval_mode for autonomous refinement gating
ALTER TABLE projects ADD COLUMN IF NOT EXISTS approval_mode TEXT NOT NULL DEFAULT 'required'
  CHECK (approval_mode IN ('required', 'auto_proceed', 'notify_only'));

-- Add project lifecycle management fields
ALTER TABLE projects ADD COLUMN IF NOT EXISTS local_path TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stack TEXT[] DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS claude_md_exists BOOLEAN DEFAULT false;

COMMENT ON COLUMN projects.approval_mode IS 'Controls autonomous refinement behavior: required (wait for Wayne), auto_proceed (proceed after timeout), notify_only (proceed immediately)';
COMMENT ON COLUMN projects.local_path IS 'Absolute path to project directory on disk';
COMMENT ON COLUMN projects.stack IS 'Detected frameworks/languages e.g. {nextjs,tailwind,supabase}';
COMMENT ON COLUMN projects.claude_md_exists IS 'Whether project has a CLAUDE.md file';
```

**Commit:** `feat: add approval_mode and lifecycle fields to projects table`

---

## Task 3: Update All Three DataAdapters for New Fields

**Context:** The Supabase, SQLite, and Turso adapters must handle the new fields in create/update/list operations. The fields should pass through transparently — no special logic needed beyond including them in queries.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/supabase.ts`
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/sqlite.ts`
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/turso.ts`

**Supabase adapter changes:**
- In `createProject()`: Include `approval_mode`, `local_path`, `stack`, `claude_md_exists` in the insert object. Default `approval_mode` to `'required'` if not provided.
- In `updateProject()`: Include new fields in the update object when present.
- In `listProjects()` / `getProject()` / `getProjectBySlug()`: No changes needed — Supabase `.select('*')` already returns all columns.

**SQLite adapter changes:**
- Update `init()` CREATE TABLE to include new columns with defaults.
- Update `createProject()` and `updateProject()` INSERT/UPDATE statements.
- Add migration check: `ALTER TABLE IF NOT EXISTS` pattern for existing databases.

**Turso adapter changes:**
- Same pattern as SQLite (shares similar SQL).

**Commit:** `feat: update all data adapters for project approval_mode and lifecycle fields`

---

## Task 4: Update Internal Tools for New Project Fields

**Context:** The `create_project` and `update_project` internal tools need to accept the new fields in their Zod schemas. The `list_projects` tool should display `approval_mode` in its output.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/tools/internal-tools.ts`

**Changes to `create_project` tool:**
Add to schema:
```typescript
approval_mode: z.enum(['required', 'auto_proceed', 'notify_only']).optional(),
local_path: z.string().optional(),
stack: z.array(z.string()).optional(),
claude_md_exists: z.boolean().optional(),
```

**Changes to `update_project` tool:**
Add same fields to schema.

**Changes to `list_projects` tool:**
Add `approval_mode` to the formatted output string:
```typescript
`  Approval: ${p.approval_mode}`
```
If `local_path` exists, show it too.

**Commit:** `feat: expose approval_mode and lifecycle fields in project tools`

---

## Task 5: Approval Bundles Table + DataAdapter Methods

**Context:** When Hugh auto-refines a project, he creates an "approval bundle" — a structured proposal containing decisions, proposed tasks, and reasoning. Wayne reviews and approves/rejects via iOS or chat. The bundle needs a Supabase table and DataAdapter methods.

**Files:**
- Create: `/Users/waynebridges/Foundry/supabase/migrations/20260309000003_approval_bundles.sql`
- Modify: `/Users/waynebridges/HughMann/src/types/projects.ts`
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/types.ts`
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/supabase.ts`
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/sqlite.ts`
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/turso.ts`

**ApprovalBundle type:**
```typescript
export interface ApprovalBundle {
  id: string
  project_id: string
  domain: string
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_proceeded'
  summary: string           // Human-readable summary of what Hugh proposes
  proposed_tasks: ProposedTask[]  // Tasks to create on approval
  reasoning: string         // How this traces to North Star + guardrails
  expires_at: string | null // When the approval window closes
  resolved_at: string | null
  resolved_by: string | null // 'wayne' | 'timeout' | 'auto'
  created_at: string
}

export interface ProposedTask {
  title: string
  description: string
  type: string        // 'big_rock' | 'must' | 'mit' | 'standard'
  assignee: string    // 'wayne' | 'hugh' | 'celine' | 'mark' | 'support'
  priority: number
}
```

**Migration SQL:**
```sql
CREATE TABLE IF NOT EXISTS approval_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'auto_proceeded')),
  summary TEXT NOT NULL,
  proposed_tasks JSONB NOT NULL DEFAULT '[]',
  reasoning TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_approval_bundles_project ON approval_bundles(project_id);
CREATE INDEX idx_approval_bundles_status ON approval_bundles(status);

ALTER TABLE approval_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage approval bundles for their projects"
  ON approval_bundles FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE domain IN (
      SELECT slug FROM tenant_members tm
      JOIN tenants t ON tm.tenant_id = t.id
      WHERE tm.user_id = auth.uid()
    ))
  );
```

**DataAdapter methods to add:**
```typescript
createApprovalBundle(input: Omit<ApprovalBundle, 'id' | 'created_at'>): Promise<ApprovalBundle>
listApprovalBundles(filters?: { project_id?: string; status?: string; domain?: string }): Promise<ApprovalBundle[]>
updateApprovalBundle(id: string, input: { status: string; resolved_at?: string; resolved_by?: string }): Promise<ApprovalBundle | null>
```

**Commit:** `feat: add approval_bundles table and DataAdapter methods`

---

## Task 6: Approval Bundle Internal Tools

**Context:** Hugh needs tools to create, list, and resolve approval bundles. Wayne (or the daemon on timeout) resolves them.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/tools/internal-tools.ts`

**New tools:**

**`create_approval_bundle`:**
```typescript
server.tool("create_approval_bundle", "Create an approval bundle for a project refinement", {
  project_id: z.string(),
  domain: z.string(),
  summary: z.string(),
  proposed_tasks: z.array(z.object({
    title: z.string(),
    description: z.string(),
    type: z.string(),
    assignee: z.string(),
    priority: z.number()
  })),
  reasoning: z.string(),
  expires_at: z.string().optional()  // ISO8601
}, async (params) => { ... })
```

**`list_approval_bundles`:**
```typescript
server.tool("list_approval_bundles", "List approval bundles, optionally filtered", {
  project_id: z.string().optional(),
  status: z.string().optional(),  // 'pending' | 'approved' | 'rejected' | etc.
  domain: z.string().optional()
}, async (params) => { ... })
```

**`resolve_approval_bundle`:**
```typescript
server.tool("resolve_approval_bundle", "Approve, reject, or expire an approval bundle", {
  bundle_id: z.string(),
  action: z.enum(['approve', 'reject', 'expire']),
  resolved_by: z.string().optional()  // defaults to 'wayne'
}, async (params) => {
  // If approved: create all proposed_tasks via data.createTask()
  // Update bundle status + resolved_at + resolved_by
})
```

**Commit:** `feat: add approval bundle internal tools`

---

## Task 7: Build `auto-refine` Skill

**Context:** A variant of the existing `/refine` skill that runs without Wayne in the loop. Instead of interactive discussion, Hugh autonomously reviews the project state, makes decisions, and outputs an approval bundle. The skill reads project context, applies North Star + guardrails reasoning, and creates an approval bundle rather than directly creating tasks.

**Files:**
- Create: `/Users/waynebridges/HughMann/src/skills/auto-refine/SKILL.md`

**SKILL.md content:**
```yaml
---
name: auto-refine
description: Autonomous project refinement — reviews state, proposes sprint, creates approval bundle
---
```

**Prompt body (key differences from /refine):**
1. **No interactive phases** — Hugh runs the full analysis autonomously
2. **Gather context** — Same as /refine: call `list_domain_goals`, `list_projects`, `list_tasks`
3. **Analysis** — Review North Star distance, guardrail compliance, task completion since last refinement
4. **Sprint proposal** — Generate 3-7 proposed tasks (same rules as /refine: types, assignees, North Star tracing)
5. **Create approval bundle** — Call `create_approval_bundle` with summary, proposed_tasks, reasoning
6. **DO NOT create tasks directly** — All task creation goes through the approval bundle
7. **Update `last_refinement_at`** — Call `update_project` to record refinement timestamp
8. **Log result** — Output summary of what was proposed and when the approval window expires

**Key behavioral rules:**
- Be more conservative than interactive refine (no Wayne to course-correct)
- Weight guardrails more heavily in autonomous mode
- Default approval window: 4 hours during business hours (7am-6pm CST)
- For `notify_only` projects: still create the bundle but mark it `auto_proceeded` and create tasks directly
- For `auto_proceed` projects: set expires_at, tasks created on expiry if no response
- For `required` projects: no expiry, bundle stays pending until Wayne acts

**Commit:** `feat: add auto-refine skill for autonomous project refinement`

---

## Task 8: Daemon Auto-Refine Trigger

**Context:** The daemon's scheduled task loop needs to check for projects overdue for refinement and trigger the `auto-refine` skill. This runs during the daemon's normal 60s poll cycle, alongside task queue processing.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/daemon/index.ts`

**Changes:**

Add a new function `checkRefinementSchedule()`:
```typescript
async function checkRefinementSchedule(runtime: Runtime, data: DataAdapter): Promise<void> {
  const projects = await data.listProjects({ status: 'active' })
  const now = new Date()

  for (const project of projects) {
    if (!project.last_refinement_at) continue
    const lastRefine = new Date(project.last_refinement_at)
    const cadenceDays = { weekly: 7, biweekly: 14, monthly: 30 }[project.refinement_cadence]
    const nextDue = new Date(lastRefine.getTime() + cadenceDays * 86400000)

    if (now >= nextDue) {
      // Check if there's already a pending approval bundle for this project
      const bundles = await data.listApprovalBundles({ project_id: project.id, status: 'pending' })
      if (bundles.length > 0) continue  // Already has pending work

      logger.info({ component: 'daemon', msg: 'Triggering auto-refine', project: project.slug })
      // Execute auto-refine skill for this project
      await runtime.executeSkill('auto-refine', { projectId: project.id, domain: project.domain })
    }
  }
}
```

Wire into the daemon's main loop (runs once per cycle, after task queue):
```typescript
// In the main daemon loop, after processTaskQueue()
await checkRefinementSchedule(runtime, data)
```

Add a method on Runtime (or use existing skill execution) to run a skill programmatically. Check if `runtime.executeSkill()` exists — if not, create a lightweight wrapper that builds the skill prompt and runs it through `doTaskStream()`.

**Commit:** `feat: daemon auto-refine trigger for overdue projects`

---

## Task 9: `register_project` Internal Tool

**Context:** Scans an existing project directory to detect its stack, git remote, CLAUDE.md, and services. Populates the project card in the database with infrastructure fields.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/tools/internal-tools.ts`

**New tool `register_project`:**
```typescript
server.tool("register_project", "Scan a project directory and register/update its infrastructure in the database", {
  project_id: z.string().describe("ID of existing project to update"),
  local_path: z.string().describe("Absolute path to project directory")
}, async (params) => {
  const { project_id, local_path } = params
  const fs = await import('fs/promises')
  const path = await import('path')
  const { execSync } = await import('child_process')

  // Verify directory exists
  const stat = await fs.stat(local_path).catch(() => null)
  if (!stat?.isDirectory()) return errorResult(`Directory not found: ${local_path}`)

  // Detect stack
  const stack: string[] = []
  const files = await fs.readdir(local_path)
  if (files.includes('package.json')) {
    const pkg = JSON.parse(await fs.readFile(path.join(local_path, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.next) stack.push('nextjs')
    if (deps.react) stack.push('react')
    if (deps.vue) stack.push('vue')
    if (deps.tailwindcss) stack.push('tailwind')
    if (deps['@supabase/supabase-js']) stack.push('supabase')
    if (deps.express) stack.push('express')
    if (deps.prisma || deps['@prisma/client']) stack.push('prisma')
  }
  if (files.includes('Cargo.toml')) stack.push('rust')
  if (files.includes('go.mod')) stack.push('go')
  if (files.some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))) stack.push('swift')
  if (files.includes('requirements.txt') || files.includes('pyproject.toml')) stack.push('python')

  // Detect CLAUDE.md
  const claudeMdExists = files.includes('CLAUDE.md')

  // Detect git remote
  let repoUrl: string | undefined
  try {
    repoUrl = execSync('git remote get-url origin', { cwd: local_path, encoding: 'utf8' }).trim()
  } catch { /* no git remote */ }

  // Update project
  const updated = await data.updateProject(project_id, {
    local_path,
    stack,
    claude_md_exists: claudeMdExists,
    infrastructure: {
      ...((await data.getProject(project_id))?.infrastructure || {}),
      ...(repoUrl ? { repo_url: repoUrl } : {})
    }
  })

  return { content: [{ type: 'text', text: `Registered ${local_path}\nStack: ${stack.join(', ') || 'none detected'}\nCLAUDE.md: ${claudeMdExists}\nRepo: ${repoUrl || 'none'}` }] }
})
```

**Commit:** `feat: add register_project internal tool`

---

## Task 10: `provision_project` Internal Tool

**Context:** Creates a new project directory, initializes git, creates a GitHub repo, and optionally scaffolds based on stack. For projects Hugh creates from scratch during refinement.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/tools/internal-tools.ts`

**New tool `provision_project`:**
```typescript
server.tool("provision_project", "Create a new project directory with git repo and optional scaffolding", {
  project_id: z.string().describe("ID of existing project to provision"),
  domain: z.string().describe("Domain slug (fbs, omnissa, personal, shared)"),
  slug: z.string().describe("Project slug for directory name"),
  create_github_repo: z.boolean().optional().describe("Create a GitHub repo (default true)"),
  private_repo: z.boolean().optional().describe("Make GitHub repo private (default true)")
}, async (params) => {
  const { project_id, domain, slug } = params
  const createRepo = params.create_github_repo !== false
  const privateRepo = params.private_repo !== false
  const fs = await import('fs/promises')
  const path = await import('path')
  const { execSync } = await import('child_process')
  const homedir = await import('os').then(os => os.homedir())

  const projectsRoot = path.join(homedir, 'Projects')
  const domainDir = path.join(projectsRoot, domain)
  const projectDir = path.join(domainDir, slug)

  // Create directory structure
  await fs.mkdir(projectDir, { recursive: true })

  // Init git
  execSync('git init', { cwd: projectDir })

  // Create CLAUDE.md stub
  const claudeMd = `# CLAUDE.md — ${slug}\n\n## Overview\n\nTODO: Describe this project.\n\n## Build & Test\n\nTODO: Add commands.\n`
  await fs.writeFile(path.join(projectDir, 'CLAUDE.md'), claudeMd)

  // Create GitHub repo if requested
  let repoUrl: string | undefined
  if (createRepo) {
    try {
      const visibility = privateRepo ? '--private' : '--public'
      execSync(`gh repo create ${slug} ${visibility} --source . --push`, { cwd: projectDir })
      repoUrl = execSync('git remote get-url origin', { cwd: projectDir, encoding: 'utf8' }).trim()
    } catch (e) {
      // GitHub CLI not available or auth issue — continue without repo
    }
  }

  // Update project card
  await data.updateProject(project_id, {
    local_path: projectDir,
    claude_md_exists: true,
    stack: [],
    infrastructure: {
      ...((await data.getProject(project_id))?.infrastructure || {}),
      ...(repoUrl ? { repo_url: repoUrl } : {})
    }
  })

  return { content: [{ type: 'text', text: `Provisioned ${projectDir}\nGit: initialized\nGitHub: ${repoUrl || 'skipped'}\nCLAUDE.md: created` }] }
})
```

**Commit:** `feat: add provision_project internal tool`

---

## Task 11: Claude Code Dispatch in Daemon Task Executor

**Context:** When a task belongs to a project with `local_path` set, the daemon should execute it via Claude Code (`claude` CLI) with `--cwd` pointing to the project directory. This gives the dispatched agent the project's CLAUDE.md context and full file access. Tasks execute in a git worktree for safety.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/daemon/index.ts`

**Changes to `processTaskQueue()`:**

After task selection and before the existing execution path, add a check:
```typescript
// Check if task's project has a local_path for Claude Code dispatch
if (task.project_id) {
  const project = await data.getProject(task.project_id)
  if (project?.local_path) {
    // Execute via Claude Code dispatch instead of doTaskStream
    const result = await executeViaClaudeCode(task, project, logger)
    await recordTaskResult(task, result, data, logger)
    continue
  }
}
```

**New function `executeViaClaudeCode()`:**
```typescript
async function executeViaClaudeCode(
  task: Task,
  project: Project,
  logger: Logger
): Promise<{ success: boolean; output: string }> {
  const { execSync } = await import('child_process')
  const prompt = `You are working on project "${project.name}".
North Star: ${project.north_star || 'Not set'}
Guardrails: ${project.guardrails?.join(', ') || 'None'}

Task: ${task.title}
${task.description || ''}

Work in a git worktree. Create a branch named task/${task.id.slice(0, 8)}. Make your changes, commit, and create a PR if the changes are non-trivial. Do not push to main.`

  try {
    const output = execSync(
      `claude --print --dangerously-skip-permissions --model claude-opus-4-6 "${prompt.replace(/"/g, '\\"')}"`,
      {
        cwd: project.local_path!,
        encoding: 'utf8',
        timeout: 300000,  // 5 minute timeout
        maxBuffer: 1024 * 1024 * 10  // 10MB
      }
    )
    return { success: true, output: output.slice(0, 4000) }
  } catch (e: any) {
    logger.error({ component: 'daemon', msg: 'Claude Code dispatch failed', error: e.message })
    return { success: false, output: e.message?.slice(0, 2000) || 'Unknown error' }
  }
}
```

**Commit:** `feat: Claude Code dispatch for project-scoped daemon tasks`

---

## Task 12: Approval Lifecycle Trigger.dev Task

**Context:** A Trigger.dev scheduled task that checks for expired approval bundles and handles timeout behavior. Runs every 15 minutes. For `auto_proceed` projects, creates the proposed tasks when the bundle expires. For `required` projects, sends a reminder notification.

**Files:**
- Create: `/Users/waynebridges/HughMann/src/trigger/approval-lifecycle.ts`

**Task implementation:**
```typescript
import { schedules } from "@trigger.dev/sdk/v3"
import { createSupabaseClient } from "./utils"

export const approvalLifecycle = schedules.task({
  id: "approval-lifecycle",
  cron: "*/15 7-18 * * 1-5",  // Every 15 min during business hours, weekdays
  run: async () => {
    const supabase = createSupabaseClient()

    // Fetch pending bundles that have expired
    const { data: expired } = await supabase
      .from('approval_bundles')
      .select('*, projects!inner(approval_mode, name)')
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())

    for (const bundle of expired || []) {
      const mode = bundle.projects.approval_mode

      if (mode === 'auto_proceed') {
        // Create all proposed tasks
        for (const task of bundle.proposed_tasks) {
          await supabase.from('tasks').insert({
            title: task.title,
            description: task.description,
            type: task.type,
            assignee: task.assignee,
            priority: task.priority,
            project_id: bundle.project_id,
            domain: bundle.domain,
            status: 'todo'
          })
        }
        // Mark bundle as auto_proceeded
        await supabase.from('approval_bundles').update({
          status: 'auto_proceeded',
          resolved_at: new Date().toISOString(),
          resolved_by: 'timeout'
        }).eq('id', bundle.id)
      } else if (mode === 'required') {
        // Don't auto-proceed — just mark as expired
        await supabase.from('approval_bundles').update({
          status: 'expired',
          resolved_at: new Date().toISOString(),
          resolved_by: 'timeout'
        }).eq('id', bundle.id)
        // TODO: Send reminder notification (push notification infrastructure needed)
      }
    }

    return { processed: expired?.length || 0 }
  }
})
```

**Commit:** `feat: add approval-lifecycle Trigger.dev task`

---

## Task 13: Update iOS HMProject Model

**Context:** The iOS app's `HMProject` Codable model needs the new fields so the approval mode and project infrastructure are visible in the app.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Models/HMProject.swift`

**Add fields:**
```swift
let approvalMode: String?     // "required" | "auto_proceed" | "notify_only"
let localPath: String?
let stack: [String]?
let claudeMdExists: Bool?
```

Use `CodingKeys` to map `approval_mode` → `approvalMode`, `local_path` → `localPath`, `claude_md_exists` → `claudeMdExists`.

**Commit:** `feat: add approval_mode and lifecycle fields to HMProject model`

---

## Task 14: Approval Bundle iOS Model + Service

**Context:** iOS needs to fetch and display approval bundles so Wayne can approve/reject refinement proposals from his phone.

**Files:**
- Create: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Models/ApprovalBundle.swift`
- Create: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Services/ApprovalService.swift`

**ApprovalBundle model:**
```swift
struct ApprovalBundle: Codable, Identifiable, Sendable {
    let id: String
    let projectId: String
    let domain: String
    let status: String
    let summary: String
    let proposedTasks: [ProposedTask]
    let reasoning: String
    let expiresAt: String?
    let resolvedAt: String?
    let resolvedBy: String?
    let createdAt: String

    struct ProposedTask: Codable, Sendable {
        let title: String
        let description: String
        let type: String
        let assignee: String
        let priority: Int
    }

    enum CodingKeys: String, CodingKey {
        case id, domain, status, summary, reasoning
        case projectId = "project_id"
        case proposedTasks = "proposed_tasks"
        case expiresAt = "expires_at"
        case resolvedAt = "resolved_at"
        case resolvedBy = "resolved_by"
        case createdAt = "created_at"
    }
}
```

**ApprovalService:**
```swift
@Observable
final class ApprovalService: @unchecked Sendable {
    var bundles: [ApprovalBundle] = []

    func fetchPending(domain: String? = nil) async { ... }
    func resolve(bundleId: String, action: String) async -> Bool { ... }  // approve/reject
}
```

Uses `SupabaseREST` for direct table queries (no edge function needed).

**Commit:** `feat: add ApprovalBundle model and ApprovalService for iOS`

---

## Task 15: Approval Bundle UI in iOS

**Context:** Add an approvals section to the Work tab showing pending approval bundles. Each bundle shows the project name, summary, proposed task count, and expiry time. Tap to see full details with approve/reject actions.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/WorkView.swift`
- Create: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/ApprovalBundleSheet.swift`

**WorkView changes:**
- Add `@State private var approvalService = ApprovalService()`
- Add "Pending Approvals" section above the goals list when bundles exist
- Each row shows: project name, summary (truncated), task count badge, time remaining

**ApprovalBundleSheet:**
- Full detail view of the bundle
- Shows: summary, reasoning, all proposed tasks with type/assignee
- Two buttons: "Approve All" (green), "Reject" (red)
- On approve: calls `approvalService.resolve(bundleId, "approve")`
- On reject: calls `approvalService.resolve(bundleId, "reject")`
- Dismiss sheet on action

**Commit:** `feat: add approval bundle UI to Work tab`

---

## Execution Order

1. **Task 1**: Project type changes (foundation for everything)
2. **Task 2**: Supabase migration (database must exist before adapters use it)
3. **Task 3**: DataAdapter updates (adapters must handle new fields)
4. **Task 4**: Internal tool updates (tools expose new fields)
5. **Task 5**: Approval bundles table + DataAdapter (foundation for approval system)
6. **Task 6**: Approval bundle tools (Hugh needs tools to create/manage bundles)
7. **Task 7**: Auto-refine skill (uses approval bundle tools)
8. **Task 8**: Daemon auto-refine trigger (triggers the skill)
9. **Task 9**: Register project tool (project lifecycle)
10. **Task 10**: Provision project tool (project lifecycle)
11. **Task 11**: Claude Code dispatch (project-scoped execution)
12. **Task 12**: Approval lifecycle Trigger.dev task (timeout handling)
13. **Task 13**: iOS HMProject model update
14. **Task 14**: iOS ApprovalBundle model + service
15. **Task 15**: iOS approval bundle UI

Total: 15 tasks across 3 repos (HughMann, Foundry, chief-of-staff-ios)
