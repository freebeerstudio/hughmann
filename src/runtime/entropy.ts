/**
 * Entropy Prevention — identifies and cleans up stale state.
 *
 * Surfaces:
 *  - Backlog tasks untouched for 30+ days
 *  - Context docs with mtime > 30 days
 *  - Orphaned sessions (>90 days, ≤1 message)
 *
 * Usage: `hughmann entropy` (dry run) / `hughmann entropy --apply`
 */

import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { DataAdapter } from '../adapters/data/types.js'

const STALE_TASK_DAYS = 30
const STALE_DOC_DAYS = 30
const ORPHAN_SESSION_DAYS = 90

export interface EntropyReport {
  staleTasks: { id: string; title: string; daysSinceUpdate: number }[]
  staleDocs: { path: string; daysSinceModified: number }[]
  orphanedSessions: { id: string; title: string; daysSinceCreation: number }[]
  applied: boolean
}

/**
 * Find backlog tasks that haven't been updated in 30+ days.
 * If not dryRun, marks them as done with a note.
 */
export async function pruneStaleBacklog(
  data: DataAdapter,
  dryRun: boolean = true,
): Promise<EntropyReport['staleTasks']> {
  const tasks = await data.listTasks({ status: 'backlog', limit: 200 })
  const now = Date.now()
  const stale: EntropyReport['staleTasks'] = []

  for (const task of tasks) {
    const updatedAt = new Date(task.updated_at).getTime()
    const daysSinceUpdate = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24))

    if (daysSinceUpdate >= STALE_TASK_DAYS) {
      stale.push({ id: task.id, title: task.title, daysSinceUpdate })

      if (!dryRun) {
        await data.completeTask(task.id, `Auto-closed: stale backlog (${daysSinceUpdate} days untouched)`)
      }
    }
  }

  return stale
}

/**
 * Walk the context directory and flag .md files with mtime > 30 days.
 */
export function findStaleContextDocs(contextDir: string): EntropyReport['staleDocs'] {
  const stale: EntropyReport['staleDocs'] = []
  const now = Date.now()

  function walk(dir: string): void {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) walk(fullPath)
      } else if (entry.name.endsWith('.md')) {
        try {
          const stat = statSync(fullPath)
          const days = Math.floor((now - stat.mtime.getTime()) / (1000 * 60 * 60 * 24))
          if (days >= STALE_DOC_DAYS) {
            stale.push({ path: relative(contextDir, fullPath), daysSinceModified: days })
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(contextDir)
  return stale
}

/**
 * Find sessions older than 90 days with 1 or fewer messages.
 */
export async function findOrphanedSessions(
  data: DataAdapter,
): Promise<EntropyReport['orphanedSessions']> {
  const sessions = await data.listSessions(200)
  const now = Date.now()
  const orphaned: EntropyReport['orphanedSessions'] = []

  for (const session of sessions) {
    const createdAt = new Date(session.created_at).getTime()
    const days = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24))

    if (days >= ORPHAN_SESSION_DAYS && session.message_count <= 1) {
      orphaned.push({ id: session.id, title: session.title, daysSinceCreation: days })
    }
  }

  return orphaned
}

/**
 * Run all entropy checks and return a report.
 */
export async function runEntropyCheck(
  contextDir: string,
  data?: DataAdapter,
  dryRun: boolean = true,
): Promise<EntropyReport> {
  const report: EntropyReport = {
    staleTasks: [],
    staleDocs: findStaleContextDocs(contextDir),
    orphanedSessions: [],
    applied: !dryRun,
  }

  if (data) {
    report.staleTasks = await pruneStaleBacklog(data, dryRun)
    report.orphanedSessions = await findOrphanedSessions(data)
  }

  return report
}
