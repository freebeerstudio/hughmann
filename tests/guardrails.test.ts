import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createStats,
  loadStats,
  saveStats,
  canExecuteTask,
  recordSuccess,
  recordFailure,
  resetDailyIfNeeded,
  DEFAULT_GUARDRAIL_CONFIG,
} from '../src/daemon/guardrails.js'

describe('guardrails', () => {
  let daemonDir: string

  beforeEach(() => {
    daemonDir = join(tmpdir(), `hughmann-guardrails-test-${Date.now()}`)
    mkdirSync(daemonDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(daemonDir, { recursive: true, force: true })
  })

  describe('stats persistence', () => {
    it('creates fresh stats when no file exists', () => {
      const stats = loadStats(daemonDir)
      expect(stats.tasksCompleted).toBe(0)
      expect(stats.tasksFailed).toBe(0)
      expect(stats.consecutiveFailures).toBe(0)
    })

    it('saves and loads stats', () => {
      const stats = createStats()
      stats.tasksCompleted = 5
      stats.tasksFailed = 2
      stats.lastTaskAt = new Date('2025-01-15T10:00:00Z')

      saveStats(daemonDir, stats)
      const loaded = loadStats(daemonDir)

      expect(loaded.tasksCompleted).toBe(5)
      expect(loaded.tasksFailed).toBe(2)
      expect(loaded.lastTaskAt).toEqual(new Date('2025-01-15T10:00:00Z'))
    })

    it('handles corrupted stats file', () => {
      const { writeFileSync } = require('node:fs')
      writeFileSync(join(daemonDir, 'stats.json'), 'not json', 'utf-8')
      const stats = loadStats(daemonDir)
      expect(stats.tasksCompleted).toBe(0)
    })
  })

  describe('canExecuteTask', () => {
    it('blocks when daily limit reached', () => {
      const stats = createStats()
      stats.dailyTaskCount = DEFAULT_GUARDRAIL_CONFIG.maxTasksPerDay

      const result = canExecuteTask(stats, DEFAULT_GUARDRAIL_CONFIG)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Daily task limit')
    })

    it('blocks during cooldown after consecutive failures', () => {
      const stats = createStats()
      stats.consecutiveFailures = DEFAULT_GUARDRAIL_CONFIG.maxConsecutiveFailures
      stats.lastTaskAt = new Date() // Just now

      // Override business hours to allow execution
      const config = { ...DEFAULT_GUARDRAIL_CONFIG, businessHoursStart: 0, businessHoursEnd: 24 }
      const result = canExecuteTask(stats, config)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('cooldown')
    })

    it('allows after cooldown expires', () => {
      const stats = createStats()
      stats.consecutiveFailures = DEFAULT_GUARDRAIL_CONFIG.maxConsecutiveFailures
      stats.lastTaskAt = new Date(Date.now() - DEFAULT_GUARDRAIL_CONFIG.cooldownMs - 1000)

      const config = { ...DEFAULT_GUARDRAIL_CONFIG, businessHoursStart: 0, businessHoursEnd: 24 }
      const result = canExecuteTask(stats, config)
      expect(result.allowed).toBe(true)
    })
  })

  describe('record functions', () => {
    it('recordSuccess resets consecutive failures', () => {
      const stats = createStats()
      stats.consecutiveFailures = 2
      recordSuccess(stats)
      expect(stats.consecutiveFailures).toBe(0)
      expect(stats.tasksCompleted).toBe(1)
      expect(stats.dailyTaskCount).toBe(1)
    })

    it('recordFailure increments consecutive failures', () => {
      const stats = createStats()
      recordFailure(stats)
      recordFailure(stats)
      expect(stats.consecutiveFailures).toBe(2)
      expect(stats.tasksFailed).toBe(2)
    })
  })

  describe('daily reset', () => {
    it('resets daily count when date changes', () => {
      const stats = createStats()
      stats.dailyTaskCount = 5
      stats.dailyResetDate = '2020-01-01' // Far in the past

      resetDailyIfNeeded(stats)
      expect(stats.dailyTaskCount).toBe(0)
    })
  })
})
