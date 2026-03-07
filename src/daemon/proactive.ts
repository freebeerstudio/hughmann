/**
 * Proactive agent — Hugh initiates actions without being asked.
 *
 * Runs periodically from the daemon to check for:
 * - Tasks with upcoming deadlines (within 24 hours)
 * - Stale projects (no updates in 14+ days)
 * - Blocked tasks that may be unblockable
 * - Overdue tasks past their due date
 *
 * Generates nudge notifications written to the nudges log.
 * Notifications are injected into the next interactive session
 * via the welcome briefing.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DataAdapter } from '../adapters/data/types.js'

export interface Nudge {
  type: 'deadline' | 'overdue' | 'stale_project' | 'blocked' | 'idle'
  title: string
  detail: string
  priority: number
  timestamp: string
}

interface NudgeLog {
  nudges: Nudge[]
  lastCheck: string
}

const NUDGE_FILE = 'nudges.json'
const STALE_DAYS = 14
const DEADLINE_HOURS = 24

/**
 * Run all proactive checks and write nudges to disk.
 * Returns the nudges generated this cycle.
 */
export async function runProactiveChecks(
  data: DataAdapter,
  daemonDir: string,
): Promise<Nudge[]> {
  const nudges: Nudge[] = []
  const now = new Date()

  // 1. Check for overdue and upcoming-deadline tasks
  const openTasks = await data.listTasks({ status: ['todo', 'in_progress'] })
  for (const task of openTasks) {
    if (!task.due_date) continue
    const due = new Date(task.due_date)
    const hoursUntilDue = (due.getTime() - now.getTime()) / (1000 * 60 * 60)

    if (hoursUntilDue < 0) {
      nudges.push({
        type: 'overdue',
        title: `Overdue: ${task.title}`,
        detail: `Due ${task.due_date}, now ${Math.abs(Math.round(hoursUntilDue))} hours past deadline.`,
        priority: task.priority,
        timestamp: now.toISOString(),
      })
    } else if (hoursUntilDue <= DEADLINE_HOURS) {
      nudges.push({
        type: 'deadline',
        title: `Due soon: ${task.title}`,
        detail: `Due in ${Math.round(hoursUntilDue)} hours (${task.due_date}).`,
        priority: task.priority,
        timestamp: now.toISOString(),
      })
    }
  }

  // 2. Check for blocked tasks
  const blockedTasks = await data.listTasks({ status: ['blocked'] })
  if (blockedTasks.length > 0) {
    nudges.push({
      type: 'blocked',
      title: `${blockedTasks.length} blocked task${blockedTasks.length > 1 ? 's' : ''} need attention`,
      detail: blockedTasks.slice(0, 3).map(t => `- ${t.title}`).join('\n'),
      priority: 2,
      timestamp: now.toISOString(),
    })
  }

  // 3. Check for stale projects
  const activeProjects = await data.listProjects({ status: ['active', 'planning'] })
  for (const project of activeProjects) {
    const daysSinceUpdate = Math.floor(
      (now.getTime() - new Date(project.updated_at).getTime()) / (1000 * 60 * 60 * 24),
    )
    if (daysSinceUpdate >= STALE_DAYS) {
      nudges.push({
        type: 'stale_project',
        title: `Stale project: ${project.name}`,
        detail: `No updates in ${daysSinceUpdate} days. Consider updating status or pausing.`,
        priority: 4,
        timestamp: now.toISOString(),
      })
    }
  }

  // 4. Check for idle state (no tasks completed recently)
  const recentlyDone = await data.listTasks({ status: ['done'] })
  const doneLast48h = recentlyDone.filter(t => {
    if (!t.completed_at) return false
    const hoursAgo = (now.getTime() - new Date(t.completed_at).getTime()) / (1000 * 60 * 60)
    return hoursAgo <= 48
  })
  if (doneLast48h.length === 0 && openTasks.length > 0) {
    nudges.push({
      type: 'idle',
      title: 'No tasks completed in 48 hours',
      detail: `${openTasks.length} open task${openTasks.length > 1 ? 's' : ''} waiting. Pick one to get momentum!`,
      priority: 5,
      timestamp: now.toISOString(),
    })
  }

  // Write nudges to disk (replace previous)
  if (nudges.length > 0) {
    saveNudges(daemonDir, nudges)
  }

  return nudges
}

/**
 * Load and clear pending nudges. Called by welcome briefing to show
 * proactive notifications then remove them.
 */
export function consumeNudges(daemonDir: string): Nudge[] {
  const filePath = join(daemonDir, NUDGE_FILE)
  if (!existsSync(filePath)) return []

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as NudgeLog
    // Clear after reading
    writeFileSync(filePath, JSON.stringify({ nudges: [], lastCheck: raw.lastCheck }, null, 2), 'utf-8')
    return raw.nudges
  } catch {
    return []
  }
}

/**
 * Get nudge summary for display. Doesn't consume them.
 */
export function getNudgeSummary(daemonDir: string): string | null {
  const filePath = join(daemonDir, NUDGE_FILE)
  if (!existsSync(filePath)) return null

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as NudgeLog
    if (raw.nudges.length === 0) return null

    const sorted = raw.nudges.sort((a, b) => a.priority - b.priority)
    const lines = ['## Proactive Alerts']
    for (const nudge of sorted) {
      const icon = nudge.type === 'overdue' ? '!!'
        : nudge.type === 'deadline' ? '!'
        : nudge.type === 'blocked' ? '||'
        : nudge.type === 'stale_project' ? '~'
        : '...'
      lines.push(`[${icon}] ${nudge.title}`)
      lines.push(`    ${nudge.detail}`)
    }
    return lines.join('\n')
  } catch {
    return null
  }
}

function saveNudges(daemonDir: string, nudges: Nudge[]): void {
  const filePath = join(daemonDir, NUDGE_FILE)
  const log: NudgeLog = {
    nudges,
    lastCheck: new Date().toISOString(),
  }
  writeFileSync(filePath, JSON.stringify(log, null, 2), 'utf-8')
}
