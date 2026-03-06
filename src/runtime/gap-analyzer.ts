/**
 * Gap Analyzer — Permanent self-improvement for HughMann.
 *
 * Three channels detect capability gaps:
 * 1. Post-distillation: Analyze conversation logs for gaps (LLM call)
 * 2. Daemon failures: Auto-create improvement tasks (no LLM needed)
 * 3. Focus sessions: Surface accumulated gaps for discussion
 */

import type { ModelAdapter } from '../types/adapters.js'
import type { DataAdapter } from '../adapters/data/types.js'
import type { Task } from '../types/tasks.js'
import { findMatchingServers } from './mcp-registry.js'

const SELF_IMPROVEMENT_SLUG = 'self-improvement'

interface Gap {
  title: string
  description: string
  severity: 'critical' | 'moderate' | 'minor'
}

const GAP_EXTRACTION_PROMPT = `You are analyzing a distilled conversation summary for capability gaps.

A "capability gap" is something the AI assistant (Hugh) could not do, did poorly, or where the user had to correct or work around a limitation.

Examples:
- Could not access a tool or API the user needed
- Gave incorrect information that had to be corrected
- Failed to understand a request or context
- Missing knowledge about a system or workflow the user relies on
- Slow or inefficient at a task that should be routine

Extract gaps as a JSON array. If no gaps are found, return an empty array [].

Format:
[{ "title": "short description", "description": "what happened and why it's a gap", "severity": "critical|moderate|minor" }]

Only return the JSON array, nothing else.`

/**
 * Analyze distilled conversation text for capability gaps.
 * Creates backlog tasks on the self-improvement project.
 */
export async function analyzeGapsFromDistillation(
  distillResult: string,
  modelAdapter: ModelAdapter,
  dataAdapter: DataAdapter,
): Promise<void> {
  // Get or skip if no self-improvement project
  const project = await dataAdapter.getProjectBySlug(SELF_IMPROVEMENT_SLUG)
  if (!project) return

  // Ask haiku to extract gaps
  const response = await modelAdapter.complete(
    [{ role: 'user', content: `Distilled conversation:\n\n${distillResult}` }],
    GAP_EXTRACTION_PROMPT,
    { model: 'claude-haiku-4-5-20251001' },
  )

  let gaps: Gap[]
  try {
    const jsonMatch = response.content.match(/\[[\s\S]*\]/)
    gaps = jsonMatch ? JSON.parse(jsonMatch[0]) : []
  } catch {
    return // Malformed JSON — skip silently
  }

  if (gaps.length === 0) return

  // Load existing tasks for deduplication
  const existing = await dataAdapter.listTasks({ project: project.name, status: ['backlog', 'todo', 'in_progress'] })

  for (const gap of gaps) {
    if (isDuplicate(gap.title, existing)) continue

    const priority = gap.severity === 'critical' ? 1 : gap.severity === 'moderate' ? 3 : 4

    await dataAdapter.createTask({
      title: gap.title,
      description: gap.description,
      status: 'backlog',
      task_type: 'STANDARD',
      domain: 'personal',
      project: project.name,
      project_id: project.id,
      priority,
    })
  }
}

/**
 * Create an improvement task from a daemon task failure.
 * No LLM call — the failure itself is the signal.
 */
export async function analyzeGapFromFailure(
  task: Task,
  errorMessage: string,
  dataAdapter: DataAdapter,
): Promise<void> {
  const project = await dataAdapter.getProjectBySlug(SELF_IMPROVEMENT_SLUG)
  if (!project) return

  const title = `Investigate failure: ${task.title}`

  // Prevent recursive loops — don't create failure tasks for failure tasks
  const existing = await dataAdapter.listTasks({ project: project.name, status: ['backlog', 'todo', 'in_progress'] })
  if (isDuplicate(title, existing)) return

  // Check if failure matches a known MCP server capability
  const searchText = `${task.title} ${task.description ?? ''} ${errorMessage}`
  const matchedServers = findMatchingServers(searchText)
  const mcpSuggestion = matchedServers.length > 0
    ? `\n\nSuggested MCP server: **${matchedServers[0].name}** (${matchedServers[0].package})\n` +
      `Use the install_mcp_server tool with server_id to install it.`
    : ''

  await dataAdapter.createTask({
    title,
    description: `Daemon task "${task.title}" (${task.id}) failed with:\n\n${errorMessage}\n\nInvestigate root cause and determine if Hugh needs a capability improvement.${mcpSuggestion}`,
    status: 'backlog',
    task_type: 'STANDARD',
    domain: 'personal',
    project: project.name,
    project_id: project.id,
    priority: 3,
  })
}

/**
 * Build a summary of self-improvement gaps for /focus sessions.
 * Returns formatted markdown or null if no gaps exist.
 */
export async function getGapSummaryForFocus(
  dataAdapter: DataAdapter,
): Promise<string | null> {
  const project = await dataAdapter.getProjectBySlug(SELF_IMPROVEMENT_SLUG)
  if (!project) return null

  const tasks = await dataAdapter.listTasks({
    project: project.name,
    status: ['backlog', 'todo', 'in_progress'],
  })

  if (tasks.length === 0) return null

  const active = tasks.filter(t => t.status === 'in_progress' || t.status === 'todo')
  const backlog = tasks.filter(t => t.status === 'backlog')

  const lines: string[] = ['## Self-Improvement Gaps']

  if (active.length > 0) {
    lines.push(`### Active (${active.length})`)
    for (const t of active) {
      lines.push(`- [${t.status}] **${t.title}** (P${t.priority})`)
    }
  }

  if (backlog.length > 0) {
    lines.push(`### Backlog (${backlog.length})`)
    for (const t of backlog.slice(0, 5)) {
      lines.push(`- **${t.title}** (P${t.priority})${t.description ? ` — ${t.description.slice(0, 80)}` : ''}`)
    }
    if (backlog.length > 5) {
      lines.push(`- ... and ${backlog.length - 5} more`)
    }
  }

  lines.push('')
  lines.push('*Review these gaps — any worth promoting to active? Any to dismiss?*')

  return lines.join('\n')
}

/**
 * Check if a gap title is a duplicate of an existing task.
 * Uses substring match + word overlap to catch variations.
 */
export function isDuplicate(title: string, existing: Task[]): boolean {
  const normalizedTitle = title.toLowerCase()
  const titleWords = new Set(normalizedTitle.split(/\s+/).filter(w => w.length > 3))

  for (const task of existing) {
    const existingTitle = task.title.toLowerCase()

    // Substring match (catches "Investigate failure: X" nested in "Investigate failure: Investigate failure: X")
    if (existingTitle.includes(normalizedTitle) || normalizedTitle.includes(existingTitle)) {
      return true
    }

    // Word overlap — if >60% of words match, it's likely a duplicate
    const existingWords = new Set(existingTitle.split(/\s+/).filter(w => w.length > 3))
    if (titleWords.size === 0 || existingWords.size === 0) continue
    const overlap = [...titleWords].filter(w => existingWords.has(w)).length
    const overlapRatio = overlap / Math.min(titleWords.size, existingWords.size)
    if (overlapRatio > 0.6) return true
  }

  return false
}
