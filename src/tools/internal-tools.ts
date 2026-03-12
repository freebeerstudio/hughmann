/**
 * Internal MCP tool server for HughMann self-management.
 *
 * Provides task management, project management, planning tools,
 * and time tools that the agent can call during autonomous execution.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { DataAdapter } from '../adapters/data/types.js'
import type { ContextStore } from '../types/context.js'
import type { ContextWriter } from '../runtime/context-writer.js'
import type { MemoryManager } from '../runtime/memory.js'
import type { TaskStatus, TaskType } from '../types/tasks.js'
import type { ProjectStatus } from '../types/projects.js'
import type { ContentStatus, ContentPlatform, ContentSourceType } from '../types/content.js'
import { MCP_REGISTRY, findMatchingServers } from '../runtime/mcp-registry.js'
import { addMcpServer, removeMcpServer } from '../runtime/mcp-config.js'
import { domainToCustomerId, OWNER_USER_ID } from '../util/domain.js'

/** Helper to create an error tool response instead of throwing */
function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  }
}

/** Sanitize text for safe JSON serialization in Agent SDK stream.
 *  Strips control characters and caps total length. */
function sanitizeToolOutput(text: string, maxLength: number = 4000): string {
  // Strip control chars except newline/tab, replace null bytes
  const clean = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  return clean.length > maxLength
    ? clean.slice(0, maxLength) + '\n\n[truncated]'
    : clean
}

/** Strip undefined values from an object (prevents wiping DB fields via spread) */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value
  }
  return result as Partial<T>
}

/** Truncate large JSON payloads to avoid flooding the context */
function truncatedJson(data: unknown, maxLength = 8000): string {
  const json = JSON.stringify(data, null, 2)
  if (json.length <= maxLength) return json
  return json.slice(0, maxLength) + '\n\n... [truncated]'
}

/** Fire a push notification to the Supabase push-notifications edge function. Best-effort. */
async function sendPushNotification(payload: {
  user_id: string
  customer_id: string
  category: string
  title: string
  body?: string
  data?: Record<string, unknown>
}): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_KEY
  if (!supabaseUrl || !serviceKey) return

  await fetch(`${supabaseUrl}/functions/v1/push-notifications`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'send', ...payload }),
  })
}

