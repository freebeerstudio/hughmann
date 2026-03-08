/**
 * Unified Task Executor — shared execution pipeline for daemon and cloud.
 *
 * Encapsulates the common flow:
 * 1. Build task prompt with project context and memories
 * 2. Execute via runtime (local) or model adapter (cloud)
 * 3. Handle success/failure with progress tracking and gap analysis
 *
 * Both the daemon and Trigger.dev tasks use this to avoid duplication.
 */

import type { DataAdapter } from '../adapters/data/types.js'
import type { Task } from '../types/tasks.js'
import type { Skill } from './skills.js'

/**
 * Build a rich prompt for task execution.
 * Includes project context (North Star, guardrails) and relevant memories.
 */
export async function buildTaskPrompt(
  task: Task,
  data?: DataAdapter,
  searchMemory?: (query: string, opts: { limit: number }) => Promise<{ content: string }[]>,
): Promise<string> {
  let prompt = `Execute the following task:\n\n**Title**: ${task.title}\n`
  if (task.description) prompt += `**Description**: ${task.description}\n`
  if (task.project_id) prompt += `**Project**: ${task.project_id}\n`
  if (task.domain) prompt += `**Domain**: ${task.domain}\n`
  if (task.due_date) prompt += `**Due**: ${task.due_date}\n`
  if (task.sprint) prompt += `**Sprint**: ${task.sprint}\n`

  // Load project context if task has a project_id
  if (task.project_id && data) {
    try {
      const project = await data.getProject(task.project_id)
      if (project) {
        prompt += `\n**Project Context**:\n`
        prompt += `  Name: ${project.name}\n`
        if (project.north_star) prompt += `  North Star: ${project.north_star}\n`
        if (project.guardrails && project.guardrails.length > 0) {
          prompt += `  Guardrails:\n`
          for (const g of project.guardrails) {
            prompt += `    - ${g}\n`
          }
        }
      }
    } catch {
      // Best-effort — don't block task execution
    }
  }

  // Search semantic memory for task relevance
  if (searchMemory) {
    try {
      const memories = await searchMemory(task.title, { limit: 3 })
      if (memories.length > 0) {
        prompt += `\n**Relevant Memories**:\n`
        for (const m of memories) {
          const truncated = m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content
          prompt += `- ${truncated}\n`
        }
      }
    } catch {
      // Best-effort
    }
  }

  prompt += `\nComplete this task thoroughly. When done, provide a summary of what was accomplished.`
  return prompt
}

/**
 * Build a system prompt for an agent persona executing a task.
 * Combines the agent's persona prompt with the base system prompt.
 */
export function buildAgentSystemPrompt(
  agentSkill: Skill,
  baseSystemPrompt: string,
): string {
  return `${agentSkill.prompt}\n\n---\n\n${baseSystemPrompt}`
}

/** Priority selection — sort tasks by priority, type weight, and creation time */
export function selectBestTask(tasks: Task[]): Task | null {
  if (tasks.length === 0) return null

  const typeWeight: Record<string, number> = { must: 0, mit: 1, big_rock: 2, standard: 3 }
  const sorted = [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const wa = typeWeight[a.task_type] ?? 3
    const wb = typeWeight[b.task_type] ?? 3
    if (wa !== wb) return wa - wb
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  return sorted[0]
}

export interface TaskResult {
  success: boolean
  summary: string
  durationMs: number
  error?: string
}

/**
 * Record task completion or failure to the data adapter and optionally
 * trigger gap analysis.
 */
export async function recordTaskResult(
  task: Task,
  result: TaskResult,
  data: DataAdapter,
): Promise<void> {
  if (result.success) {
    await data.completeTask(task.id, result.summary || 'Task completed')
  } else {
    await data.updateTask(task.id, { status: 'blocked' })

    // Record gap for self-improvement
    try {
      const { analyzeGapFromFailure } = await import('./gap-analyzer.js')
      await analyzeGapFromFailure(task, result.error ?? 'Unknown error', data)
    } catch {
      // Best-effort
    }
  }
}
