import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadProgress, appendProgress, getProgressSummary, type ProgressEntry } from '../src/daemon/progress.js'

describe('progress log', () => {
  let daemonDir: string

  beforeEach(() => {
    daemonDir = join(tmpdir(), `hughmann-progress-test-${Date.now()}`)
    mkdirSync(daemonDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(daemonDir, { recursive: true, force: true })
  })

  it('returns empty log when no file exists', () => {
    const log = loadProgress(daemonDir)
    expect(log.entries).toEqual([])
    expect(log.version).toBe(1)
  })

  it('appends and persists entries', () => {
    const entry: ProgressEntry = {
      taskId: 'task-1',
      title: 'Test task',
      status: 'completed',
      timestamp: new Date().toISOString(),
      durationMs: 5000,
    }

    appendProgress(daemonDir, entry)
    const log = loadProgress(daemonDir)
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0].title).toBe('Test task')
  })

  it('caps entries at 200', () => {
    for (let i = 0; i < 210; i++) {
      appendProgress(daemonDir, {
        taskId: `task-${i}`,
        title: `Task ${i}`,
        status: 'completed',
        timestamp: new Date().toISOString(),
      })
    }

    const log = loadProgress(daemonDir)
    expect(log.entries.length).toBeLessThanOrEqual(200)
    // Should have the latest entries, not the oldest
    expect(log.entries[log.entries.length - 1].title).toBe('Task 209')
  })

  it('generates summary text', () => {
    appendProgress(daemonDir, {
      taskId: '1',
      title: 'Good task',
      status: 'completed',
      timestamp: new Date().toISOString(),
    })
    appendProgress(daemonDir, {
      taskId: '2',
      title: 'Bad task',
      status: 'failed',
      timestamp: new Date().toISOString(),
      error: 'Something went wrong',
    })

    const summary = getProgressSummary(daemonDir)
    expect(summary).toContain('Good task')
    expect(summary).toContain('Bad task')
    expect(summary).toContain('Completed: 1')
    expect(summary).toContain('Failed: 1')
  })

  it('returns null summary when empty', () => {
    expect(getProgressSummary(daemonDir)).toBeNull()
  })
})
