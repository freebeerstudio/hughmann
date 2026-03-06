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
import { MCP_REGISTRY, findMatchingServers } from '../runtime/mcp-registry.js'
import { addMcpServer, removeMcpServer } from '../runtime/mcp-config.js'

/** Helper to create an error tool response instead of throwing */
function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  }
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
      task_type: z.string().optional().describe('Comma-separated types: MUST, MIT, BIG_ROCK, STANDARD'),
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
        if (args.project) filters.project = args.project
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
      task_type: z.string().optional().describe('Type: MUST, MIT, BIG_ROCK, STANDARD (default: STANDARD)'),
      domain: z.string().optional().describe('Domain slug (omnissa, fbs, personal)'),
      project: z.string().optional().describe('Project name'),
      project_id: z.string().optional().describe('UUID of the project this task belongs to'),
      priority: z.number().optional().describe('Priority 0-5, lower is higher (default: 3)'),
      due_date: z.string().optional().describe('Due date (ISO 8601 or YYYY-MM-DD)'),
      cwd: z.string().optional().describe('Working directory for file-based tasks'),
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
      task_type: z.string().optional().describe('New type: MUST, MIT, BIG_ROCK, STANDARD'),
      domain: z.string().optional().describe('New domain'),
      project: z.string().optional().describe('New project'),
      project_id: z.string().optional().describe('UUID of the project'),
      priority: z.number().optional().describe('New priority 0-5'),
      due_date: z.string().optional().describe('New due date'),
      cwd: z.string().optional().describe('New working directory'),
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
    'List projects from the database. Filter by domain and/or status. Returns project details including goals, milestones, and task counts.',
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

        return {
          content: [{
            type: 'text' as const,
            text: truncatedJson(projects),
          }],
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  const createProject = tool(
    'create_project',
    'Create a new project with name, domain, description, goals, milestones, and quarterly goal.',
    {
      name: z.string().describe('Project name (required)'),
      slug: z.string().optional().describe('URL-friendly slug (auto-generated from name if omitted)'),
      description: z.string().optional().describe('What this project is about'),
      domain: z.string().optional().describe('Domain slug (omnissa, fbs, personal)'),
      status: z.string().optional().describe('Status: planning, active, paused, completed, archived (default: planning)'),
      goals: z.array(z.string()).optional().describe('Project goals as an array of strings'),
      quarterly_goal: z.string().optional().describe('Which quarterly goal this project supports'),
      milestones: z.array(z.object({
        title: z.string(),
        target_date: z.string().optional(),
      })).optional().describe('Project milestones with titles and optional target dates'),
      priority: z.number().optional().describe('Priority 0-5 (default: 3)'),
    },
    async (args) => {
      try {
        const clean = stripUndefined(args)
        const input = {
          ...clean,
          milestones: args.milestones?.map(m => ({ title: m.title, target_date: m.target_date ?? null })),
        }
        const project = await data.createProject(input as Parameters<typeof data.createProject>[0])
        return {
          content: [{
            type: 'text' as const,
            text: `Created project: "${project.name}" (${project.id})\nSlug: ${project.slug} | Domain: ${project.domain ?? 'none'} | Status: ${project.status}` +
              (project.goals.length > 0 ? `\nGoals:\n${project.goals.map(g => `  - ${g}`).join('\n')}` : '') +
              (project.milestones.length > 0 ? `\nMilestones:\n${project.milestones.map(m => `  - ${m.title}${m.target_date ? ` (by ${m.target_date})` : ''}`).join('\n')}` : ''),
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
      goals: z.array(z.string()).optional().describe('Updated goals array'),
      quarterly_goal: z.string().optional().describe('Updated quarterly goal'),
      milestones: z.array(z.object({
        id: z.string(),
        title: z.string(),
        target_date: z.string().optional(),
        completed: z.boolean(),
        completed_at: z.string().optional(),
      })).optional().describe('Updated milestones array'),
      priority: z.number().optional().describe('New priority 0-5'),
    },
    async (args) => {
      try {
        const { project_id, milestones, ...rest } = args
        const updates: Record<string, unknown> = stripUndefined(rest)
        if (milestones) {
          updates.milestones = milestones.map(m => ({
            ...m,
            target_date: m.target_date ?? null,
            completed_at: m.completed_at ?? null,
          }))
        }
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

  // ─── Planning Tools ────────────────────────────────────────────────────────

  const getPlanningContext = tool(
    'get_planning_context',
    'Assembles a full planning briefing: active projects, open tasks, stale projects, domains with no projects, quarterly gap analysis, open questions from last planning session, and recent decisions. Call this at the start of a /focus planning session.',
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
            const taskCount = (await data.listTasks({ project: p.name })).length
            const openMilestones = p.milestones.filter(m => !m.completed)
            briefing.push(`### ${p.name} [${p.status}] (${p.domain ?? 'no domain'})`)
            if (p.quarterly_goal) briefing.push(`  Quarterly goal: ${p.quarterly_goal}`)
            if (p.goals.length > 0) briefing.push(`  Goals: ${p.goals.join('; ')}`)
            briefing.push(`  Tasks: ${taskCount} | Open milestones: ${openMilestones.length}`)
            if (openMilestones.length > 0) {
              briefing.push(`  Next milestones: ${openMilestones.slice(0, 3).map(m => m.title).join(', ')}`)
            }

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
          if (lastSession.open_questions.length > 0) {
            briefing.push(`Open questions:`)
            for (const q of lastSession.open_questions) {
              briefing.push(`  - ${q}`)
            }
          }
          if (lastSession.next_steps.length > 0) {
            briefing.push(`Next steps:`)
            for (const s of lastSession.next_steps) {
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

        // 6. Self-improvement gaps
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

  return createSdkMcpServer({
    name: 'hughmann',
    version: '0.3.0',
    tools: [
      // Tasks
      listTasks, createTask, updateTask, completeTask,
      // Projects
      listProjects, createProject, updateProject,
      // Planning
      getPlanningContext, capturePlanningSummary,
      // Context
      updateMasterPlanSection,
      // MCP management
      listAvailableMcpServers, installMcpServer, uninstallMcpServer,
      // Utility
      getCurrentTime,
    ],
  })
}