export function createInternalToolServer(
  data: DataAdapter,
  context: ContextStore,
  writer?: ContextWriter,
  memory?: MemoryManager,
  hughmannHome?: string,
) {
  // ─── Task Tools ────────────────────────────────────────────────────────────

  const listTasks = tool(
    'list_tasks',
    'List tasks filtered by status, domain, project, or type. Returns JSON array of task objects.',
    {
      status: z.string().optional().describe('Comma-separated statuses: backlog, todo, in_progress, done, blocked'),
      domain: z.string().optional().describe('Filter by domain slug'),
      project: z.string().optional().describe('Filter by project name'),
      task_type: z.string().optional().describe('Comma-separated types: must, mit, big_rock, standard'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    async (args) => {
      try {
        const filters: Record<string, unknown> = {}
        if (args.status) {
          const statuses = args.status.split(',').map(s => s.trim()) as TaskStatus[]
          filters.status = statuses.length === 1 ? statuses[0] : statuses
        }
        if (args.domain) filters.domain = args.domain
        if (args.project) filters.project_id = args.project
        if (args.task_type) {
          const types = args.task_type.split(',').map(s => s.trim()) as TaskType[]
          filters.task_type = types.length === 1 ? types[0] : types
        }
        if (args.limit) filters.limit = args.limit

        const tasks = await data.listTasks(filters)
        return {
          content: [{
            type: 'text' as const,
            text: tasks.length === 0
              ? 'No tasks found matching those filters.'
              : truncatedJson(tasks),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const createTask = tool(
    'create_task',
    'Create a new task. Returns the created task object.',
    {
      title: z.string().describe('Task title (required)'),
      description: z.string().optional().describe('Detailed description of what needs to be done'),
      status: z.string().optional().describe('Status: backlog, todo, in_progress, done, blocked (default: todo)'),
      task_type: z.string().optional().describe('Type: must, mit, big_rock, standard (default: standard)'),
      domain: z.string().optional().describe('Domain slug (omnissa, fbs, personal)'),
      project_id: z.string().optional().describe('UUID of the project this task belongs to'),
      priority: z.number().optional().describe('Priority 0-5, lower is higher (default: 3)'),
      due_date: z.string().optional().describe('Due date (ISO 8601 or YYYY-MM-DD)'),
      cwd: z.string().optional().describe('Working directory for file-based tasks'),
      assignee: z.string().optional().describe('Who is assigned to this task (e.g. "Hugh", "Elle", "Wayne")'),
      sprint: z.string().optional().describe('Sprint identifier (e.g. "2026-W10", "phase-1")'),
      blocked_reason: z.string().optional().describe('Why the task is blocked (set status to "blocked" too)'),
    },
    async (args) => {
      try {
        const task = await data.createTask(stripUndefined(args) as Parameters<typeof data.createTask>[0])
        return {
          content: [{
            type: 'text' as const,
            text: `Created task: "${task.title}" (${task.id})\nStatus: ${task.status} | Type: ${task.task_type} | Priority: ${task.priority}${task.project_id ? ` | Project: ${task.project_id}` : ''}`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const updateTask = tool(
    'update_task',
    'Update an existing task. Pass the task ID and any fields to change.',
    {
      task_id: z.string().describe('The UUID of the task to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: z.string().optional().describe('New status: backlog, todo, in_progress, done, blocked'),
      task_type: z.string().optional().describe('New type: must, mit, big_rock, standard'),
      domain: z.string().optional().describe('New domain'),
      project_id: z.string().optional().describe('UUID of the project'),
      priority: z.number().optional().describe('New priority 0-5'),
      due_date: z.string().optional().describe('New due date'),
      cwd: z.string().optional().describe('New working directory'),
      assignee: z.string().optional().describe('Who is assigned to this task'),
      sprint: z.string().optional().describe('Sprint identifier'),
      blocked_reason: z.string().optional().describe('Why the task is blocked'),
      assigned_agent_id: z.string().optional().describe('Agent instance ID for multi-agent assignment'),
    },
    async (args) => {
      try {
        const { task_id, ...rest } = args
        const updates = stripUndefined(rest)
        const task = await data.updateTask(task_id, updates as Parameters<typeof data.updateTask>[1])
        if (!task) return errorResult(`Task not found: ${task_id}`)
        return {
          content: [{
            type: 'text' as const,
            text: `Updated task: "${task.title}" (${task.id})\nStatus: ${task.status} | Type: ${task.task_type} | Priority: ${task.priority}`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const completeTask = tool(
    'complete_task',
    'Mark a task as done with an optional completion summary.',
    {
      task_id: z.string().describe('The UUID of the task to complete'),
      summary: z.string().optional().describe('Completion notes or summary of what was accomplished'),
    },
    async (args) => {
      try {
        const task = await data.completeTask(args.task_id, args.summary)
        if (!task) return errorResult(`Task not found: ${args.task_id}`)
        return {
          content: [{
            type: 'text' as const,
            text: `Completed task: "${task.title}"\n${args.summary ? `Notes: ${args.summary}` : ''}`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // ─── Project Tools ─────────────────────────────────────────────────────────

  const listProjects = tool(
    'list_projects',
    'List projects from the database. Filter by domain and/or status. Returns project details including North Star, guardrails, and task counts.',
    {
      domain: z.string().optional().describe('Filter by domain slug (omnissa, fbs, personal)'),
      status: z.string().optional().describe('Comma-separated statuses: planning, active, paused, completed, archived'),
    },
    async (args) => {
      try {
        const filters: Record<string, unknown> = {}
        if (args.domain) filters.domain = args.domain
        if (args.status) {
          const statuses = args.status.split(',').map(s => s.trim()) as ProjectStatus[]
          filters.status = statuses.length === 1 ? statuses[0] : statuses
        }

        const projects = await data.listProjects(filters)

        if (projects.length === 0) {
          // Fall back to showing domains from context
          const domains: { name: string; domain: string; type: string }[] = []
          for (const [slug, domain] of context.domains) {
            domains.push({ name: domain.name, domain: slug, type: domain.domainType })
          }
          return {
            content: [{
              type: 'text' as const,
              text: 'No projects found in database.' +
                (domains.length > 0 ? `\n\nAvailable domains from context:\n${truncatedJson(domains)}` : ''),
            }],
          }
        }

        const formatted = projects.map(p => {
          const lines = [
            `### ${p.name} [${p.status}] (${p.domain ?? 'no domain'})`,
            `  ID: ${p.id} | Slug: ${p.slug} | Priority: ${p.priority} | Cadence: ${p.refinement_cadence}`,
          ]
          if (p.north_star) lines.push(`  North Star: ${p.north_star}`)
          if (p.guardrails.length > 0) lines.push(`  Guardrails: ${p.guardrails.join('; ')}`)
          lines.push(`  Approval: ${p.approval_mode}`)
          if (p.local_path) lines.push(`  Path: ${p.local_path}`)
          return lines.join('\n')
        }).join('\n\n')

        return {
          content: [{
            type: 'text' as const,
            text: sanitizeToolOutput(`## Projects (${projects.length})\n\n${formatted}`),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const createProject = tool(
    'create_project',
    'Create a new project with name, domain, description, north star, and guardrails.',
    {
      name: z.string().describe('Project name (required)'),
      slug: z.string().optional().describe('URL-friendly slug (auto-generated from name if omitted)'),
      description: z.string().optional().describe('What this project is about'),
      domain: z.string().optional().describe('Domain slug (omnissa, fbs, personal)'),
      status: z.string().optional().describe('Status: planning, active, paused, completed, archived (default: planning)'),
      priority: z.number().optional().describe('Priority 0-5 (default: 3)'),
      north_star: z.string().optional().describe('The single North Star outcome that defines project success'),
      guardrails: z.array(z.string()).optional().describe('Guardrail constraints the project must stay within'),
      refinement_cadence: z.enum(['weekly', 'biweekly', 'monthly']).optional().describe('How often to refine and review this project'),
      domain_goal_id: z.string().optional().describe('UUID of the domain goal this project supports'),
      approval_mode: z.enum(['required', 'auto_proceed', 'notify_only']).optional().describe('Approval mode for autonomous refinement bundles'),
      local_path: z.string().optional().describe('Local filesystem path to the project repo'),
      stack: z.array(z.string()).optional().describe('Tech stack tags (e.g. ["typescript", "react"])'),
      claude_md_exists: z.boolean().optional().describe('Whether the project has a CLAUDE.md file'),
    },
    async (args) => {
      try {
        const clean = stripUndefined(args)
        const project = await data.createProject(clean as Parameters<typeof data.createProject>[0])
        return {
          content: [{
            type: 'text' as const,
            text: `Created project: "${project.name}" (${project.id})\nSlug: ${project.slug} | Domain: ${project.domain ?? 'none'} | Status: ${project.status}` +
              (project.north_star ? `\nNorth Star: ${project.north_star}` : '') +
              (project.guardrails.length > 0 ? `\nGuardrails:\n${project.guardrails.map(g => `  - ${g}`).join('\n')}` : ''),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const updateProject = tool(
    'update_project',
    'Update an existing project. Pass the project ID and any fields to change.',
    {
      project_id: z.string().describe('The UUID of the project to update'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description'),
      domain: z.string().optional().describe('New domain'),
      status: z.string().optional().describe('New status: planning, active, paused, completed, archived'),
      priority: z.number().optional().describe('New priority 0-5'),
      north_star: z.string().optional().describe('The single North Star outcome that defines project success'),
      guardrails: z.array(z.string()).optional().describe('Guardrail constraints the project must stay within'),
      refinement_cadence: z.enum(['weekly', 'biweekly', 'monthly']).optional().describe('How often to refine and review this project'),
      domain_goal_id: z.string().optional().describe('UUID of the domain goal this project supports'),
      last_refinement_at: z.string().optional().describe('ISO timestamp of the last refinement session'),
      approval_mode: z.enum(['required', 'auto_proceed', 'notify_only']).optional().describe('Approval mode for autonomous refinement bundles'),
      local_path: z.string().optional().describe('Local filesystem path to the project repo'),
      stack: z.array(z.string()).optional().describe('Tech stack tags (e.g. ["typescript", "react"])'),
      claude_md_exists: z.boolean().optional().describe('Whether the project has a CLAUDE.md file'),
    },
    async (args) => {
      try {
        const { project_id, ...rest } = args
        const updates: Record<string, unknown> = stripUndefined(rest)
        const project = await data.updateProject(project_id, updates as Parameters<typeof data.updateProject>[1])
        if (!project) return errorResult(`Project not found: ${project_id}`)
        return {
          content: [{
            type: 'text' as const,
            text: `Updated project: "${project.name}" (${project.id})\nStatus: ${project.status} | Domain: ${project.domain ?? 'none'}`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const registerProject = tool(
    'register_project',
    'Scan a project directory and register its infrastructure (stack, git remote, CLAUDE.md)',
    {
      project_id: z.string().describe('ID of existing project to update'),
      local_path: z.string().describe('Absolute path to project directory'),
    },
    async (params) => {
      try {
        const fs = await import('fs/promises')
        const nodePath = await import('path')
        const { execSync } = await import('child_process')

        const { project_id, local_path } = params

        // Verify directory exists
        const stat = await fs.stat(local_path).catch(() => null)
        if (!stat?.isDirectory()) return errorResult(`Directory not found: ${local_path}`)

        // Detect stack from files
        const stack: string[] = []
        const files = await fs.readdir(local_path)

        if (files.includes('package.json')) {
          try {
            const pkg = JSON.parse(await fs.readFile(nodePath.join(local_path, 'package.json'), 'utf8'))
            const deps = { ...pkg.dependencies, ...pkg.devDependencies }
            if (deps.next) stack.push('nextjs')
            if (deps.react && !deps.next) stack.push('react')
            if (deps.vue) stack.push('vue')
            if (deps.tailwindcss) stack.push('tailwind')
            if (deps['@supabase/supabase-js']) stack.push('supabase')
            if (deps.express) stack.push('express')
            if (deps.prisma || deps['@prisma/client']) stack.push('prisma')
            if (deps.typescript) stack.push('typescript')
          } catch { /* couldn't parse package.json */ }
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

        // Get existing project to merge infrastructure
        const existing = await data.getProject(project_id)
        if (!existing) return errorResult(`Project ${project_id} not found`)

        // Update project card
        await data.updateProject(project_id, {
          local_path,
          stack,
          claude_md_exists: claudeMdExists,
          infrastructure: {
            ...existing.infrastructure,
            ...(repoUrl ? { repo_url: repoUrl } : {}),
          },
        })

        return {
          content: [{
            type: 'text' as const,
            text: `Registered ${local_path}\nStack: ${stack.join(', ') || 'none detected'}\nCLAUDE.md: ${claudeMdExists}\nRepo: ${repoUrl || 'none'}`,
          }],
        }
      } catch (e: unknown) {
        return errorResult(`Failed to register project: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  )

  const provisionProject = tool(
    'provision_project',
    'Create a new project directory with git repo and CLAUDE.md stub',
    {
      project_id: z.string().describe('ID of existing project to provision'),
      domain: z.string().describe('Domain slug (fbs, omnissa, personal, shared)'),
      slug: z.string().describe('Project slug for directory name'),
      create_github_repo: z.boolean().optional().describe('Create a GitHub repo (default true)'),
      private_repo: z.boolean().optional().describe('Make GitHub repo private (default true)'),
    },
    async (params) => {
      try {
        const fs = await import('fs/promises')
        const nodePath = await import('path')
        const { execSync } = await import('child_process')
        const { homedir } = await import('os')

        const { project_id, domain, slug } = params
        const createRepo = params.create_github_repo !== false
        const privateRepo = params.private_repo !== false

        // Get project to use name in CLAUDE.md
        const project = await data.getProject(project_id)
        if (!project) return errorResult(`Project ${project_id} not found`)

        const projectsRoot = nodePath.join(homedir(), 'Projects')
        const domainDir = nodePath.join(projectsRoot, domain)
        const projectDir = nodePath.join(domainDir, slug)

        // Check if directory already exists
        const existingStat = await fs.stat(projectDir).catch(() => null)
        if (existingStat) return errorResult(`Directory already exists: ${projectDir}`)

        // Create directory structure
        await fs.mkdir(projectDir, { recursive: true })

        // Init git
        execSync('git init', { cwd: projectDir, stdio: 'pipe' })

        // Create CLAUDE.md stub
        const claudeMd = `# CLAUDE.md — ${project.name}

## Overview

${project.description || 'TODO: Describe this project.'}

## North Star

${project.north_star || 'TODO: Define the north star.'}

## Guardrails

${project.guardrails?.map(g => `- ${g}`).join('\n') || '- TODO: Define guardrails'}

## Build & Test

TODO: Add commands.
`
        await fs.writeFile(nodePath.join(projectDir, 'CLAUDE.md'), claudeMd)

        // Initial commit
        execSync('git add -A && git commit -m "Initial commit with CLAUDE.md"', { cwd: projectDir, stdio: 'pipe' })

        // Create GitHub repo if requested
        let repoUrl: string | undefined
        if (createRepo) {
          try {
            const visibility = privateRepo ? '--private' : '--public'
            execSync(`gh repo create ${slug} ${visibility} --source . --push`, { cwd: projectDir, stdio: 'pipe' })
            repoUrl = execSync('git remote get-url origin', { cwd: projectDir, encoding: 'utf8' }).trim()
          } catch {
            // gh CLI not available or auth issue — continue without repo
          }
        }

        // Update project card
        await data.updateProject(project_id, {
          local_path: projectDir,
          claude_md_exists: true,
          stack: [],
          infrastructure: {
            ...project.infrastructure,
            ...(repoUrl ? { repo_url: repoUrl } : {}),
          },
        })

        return {
          content: [{
            type: 'text' as const,
            text: `Provisioned ${projectDir}\nGit: initialized\nGitHub: ${repoUrl || 'skipped'}\nCLAUDE.md: created with project context`,
          }],
        }
      } catch (e: unknown) {
        return errorResult(`Failed to provision project: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  )

  // ─── Approval Bundle Tools ──────────────────────────────────────────────────

  const createApprovalBundle = tool(
    'create_approval_bundle',
    'Create an approval bundle for autonomous project refinement',
    {
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
      expires_at: z.string().optional(),
      status: z.enum(['pending', 'auto_proceeded']).optional()
    },
    async (params) => {
      try {
        const bundle = await data.createApprovalBundle({
          project_id: params.project_id,
          domain: params.domain,
          status: params.status || 'pending',
          summary: params.summary,
          proposed_tasks: params.proposed_tasks,
          reasoning: params.reasoning,
          expires_at: params.expires_at || null,
          resolved_at: null,
          resolved_by: null
        })

        // Best-effort push notification — never block on delivery
        const project = await data.getProject(params.project_id).catch(() => null)
        const projectName = project?.name || params.project_id
        sendPushNotification({
          user_id: OWNER_USER_ID,
          customer_id: domainToCustomerId(params.domain),
          category: 'approval_request',
          title: 'Approval Request',
          body: `${projectName}: ${params.summary}`.slice(0, 200),
          data: { bundle_id: bundle.id },
        }).catch(() => {})

        return { content: [{ type: 'text' as const, text: `Created approval bundle ${bundle.id}\nProject: ${params.project_id}\nTasks proposed: ${params.proposed_tasks.length}\nExpires: ${params.expires_at || 'no expiry (required mode)'}` }] }
      } catch (e: unknown) {
        return errorResult(`Failed to create approval bundle: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  )

  const listApprovalBundles = tool(
    'list_approval_bundles',
    'List approval bundles, optionally filtered by project, status, or domain',
    {
      project_id: z.string().optional(),
      status: z.string().optional(),
      domain: z.string().optional()
    },
    async (params) => {
      try {
        const bundles = await data.listApprovalBundles(params)
        if (!bundles.length) return { content: [{ type: 'text' as const, text: 'No approval bundles found.' }] }
        const lines = bundles.map(b =>
          `[${b.status}] ${b.id}\n  Project: ${b.project_id}\n  Summary: ${b.summary.slice(0, 200)}\n  Tasks: ${b.proposed_tasks.length}\n  Expires: ${b.expires_at || 'none'}\n  Created: ${b.created_at}`
        )
        return { content: [{ type: 'text' as const, text: lines.join('\n\n') }] }
      } catch (e: unknown) {
        return errorResult(`Failed to list approval bundles: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  )

  const resolveApprovalBundle = tool(
    'resolve_approval_bundle',
    'Approve, reject, or expire an approval bundle — approved bundles create all proposed tasks',
    {
      bundle_id: z.string(),
      action: z.enum(['approve', 'reject', 'expire']),
      resolved_by: z.string().optional()
    },
    async (params) => {
      try {
        const bundles = await data.listApprovalBundles({})
        const bundle = bundles.find(b => b.id === params.bundle_id)
        if (!bundle) return errorResult(`Bundle ${params.bundle_id} not found`)
        if (bundle.status !== 'pending') return errorResult(`Bundle is already ${bundle.status}`)

        const statusMap = { approve: 'approved', reject: 'rejected', expire: 'expired' } as const
        const now = new Date().toISOString()

        // If approving, create all proposed tasks
        if (params.action === 'approve') {
          for (const task of bundle.proposed_tasks) {
            await data.createTask({
              title: task.title,
              description: task.description,
              task_type: task.type as TaskType,
              assignee: task.assignee,
              priority: task.priority,
              project_id: bundle.project_id,
              domain: bundle.domain,
              status: 'todo'
            })
          }
        }

        await data.updateApprovalBundle(params.bundle_id, {
          status: statusMap[params.action],
          resolved_at: now,
          resolved_by: params.resolved_by ?? 'wayne'
        })

        const actionPast = { approve: 'Approved', reject: 'Rejected', expire: 'Expired' }[params.action]
        const taskMsg = params.action === 'approve' ? `\n${bundle.proposed_tasks.length} tasks created.` : ''
        return { content: [{ type: 'text' as const, text: `${actionPast} bundle ${params.bundle_id}.${taskMsg}` }] }
      } catch (e: unknown) {
        return errorResult(`Failed to resolve approval bundle: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  )

  // ─── Planning Tools ────────────────────────────────────────────────────────

  const getPlanningContext = tool(
    'get_planning_context',
    'Assembles a full planning briefing: active projects, open tasks, stale projects, domains with no projects, domain goals, quarterly gap analysis, open questions from last planning session, and recent decisions. Call this at the start of a /focus planning session.',
    {},
    async () => {
      try {
        const briefing: string[] = []
        const now = new Date()

        // 1. Active projects
        const allProjects = await data.listProjects({ status: ['planning', 'active', 'paused'] })
        briefing.push(`## Active Projects (${allProjects.length})`)
        if (allProjects.length === 0) {
          briefing.push('No projects defined yet. This is a great opportunity to create some!')
        } else {
          for (const p of allProjects) {
            const taskCount = (await data.listTasks({ project_id: p.id })).length
            briefing.push(`### ${p.name} [${p.status}] (${p.domain ?? 'no domain'}) — cadence: ${p.refinement_cadence}`)
            if (p.north_star) briefing.push(`  North Star: ${p.north_star}`)
            if (p.guardrails.length > 0) briefing.push(`  Guardrails: ${p.guardrails.join('; ')}`)
            briefing.push(`  Tasks: ${taskCount}`)

            // Check for staleness
            const daysSinceUpdate = Math.floor((now.getTime() - new Date(p.updated_at).getTime()) / (1000 * 60 * 60 * 24))
            if (daysSinceUpdate > 14) {
              briefing.push(`  ⚠ STALE: No updates in ${daysSinceUpdate} days`)
            }
          }
        }

        // 2. Open tasks summary
        const openTasks = await data.listTasks({ status: ['todo', 'in_progress', 'blocked'] })
        briefing.push('')
        briefing.push(`## Open Tasks (${openTasks.length})`)
        const blocked = openTasks.filter(t => t.status === 'blocked')
        const inProgress = openTasks.filter(t => t.status === 'in_progress')
        if (blocked.length > 0) {
          briefing.push(`⚠ ${blocked.length} blocked: ${blocked.map(t => t.title).join(', ')}`)
        }
        if (inProgress.length > 0) {
          briefing.push(`▶ ${inProgress.length} in progress: ${inProgress.map(t => t.title).join(', ')}`)
        }
        briefing.push(`📋 ${openTasks.filter(t => t.status === 'todo').length} to do`)

        // 3. Domains with no projects
        const domainsWithProjects = new Set(allProjects.map(p => p.domain).filter(Boolean))
        const allDomains = Array.from(context.domains.keys())
        const emptyDomains = allDomains.filter(d => !domainsWithProjects.has(d))
        if (emptyDomains.length > 0) {
          briefing.push('')
          briefing.push(`## Domains Without Projects`)
          briefing.push(`These domains have no projects yet: ${emptyDomains.join(', ')}`)
        }

        // 4. Last planning session
        const lastSession = await data.getLatestPlanningSession()
        if (lastSession) {
          briefing.push('')
          briefing.push(`## Last Planning Session (${lastSession.created_at})`)
          briefing.push(`Focus: ${lastSession.focus_area}`)
          if ((lastSession.open_questions ?? []).length > 0) {
            briefing.push(`Open questions:`)
            for (const q of lastSession.open_questions!) {
              briefing.push(`  - ${q}`)
            }
          }
          if ((lastSession.next_steps ?? []).length > 0) {
            briefing.push(`Next steps:`)
            for (const s of lastSession.next_steps!) {
              briefing.push(`  - ${s}`)
            }
          }
          if (lastSession.decisions_made.length > 0) {
            briefing.push(`Recent decisions:`)
            for (const d of lastSession.decisions_made) {
              briefing.push(`  - ${d}`)
            }
          }
        } else {
          briefing.push('')
          briefing.push(`## Last Planning Session`)
          briefing.push('No previous planning sessions found. This is the first one!')
        }

        // 5. Master plan context (read Big Rocks section)
        if (writer) {
          const masterPlan = writer.readDoc('master-plan.md')
          if (masterPlan) {
            const bigRocksMatch = masterPlan.match(/### Big Rocks This Week\n\n([\s\S]*?)(?=\n### |## )/m)
            if (bigRocksMatch) {
              briefing.push('')
              briefing.push(`## Big Rocks This Week`)
              briefing.push(bigRocksMatch[1].trim())
            }

            const quarterlyMatch = masterPlan.match(/## Q\d.*?Goals?\n\n([\s\S]*?)(?=\n## )/m)
            if (quarterlyMatch) {
              briefing.push('')
              briefing.push(`## Quarterly Goals`)
              briefing.push(quarterlyMatch[1].trim())
            }
          }
        }

        // 6. Domain goals
        try {
          const domainGoals = await data.listDomainGoals()
          if (domainGoals.length > 0) {
            briefing.push('')
            briefing.push(`## Domain Goals (${domainGoals.length})`)
            for (const g of domainGoals) {
              briefing.push(`- **${g.domain}**: ${g.statement} (reviewed: ${g.reviewed_at.split('T')[0]})`)
              if (g.current_state) {
                briefing.push(`  Current state: ${g.current_state}`)
              }
            }
          }
        } catch {
          // Best-effort — domain goals are optional
        }

        // 7. Self-improvement gaps
        try {
          const { getGapSummaryForFocus } = await import('../runtime/gap-analyzer.js')
          const gapSummary = await getGapSummaryForFocus(data)
          if (gapSummary) {
            briefing.push('')
            briefing.push(gapSummary)
          }
        } catch {
          // Best-effort — gap analysis is optional
        }

        return {
          content: [{
            type: 'text' as const,
            text: briefing.join('\n'),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const capturePlanningSummary = tool(
    'capture_planning_summary',
    'Save a planning session summary. Call this at the end of a /focus session to record what was covered, decided, and left open.',
    {
      session_id: z.string().describe('The current chat session ID'),
      focus_area: z.string().describe('The main area of focus for this session'),
      topics_covered: z.array(z.string()).describe('Topics discussed during the session'),
      decisions_made: z.array(z.string()).describe('Decisions made during the session'),
      tasks_created: z.array(z.string()).optional().describe('IDs of tasks created during the session'),
      projects_touched: z.array(z.string()).optional().describe('IDs of projects created or updated'),
      open_questions: z.array(z.string()).optional().describe('Questions left open for next session'),
      next_steps: z.array(z.string()).optional().describe('Concrete next steps to follow up on'),
    },
    async (args) => {
      try {
        const id = await data.savePlanningSession({
          session_id: args.session_id,
          focus_area: args.focus_area,
          topics_covered: args.topics_covered,
          decisions_made: args.decisions_made,
          tasks_created: args.tasks_created ?? [],
          projects_touched: args.projects_touched ?? [],
          open_questions: args.open_questions ?? [],
          next_steps: args.next_steps ?? [],
        })

        return {
          content: [{
            type: 'text' as const,
            text: `Planning session saved (${id}).\nFocus: ${args.focus_area}\nTopics: ${args.topics_covered.length} | Decisions: ${args.decisions_made.length} | Open questions: ${(args.open_questions ?? []).length}`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // ─── Briefing Tools ──────────────────────────────────────────────────────────

  const saveBriefing = tool(
    'save_briefing',
    'Save a briefing (morning dashboard, closeout, or weekly review). Used by scheduled tasks and interactive sessions.',
    {
      type: z.enum(['morning', 'closeout', 'weekly_review', 'custom']).describe('Briefing type'),
      content: z.string().describe('Briefing content in markdown'),
      domain: z.string().optional().describe('Domain scope (omit for cross-domain)'),
    },
    async (args) => {
      try {
        const id = await data.saveBriefing(args.type, args.content, args.domain)
        return { content: [{ type: 'text' as const, text: `Briefing saved: ${id}` }] }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const getLatestBriefing = tool(
    'get_latest_briefing',
    'Get the most recent briefing, optionally filtered by type.',
    {
      type: z.enum(['morning', 'closeout', 'weekly_review', 'custom']).optional().describe('Filter by briefing type'),
    },
    async (args) => {
      try {
        const briefing = await data.getLatestBriefing(args.type)
        if (!briefing) return { content: [{ type: 'text' as const, text: 'No briefings found.' }] }
        return { content: [{ type: 'text' as const, text: `**${briefing.type}** (${briefing.created_at})\n\n${briefing.content}` }] }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // ─── Advisor Tools ──────────────────────────────────────────────────────────

  const listAdvisors = tool(
    'list_advisors',
    'List available advisors, optionally filtered by expertise area (e.g., "pricing", "product", "leadership").',
    {
      expertise: z.string().optional().describe('Filter by expertise keyword'),
    },
    async (args) => {
      try {
        const advisors = await data.listAdvisors(args.expertise)
        if (advisors.length === 0) return { content: [{ type: 'text' as const, text: 'No advisors found.' }] }
        const text = advisors.map(a => `**${a.display_name}** (${a.role})\nExpertise: ${a.expertise.join(', ')}`).join('\n\n')
        return { content: [{ type: 'text' as const, text }] }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const getAdvisorPrompt = tool(
    'get_advisor_prompt',
    "Get an advisor's full system prompt for consultation. Use when a conversation topic matches an advisor's expertise.",
    {
      name: z.string().describe('Advisor name slug (e.g., "steve-jobs", "warren-buffett")'),
    },
    async (args) => {
      try {
        const advisor = await data.getAdvisorByName(args.name)
        if (!advisor) return errorResult(`Advisor "${args.name}" not found.`)
        return { content: [{ type: 'text' as const, text: advisor.system_prompt }] }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // ─── Context Tools ─────────────────────────────────────────────────────────

  const updateMasterPlanSection = tool(
    'update_master_plan_section',
    'Update a section of master-plan.md by heading. Replaces the content between the heading and the next same-level heading.',
    {
      section_heading: z.string().describe('The heading to find (e.g. "Big Rocks This Week")'),
      new_content: z.string().describe('The new content for that section'),
    },
    async (args) => {
      if (!writer) return errorResult('Context writer not available')
      try {
        const ok = writer.updateSection('master-plan.md', args.section_heading, args.new_content)
        if (!ok) return errorResult(`Section "${args.section_heading}" not found in master-plan.md`)
        return {
          content: [{
            type: 'text' as const,
            text: `Updated section "${args.section_heading}" in master-plan.md`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // ─── Knowledge Base Tools ──────────────────────────────────────────────────

  const searchKnowledgeBase = tool(
    'search_knowledge_base',
    'Semantic search across the knowledge base (customer intelligence, vault notes, processed emails). Uses vector similarity to find the most relevant content for a natural language query.',
    {
      query: z.string().describe('Natural language search query (e.g. "what devices does Acme University use?" or "recent support issues")'),
      vault: z.string().optional().describe('Filter to a specific vault (e.g. "omnissa", "fbs")'),
      limit: z.number().optional().describe('Max results to return (default: 5)'),
      threshold: z.number().optional().describe('Minimum similarity threshold 0-1 (default: 0.3)'),
    },
    async (args) => {
      if (!memory) return errorResult('Memory manager not available')
      try {
        const results = await memory.searchKnowledge(args.query, {
          limit: args.limit ?? 5,
          vault: args.vault,
          threshold: args.threshold ?? 0.3,
        })

        if (results.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No results found for "${args.query}"${args.vault ? ` in vault "${args.vault}"` : ''}.`,
            }],
          }
        }

        // Cap content per result to avoid overwhelming the Agent SDK JSON stream
        const maxPerResult = Math.floor(3000 / results.length)
        const formatted = results.map((r, i) =>
          `### ${i + 1}. ${r.title} (${(r.similarity * 100).toFixed(1)}% match)\n**Path**: ${r.filePath}\n\n${r.content.slice(0, maxPerResult)}${r.content.length > maxPerResult ? '...' : ''}`
        ).join('\n\n---\n\n')

        return {
          content: [{
            type: 'text' as const,
            text: sanitizeToolOutput(`## Knowledge Base Results (${results.length} matches)\n\n${formatted}`),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const browseKnowledgeBase = tool(
    'browse_knowledge_base',
    'Browse and list knowledge base entries by vault, keyword, or path. Use this to explore what customer intelligence and notes are available without needing a semantic query.',
    {
      vault: z.string().optional().describe('Filter to a specific vault (e.g. "omnissa", "fbs")'),
      keyword: z.string().optional().describe('Text keyword to search in titles and content'),
      path_prefix: z.string().optional().describe('Filter by file path prefix (e.g. "Customers/" or "Products/")'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    async (args) => {
      try {
        if (!('client' in data)) {
          return errorResult('Knowledge base browsing requires a Supabase data adapter.')
        }

        {
          const client = (data as Record<string, unknown>).client as {
            from: (table: string) => {
              select: (cols: string) => {
                order: (col: string, opts: { ascending: boolean }) => {
                  limit: (n: number) => {
                    eq?: (col: string, val: string) => unknown
                    ilike?: (col: string, val: string) => unknown
                    then: (fn: (result: { data: Record<string, unknown>[] | null }) => void) => Promise<void>
                  }
                }
              }
            }
          }

          let q = client
            .from('kb_nodes')
            .select('id, vault, file_path, title, node_type, last_modified, customer_id')
            .order('last_modified', { ascending: false })
            .limit(Math.min(args.limit ?? 20, 10))

          if (args.vault) {
            q = (q as unknown as { eq: (col: string, val: string) => typeof q }).eq('vault', args.vault)
          }
          if (args.keyword) {
            q = (q as unknown as { ilike: (col: string, val: string) => typeof q }).ilike('title', `%${args.keyword}%`)
          }
          if (args.path_prefix) {
            q = (q as unknown as { like: (col: string, val: string) => typeof q }).like('file_path', `${args.path_prefix}%`)
          }

          const result = await (q as unknown as Promise<{ data: Record<string, unknown>[] | null; error: unknown }>)
          const rows = (result as { data: Record<string, unknown>[] | null }).data ?? []

          if (rows.length === 0) {
            return {
              content: [{
                type: 'text' as const,
                text: `No knowledge base entries found${args.vault ? ` in vault "${args.vault}"` : ''}${args.keyword ? ` matching "${args.keyword}"` : ''}.`,
              }],
            }
          }

          const lines = rows.map((r: Record<string, unknown>) =>
            `- **${r.title || 'Untitled'}** (${r.vault})\n  Path: ${r.file_path} | Type: ${r.node_type || 'unknown'} | Modified: ${r.last_modified ? String(r.last_modified).split('T')[0] : 'unknown'}`
          )

          return {
            content: [{
              type: 'text' as const,
              text: sanitizeToolOutput(`## Knowledge Base (${rows.length} entries)\n\n${lines.join('\n')}`),
            }],
          }
        }

      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // ─── Domain Goal Tools ──────────────────────────────────────────────────────

  const listDomainGoals = tool(
    'list_domain_goals',
    'List domain goals. Optionally filter by domain slug. Domain goals define the strategic direction for each domain.',
    {
      domain: z.string().optional().describe('Filter by domain slug (omnissa, fbs, personal)'),
    },
    async (args) => {
      try {
        const goals = await data.listDomainGoals(args.domain)
        if (goals.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No domain goals found${args.domain ? ` for domain "${args.domain}"` : ''}.`,
            }],
          }
        }
        return {
          content: [{
            type: 'text' as const,
            text: truncatedJson(goals),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const updateDomainGoal = tool(
    'update_domain_goal',
    'Update a domain goal. Can change the statement, set the current progress state, and append state update entries. Use current_state to track where the domain is now relative to its north star. Use state_updates to record the full audit trail of state changes (pass the complete array including previous entries plus new ones).',
    {
      id: z.string().describe('UUID of the domain goal to update'),
      statement: z.string().optional().describe('New goal statement (only if changing the north star direction)'),
      current_state: z.string().optional().describe('Updated summary of where the domain is right now relative to its north star'),
      state_updates: z.array(z.object({
        date: z.string().describe('ISO date string (YYYY-MM-DD)'),
        projectId: z.string().describe('UUID of the completed project'),
        projectName: z.string().describe('Name of the completed project'),
        summary: z.string().describe('What was accomplished'),
        previousState: z.string().nullable().describe('Previous current_state before this update'),
        newState: z.string().describe('New current_state after this update'),
      })).optional().describe('Complete state update audit trail array (append new entry to existing array)'),
    },
    async (args) => {
      try {
        const { id, ...rest } = args
        const updates = stripUndefined(rest) as Parameters<typeof data.updateDomainGoal>[1]
        const goal = await data.updateDomainGoal(id, updates)
        if (!goal) return errorResult(`Domain goal not found: ${id}`)
        return {
          content: [{
            type: 'text' as const,
            text: `Updated domain goal for "${goal.domain}":\n` +
              `Statement: ${goal.statement}\n` +
              (goal.current_state ? `Current State: ${goal.current_state}\n` : '') +
              (goal.state_updates.length > 0 ? `State Updates: ${goal.state_updates.length} entries` : ''),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // ─── Content Tools ──────────────────────────────────────────────────────────

  const listContent = tool(
    'list_content',
    'List content pieces with optional filters by status, domain, topic, or limit.',
    {
      status: z.string().optional().describe('Comma-separated statuses: idea, drafting, review, approved, scheduled, published, rejected'),
      domain: z.string().optional().describe('Filter by domain slug'),
      topic_id: z.string().optional().describe('Filter by topic ID'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    async (args) => {
      try {
        const filters: Record<string, unknown> = {}
        if (args.status) {
          const statuses = args.status.split(',').map(s => s.trim()) as ContentStatus[]
          filters.status = statuses.length === 1 ? statuses[0] : statuses
        }
        if (args.domain) filters.domain = args.domain
        if (args.topic_id) filters.topic_id = args.topic_id
        filters.limit = args.limit ?? 20

        const content = await data.listContent(filters as Parameters<typeof data.listContent>[0])
        return {
          content: [{
            type: 'text' as const,
            text: content.length === 0
              ? 'No content found matching those filters.'
              : truncatedJson(content),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const createContent = tool(
    'create_content',
    'Create a content idea or draft. Provide domain, title, and optional details like platform, body, or source material.',
    {
      domain: z.string().describe('Domain slug for this content'),
      title: z.string().describe('Title of the content piece'),
      topic_id: z.string().optional().describe('Topic ID to associate with'),
      platform: z.enum(['blog', 'linkedin', 'x', 'newsletter', 'youtube', 'shorts']).optional().describe('Target platform'),
      body: z.string().optional().describe('Content body/draft text'),
      source_url: z.string().optional().describe('URL of source material'),
      source_title: z.string().optional().describe('Title of source material'),
      source_summary: z.string().optional().describe('Summary of source material'),
    },
    async (args) => {
      try {
        const input: Parameters<typeof data.createContent>[0] = {
          domain: args.domain,
          title: args.title,
          topic_id: args.topic_id,
          platform: args.platform as ContentPlatform | undefined,
          body: args.body,
        }

        if (args.source_url) {
          input.source_material = [{
            url: args.source_url,
            title: args.source_title ?? args.source_url,
            summary: args.source_summary ?? '',
          }]
        }

        const piece = await data.createContent(input)
        return {
          content: [{
            type: 'text' as const,
            text: `Content created: "${piece.title}" (id: ${piece.id}, status: ${piece.status})`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const updateContent = tool(
    'update_content',
    'Update a content piece — change status, title, body, platform, schedule, or published URL.',
    {
      id: z.string().describe('Content piece ID'),
      status: z.enum(['idea', 'drafting', 'review', 'approved', 'scheduled', 'published', 'rejected']).optional().describe('New status'),
      title: z.string().optional().describe('New title'),
      body: z.string().optional().describe('New body text'),
      platform: z.enum(['blog', 'linkedin', 'x', 'newsletter', 'youtube', 'shorts']).optional().describe('New platform'),
      scheduled_at: z.string().optional().describe('ISO datetime for scheduling'),
      published_url: z.string().optional().describe('URL where content was published'),
    },
    async (args) => {
      try {
        const updates = stripUndefined({
          status: args.status as ContentStatus | undefined,
          title: args.title,
          body: args.body,
          platform: args.platform as ContentPlatform | undefined,
          scheduled_at: args.scheduled_at,
          published_url: args.published_url,
        })

        const piece = await data.updateContent(args.id, updates)
        if (!piece) return errorResult(`Content piece not found: ${args.id}`)

        // Auto-create Mark drafting task when content is approved
        if (args.status === 'approved' && piece) {
          const sourceInfo = piece.source_material?.[0]
          const description = [
            `Draft content based on: "${piece.title}"`,
            sourceInfo ? `\nSource: ${sourceInfo.url}` : '',
            sourceInfo?.summary ? `\nSummary: ${sourceInfo.summary}` : '',
            args.body ? `\nNotes: ${args.body}` : '',
          ].filter(Boolean).join('')

          await data.createTask({
            title: `Draft: ${piece.title.slice(0, 80)}`,
            description,
            domain: piece.domain,
            status: 'todo',
            task_type: 'standard',
            priority: 2,
            assignee: 'mark',
          }).catch(() => {}) // Best-effort — don't fail the status update
        }

        const msg = args.status === 'approved'
          ? `Content "${piece.title}" approved. Drafting task created for Mark.`
          : `Content ${args.id} updated.`
        return {
          content: [{
            type: 'text' as const,
            text: msg,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const manageTopics = tool(
    'manage_topics',
    'List, create, or update content topics. Use action param to choose operation.',
    {
      action: z.enum(['list', 'create', 'update']).describe('Operation to perform'),
      domain: z.string().optional().describe('Domain slug (required for create, optional filter for list)'),
      name: z.string().optional().describe('Topic name (for create)'),
      description: z.string().optional().describe('Topic description (for create/update)'),
      id: z.string().optional().describe('Topic ID (for update)'),
      active: z.boolean().optional().describe('Active status (for update)'),
    },
    async (args) => {
      try {
        switch (args.action) {
          case 'list': {
            const topics = await data.listTopics({ domain: args.domain })
            return {
              content: [{
                type: 'text' as const,
                text: topics.length === 0
                  ? 'No topics found.'
                  : truncatedJson(topics),
              }],
            }
          }
          case 'create': {
            if (!args.domain) return errorResult('domain is required for create')
            if (!args.name) return errorResult('name is required for create')
            const topic = await data.createTopic({
              domain: args.domain,
              name: args.name,
              description: args.description,
            })
            return {
              content: [{
                type: 'text' as const,
                text: `Topic created: "${topic.name}" (id: ${topic.id})`,
              }],
            }
          }
          case 'update': {
            if (!args.id) return errorResult('id is required for update')
            const updates = stripUndefined({
              name: args.name,
              description: args.description,
              active: args.active,
            })
            const updated = await data.updateTopic(args.id, updates)
            if (!updated) return errorResult(`Topic not found: ${args.id}`)
            return {
              content: [{
                type: 'text' as const,
                text: `Topic updated: "${updated.name}" (active: ${updated.active})`,
              }],
            }
          }
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const manageContentSources = tool(
    'manage_content_sources',
    'List, create, or update content sources (RSS feeds, YouTube channels, newsletters, etc.).',
    {
      action: z.enum(['list', 'create', 'update']).describe('Operation to perform'),
      domain: z.string().optional().describe('Domain slug (required for create, optional filter for list)'),
      name: z.string().optional().describe('Source name (for create)'),
      url: z.string().optional().describe('Source URL (for create)'),
      type: z.enum(['rss', 'youtube', 'newsletter', 'manual']).optional().describe('Source type (for create)'),
      id: z.string().optional().describe('Source ID (for update)'),
      active: z.boolean().optional().describe('Active status (for update)'),
    },
    async (args) => {
      try {
        switch (args.action) {
          case 'list': {
            const filters: { domain?: string; type?: ContentSourceType } = {}
            if (args.domain) filters.domain = args.domain
            if (args.type) filters.type = args.type as ContentSourceType
            const sources = await data.listContentSources(filters)
            return {
              content: [{
                type: 'text' as const,
                text: sources.length === 0
                  ? 'No content sources found.'
                  : truncatedJson(sources),
              }],
            }
          }
          case 'create': {
            if (!args.domain) return errorResult('domain is required for create')
            if (!args.name) return errorResult('name is required for create')
            const source = await data.createContentSource({
              domain: args.domain,
              name: args.name,
              type: args.type as ContentSourceType | undefined,
              url: args.url,
            })
            return {
              content: [{
                type: 'text' as const,
                text: `Content source created: "${source.name}" (id: ${source.id}, type: ${source.type})`,
              }],
            }
          }
          case 'update': {
            if (!args.id) return errorResult('id is required for update')
            const updates = stripUndefined({
              name: args.name,
              url: args.url,
              active: args.active,
            })
            const updated = await data.updateContentSource(args.id, updates)
            if (!updated) return errorResult(`Content source not found: ${args.id}`)
            return {
              content: [{
                type: 'text' as const,
                text: `Content source updated: "${updated.name}" (active: ${updated.active})`,
              }],
            }
          }
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const reviewContentRadar = tool(
    'review_content_radar',
    'Quick view of latest content radar — shows recent ideas with title, source, and topic.',
    {
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    async (args) => {
      try {
        const ideas = await data.listContent({ status: 'idea', limit: args.limit ?? 20 })
        if (ideas.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Content radar is empty — no ideas in the pipeline.',
            }],
          }
        }

        const lines = ideas.map((idea, i) => {
          const source = idea.source_material?.[0]
          const sourceInfo = source ? ` | source: ${source.title || source.url}` : ''
          const topicInfo = idea.topic_id ? ` | topic: ${idea.topic_id}` : ''
          return `${i + 1}. ${idea.title}${sourceInfo}${topicInfo}`
        })

        return {
          content: [{
            type: 'text' as const,
            text: `Content Radar (${ideas.length} ideas):\n\n${lines.join('\n')}`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  // ─── Utility Tools ─────────────────────────────────────────────────────────

  const getCurrentTime = tool(
    'get_current_time',
    'Get the current time in CST (Central Standard Time).',
    {},
    async () => {
      const now = new Date()
      const cst = now.toLocaleString('en-US', { timeZone: 'America/Chicago' })
      const day = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' })
      return {
        content: [{
          type: 'text' as const,
          text: `${day}, ${cst} CST`,
        }],
      }
    }
  )

  // ─── MCP Management Tools ───────────────────────────────────────────────

  const listAvailableMcpServers = tool(
    'list_available_mcp_servers',
    'List MCP servers available for auto-install. Optionally filter by a capability description to find relevant servers.',
    {
      query: z.string().optional().describe('Capability description to match against (e.g. "search the web", "manage github issues")'),
    },
    async (args) => {
      if (args.query) {
        const matches = findMatchingServers(args.query)
        if (matches.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No MCP servers found matching "${args.query}".\n\nAll available servers:\n${Object.entries(MCP_REGISTRY).map(([id, e]) => `  ${id}: ${e.description}`).join('\n')}`,
            }],
          }
        }
        return {
          content: [{
            type: 'text' as const,
            text: matches.map(e => {
              const envNote = e.requiredEnvVars.length > 0
                ? `\n    Required env vars: ${e.requiredEnvVars.join(', ')}`
                : ''
              const configNote = e.needsUserConfig ? '\n    Needs user configuration (paths, etc.)' : ''
              return `  ${e.name} (${e.package})${envNote}${configNote}\n    ${e.description}`
            }).join('\n\n'),
          }],
        }
      }

      const lines = Object.entries(MCP_REGISTRY).map(([id, entry]) => {
        const envNote = entry.requiredEnvVars.length > 0
          ? ` [requires: ${entry.requiredEnvVars.join(', ')}]`
          : ''
        return `  ${id}: ${entry.description}${envNote}`
      })
      return {
        content: [{
          type: 'text' as const,
          text: `Available MCP servers:\n${lines.join('\n')}`,
        }],
      }
    }
  )

  const installMcpServer = tool(
    'install_mcp_server',
    'Install an MCP server from the registry into mcp.json. The server will be available after the next session restart. For servers that need env vars, set them in ~/.hughmann/.env first.',
    {
      server_id: z.string().describe('Registry ID of the server to install (e.g. "github", "fetch", "brave-search")'),
      env: z.record(z.string(), z.string()).optional().describe('Environment variables to set for this server'),
      args: z.array(z.string()).optional().describe('Override default args (e.g. file paths for filesystem server)'),
    },
    async (args) => {
      if (!hughmannHome) return errorResult('HughMann home directory not configured')

      const entry = MCP_REGISTRY[args.server_id]
      if (!entry) {
        return errorResult(`Unknown server "${args.server_id}". Use list_available_mcp_servers to see options.`)
      }

      // Check required env vars
      const missingVars = entry.requiredEnvVars.filter(v => !process.env[v] && !args.env?.[v])
      if (missingVars.length > 0) {
        return errorResult(
          `Missing required environment variables for ${entry.name}: ${missingVars.join(', ')}\n` +
          `Set them in ~/.hughmann/.env or pass them via the env parameter.`
        )
      }

      const serverArgs = args.args ?? (entry.defaultArgs ? ['-y', entry.package, ...entry.defaultArgs] : ['-y', entry.package])
      const finalArgs = serverArgs.includes(entry.package) ? serverArgs : ['-y', entry.package, ...serverArgs]

      const config: { command: string; args: string[]; env?: Record<string, string> } = {
        command: 'npx',
        args: finalArgs,
      }

      if (args.env && Object.keys(args.env).length > 0) {
        config.env = args.env as Record<string, string>
      }

      const added = addMcpServer(hughmannHome, args.server_id, config)
      if (!added) {
        return errorResult(`MCP server "${args.server_id}" is already installed.`)
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Installed MCP server: ${entry.name} (${entry.package})\n` +
            `Config written to mcp.json.\n` +
            `The server will be available after restarting the session.` +
            (entry.needsUserConfig ? `\n\nNote: This server may need additional configuration (e.g. file paths). Check the args in mcp.json.` : ''),
        }],
      }
    }
  )

  const uninstallMcpServer = tool(
    'uninstall_mcp_server',
    'Remove an MCP server from mcp.json.',
    {
      server_name: z.string().describe('Name of the server to remove from mcp.json'),
    },
    async (args) => {
      if (!hughmannHome) return errorResult('HughMann home directory not configured')
      const removed = removeMcpServer(hughmannHome, args.server_name)
      if (!removed) return errorResult(`MCP server "${args.server_name}" not found in mcp.json.`)
      return {
        content: [{
          type: 'text' as const,
          text: `Removed MCP server "${args.server_name}" from mcp.json.`,
        }],
      }
    }
  )

  // ─── Feedback Tools ────────────────────────────────────────────────────

  const recordFeedback = tool(
    'record_feedback',
    'Record user feedback on a suggestion, task output, or skill result. Use this when the user explicitly approves, rejects, or corrects something Hugh said or did.',
    {
      category: z.string().describe('Category: task, suggestion, skill, memory, planning'),
      signal: z.string().describe('Signal: positive (accepted/liked), negative (rejected/disliked), correction (user fixed something)'),
      content: z.string().describe('What was the feedback about — summarize the item that received feedback'),
      context: z.string().optional().describe('Additional context about what happened'),
      domain: z.string().optional().describe('Domain slug if relevant'),
    },
    async (args) => {
      try {
        await data.saveFeedback({
          category: args.category,
          signal: args.signal as 'positive' | 'negative' | 'correction',
          content: args.content,
          context: args.context,
          domain: args.domain,
        })
        return {
          content: [{
            type: 'text' as const,
            text: `Feedback recorded: ${args.signal} on ${args.category}`,
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const getFeedbackSummary = tool(
    'get_feedback_summary',
    'Get a summary of recent feedback patterns to understand what is working well and what needs improvement.',
    {
      domain: z.string().optional().describe('Filter by domain'),
      category: z.string().optional().describe('Filter by category'),
      days: z.number().optional().describe('Look back this many days (default: 30)'),
    },
    async (args) => {
      try {
        const since = new Date()
        since.setDate(since.getDate() - (args.days ?? 30))

        const feedback = await data.getFeedbackPatterns({
          domain: args.domain,
          category: args.category,
          since: since.toISOString(),
          limit: 100,
        })

        if (feedback.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No feedback recorded yet.',
            }],
          }
        }

        // Aggregate by category and signal
        const byCategory: Record<string, { positive: number; negative: number; correction: number; items: string[] }> = {}
        for (const f of feedback) {
          if (!byCategory[f.category]) {
            byCategory[f.category] = { positive: 0, negative: 0, correction: 0, items: [] }
          }
          const cat = byCategory[f.category]
          if (f.signal === 'positive') cat.positive++
          else if (f.signal === 'negative') cat.negative++
          else if (f.signal === 'correction') cat.correction++

          if (f.signal !== 'positive' && cat.items.length < 5) {
            cat.items.push(f.content)
          }
        }

        const lines: string[] = [`## Feedback Summary (last ${args.days ?? 30} days, ${feedback.length} entries)\n`]
        for (const [category, counts] of Object.entries(byCategory)) {
          const total = counts.positive + counts.negative + counts.correction
          const successRate = total > 0 ? Math.round((counts.positive / total) * 100) : 0
          lines.push(`### ${category} (${successRate}% positive)`)
          lines.push(`  +${counts.positive} positive | -${counts.negative} negative | ~${counts.correction} corrections`)
          if (counts.items.length > 0) {
            lines.push(`  Recent issues:`)
            for (const item of counts.items) {
              lines.push(`    - ${item.slice(0, 100)}`)
            }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const toolList = [
    // Tasks
    listTasks, createTask, updateTask, completeTask,
    // Projects
    listProjects, createProject, updateProject, registerProject, provisionProject,
    // Approval Bundles
    createApprovalBundle, listApprovalBundles, resolveApprovalBundle,
    // Planning
    getPlanningContext, capturePlanningSummary,
    // Briefings
    saveBriefing, getLatestBriefing,
    // Advisors
    listAdvisors, getAdvisorPrompt,
    // Context
    updateMasterPlanSection,
    // Knowledge Base
    searchKnowledgeBase, browseKnowledgeBase,
    // MCP management
    listAvailableMcpServers, installMcpServer, uninstallMcpServer,
    // Domain Goals
    listDomainGoals, updateDomainGoal,
    // Feedback
    recordFeedback, getFeedbackSummary,
    // Content
    listContent, createContent, updateContent, manageTopics, manageContentSources, reviewContentRadar,
    // Utility
    getCurrentTime,
  ]

  // Return a factory that creates a fresh MCP server per query() call.
  // The Agent SDK calls connect() on each server, so reusing a single
  // instance across calls causes "Already connected to a transport" errors.
  return () => createSdkMcpServer({
    name: 'hughmann',
    version: '0.4.0',
    tools: toolList,
  })
}
