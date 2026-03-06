/**
 * Welcome Briefing — generates a concise "welcome back" message on login.
 *
 * Assembles context from recent memories, system changelog, and task state,
 * then uses Haiku to synthesize a natural greeting for the owner.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Runtime } from './runtime.js'
import { HUGHMANN_HOME } from '../config.js'

const CHANGELOG_PATH = join(HUGHMANN_HOME, 'changelog.md')

const WELCOME_PROMPT = `You are Hugh Mann, a personal AI assistant. Generate a brief, warm welcome-back message for your owner Wayne.

Your message should be concise (8-15 lines max) and cover:

1. **Last session recap** — If memories from the last session are provided, give a 2-3 sentence summary of what was discussed/accomplished. If no memories exist, skip this section.

2. **System improvements** — If changelog entries are provided, briefly mention what's new and how Wayne can use the new capabilities. Be specific — mention actual commands or features. If no changes, skip this section.

3. **Current state** — If there are active tasks or notable items, mention 1-2 highlights. If nothing notable, skip.

Style rules:
- Be direct and natural — Wayne values efficiency
- Use bullet points, not paragraphs
- Don't be sycophantic or overly enthusiastic
- Don't repeat information verbatim — synthesize it
- If there's truly nothing to report, just say a brief hello and ask what Wayne wants to work on
- Never make up information — only reference what's provided in the context below`

/**
 * Generate a welcome briefing using Haiku.
 * Returns null if no model is available or nothing to report.
 */
export async function generateWelcomeBriefing(runtime: Runtime): Promise<string | null> {
  const model = runtime.memory.getDistillModel()
  if (!model) return null

  const sections: string[] = []

  // 1. Recent memories (last session's distillation)
  try {
    const memories = await runtime.memory.getRecentMemories(1, null)
    if (memories && memories.trim().length > 0) {
      sections.push(`## Last Session Memories\n\n${memories}`)
    }
  } catch {
    // Best-effort
  }

  // 2. System changelog
  try {
    const changelog = readChangelog()
    if (changelog) {
      sections.push(`## Recent System Changes\n\n${changelog}`)
    }
  } catch {
    // Best-effort
  }

  // 3. Task/project state
  if (runtime.data) {
    try {
      const [tasks, projects] = await Promise.all([
        runtime.data.listTasks({ status: ['todo', 'in_progress', 'blocked'], limit: 5 }),
        runtime.data.listProjects({ status: ['active'] }),
      ])

      const items: string[] = []
      if (tasks.length > 0) {
        const blocked = tasks.filter(t => t.status === 'blocked')
        const inProgress = tasks.filter(t => t.status === 'in_progress')
        const todo = tasks.filter(t => t.status === 'todo')
        if (blocked.length > 0) items.push(`${blocked.length} blocked task(s): ${blocked.map(t => t.title).join(', ')}`)
        if (inProgress.length > 0) items.push(`${inProgress.length} in progress: ${inProgress.map(t => t.title).join(', ')}`)
        if (todo.length > 0) items.push(`${todo.length} queued`)
      }
      if (projects.length > 0) {
        items.push(`${projects.length} active project(s): ${projects.map(p => p.name).join(', ')}`)
      }
      if (items.length > 0) {
        sections.push(`## Current State\n\n${items.map(i => `- ${i}`).join('\n')}`)
      }
    } catch {
      // Best-effort
    }
  }

  // If nothing to report, return a minimal greeting
  if (sections.length === 0) return null

  const context = sections.join('\n\n')

  try {
    const response = await model.complete(
      [{ role: 'user', content: context }],
      WELCOME_PROMPT,
      { model: 'claude-haiku-4-5-20251001' },
    )
    return response.content.trim() || null
  } catch {
    return null
  }
}

/**
 * Read changelog entries from the last 30 days.
 * Returns formatted text or null if no recent changes.
 */
function readChangelog(): string | null {
  if (!existsSync(CHANGELOG_PATH)) return null

  const content = readFileSync(CHANGELOG_PATH, 'utf-8')
  if (!content.trim()) return null

  // Parse entries and filter to last 30 days
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const entries: string[] = []
  const entryPattern = /^### (\d{4}-\d{2}-\d{2})/gm
  let match: RegExpExecArray | null

  // Find all dated sections
  const positions: { date: string; start: number }[] = []
  while ((match = entryPattern.exec(content)) !== null) {
    positions.push({ date: match[1], start: match.index })
  }

  for (let i = 0; i < positions.length; i++) {
    const { date, start } = positions[i]
    if (new Date(date) < cutoff) continue

    const end = i + 1 < positions.length ? positions[i + 1].start : content.length
    entries.push(content.slice(start, end).trim())
  }

  return entries.length > 0 ? entries.join('\n\n') : null
}
