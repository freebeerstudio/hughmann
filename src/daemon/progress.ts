/**
 * Structured progress log for daemon task execution.
 *
 * Maintains a JSON file at ~/.hughmann/daemon/progress.json that tracks
 * every task completion/failure with timestamps. Fresh agent sessions
 * read this to quickly orient without wasting context window on discovery.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface ProgressEntry {
  taskId: string
  title: string
  status: 'completed' | 'failed'
  timestamp: string
  durationMs?: number
  summary?: string
  error?: string
  domain?: string
  project?: string
}

export interface ProgressLog {
  version: 1
  lastUpdated: string
  entries: ProgressEntry[]
}

const MAX_ENTRIES = 200

export function loadProgress(daemonDir: string): ProgressLog {
  const path = join(daemonDir, 'progress.json')
  if (!existsSync(path)) {
    return { version: 1, lastUpdated: new Date().toISOString(), entries: [] }
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { version: 1, lastUpdated: new Date().toISOString(), entries: [] }
  }
}

export function appendProgress(daemonDir: string, entry: ProgressEntry): void {
  mkdirSync(daemonDir, { recursive: true })
  const log = loadProgress(daemonDir)
  log.entries.push(entry)
  // Keep only recent entries
  if (log.entries.length > MAX_ENTRIES) {
    log.entries = log.entries.slice(-MAX_ENTRIES)
  }
  log.lastUpdated = new Date().toISOString()
  writeFileSync(join(daemonDir, 'progress.json'), JSON.stringify(log, null, 2), 'utf-8')
}

/** Get a text summary of recent progress for agent orientation */
export function getProgressSummary(daemonDir: string, limit = 10): string | null {
  const log = loadProgress(daemonDir)
  if (log.entries.length === 0) return null

  const recent = log.entries.slice(-limit)
  const completed = recent.filter(e => e.status === 'completed').length
  const failed = recent.filter(e => e.status === 'failed').length

  const lines = [
    `## Recent Progress (last ${recent.length} tasks)`,
    `- Completed: ${completed} | Failed: ${failed}`,
    '',
  ]

  for (const entry of recent) {
    const icon = entry.status === 'completed' ? '+' : 'x'
    const time = new Date(entry.timestamp).toLocaleString()
    const duration = entry.durationMs ? ` (${Math.round(entry.durationMs / 1000)}s)` : ''
    lines.push(`- [${icon}] **${entry.title}**${duration} — ${time}`)
    if (entry.error) lines.push(`  Error: ${entry.error.slice(0, 100)}`)
  }

  return lines.join('\n')
}
