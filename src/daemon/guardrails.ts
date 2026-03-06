/**
 * Daemon execution guardrails.
 *
 * Controls how many tasks the daemon can execute per day,
 * enforces business hours, tracks consecutive failures,
 * and implements cooldown periods.
 */

export interface DaemonStats {
  tasksCompleted: number
  tasksFailed: number
  consecutiveFailures: number
  dailyTaskCount: number
  dailyResetDate: string // YYYY-MM-DD
  lastTaskAt: Date | null
}

export interface GuardrailConfig {
  maxTasksPerDay: number
  maxTurnsPerTask: number
  maxConsecutiveFailures: number
  cooldownMs: number
  businessHoursStart: number // 24h format
  businessHoursEnd: number
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  maxTasksPerDay: 5,
  maxTurnsPerTask: 50,
  maxConsecutiveFailures: 3,
  cooldownMs: 300_000, // 5 minutes
  businessHoursStart: 7,
  businessHoursEnd: 18,
}

export function createStats(): DaemonStats {
  return {
    tasksCompleted: 0,
    tasksFailed: 0,
    consecutiveFailures: 0,
    dailyTaskCount: 0,
    dailyResetDate: todayCst(),
    lastTaskAt: null,
  }
}

/** Reset daily counters if the date has changed */
export function resetDailyIfNeeded(stats: DaemonStats): void {
  const today = todayCst()
  if (stats.dailyResetDate !== today) {
    stats.dailyTaskCount = 0
    stats.dailyResetDate = today
  }
}

/** Check if the daemon is allowed to execute a task right now */
export function canExecuteTask(stats: DaemonStats, config: GuardrailConfig): { allowed: boolean; reason?: string } {
  resetDailyIfNeeded(stats)

  // Business hours check (uses local machine time)
  const now = new Date()
  const hour = now.getHours()
  if (hour < config.businessHoursStart || hour >= config.businessHoursEnd) {
    return { allowed: false, reason: `Outside business hours (${config.businessHoursStart}:00-${config.businessHoursEnd}:00)` }
  }

  // Daily limit
  if (stats.dailyTaskCount >= config.maxTasksPerDay) {
    return { allowed: false, reason: `Daily task limit reached (${config.maxTasksPerDay})` }
  }

  // Cooldown after consecutive failures
  if (stats.consecutiveFailures >= config.maxConsecutiveFailures && stats.lastTaskAt) {
    const elapsed = Date.now() - stats.lastTaskAt.getTime()
    if (elapsed < config.cooldownMs) {
      const remaining = Math.ceil((config.cooldownMs - elapsed) / 1000)
      return { allowed: false, reason: `In cooldown (${remaining}s remaining after ${stats.consecutiveFailures} consecutive failures)` }
    }
    // Cooldown expired, reset consecutive failures
    stats.consecutiveFailures = 0
  }

  return { allowed: true }
}

export function recordSuccess(stats: DaemonStats): void {
  stats.tasksCompleted++
  stats.dailyTaskCount++
  stats.consecutiveFailures = 0
  stats.lastTaskAt = new Date()
}

export function recordFailure(stats: DaemonStats): void {
  stats.tasksFailed++
  stats.dailyTaskCount++
  stats.consecutiveFailures++
  stats.lastTaskAt = new Date()
}

export function getStatsSummary(stats: DaemonStats): string {
  return `Tasks: ${stats.tasksCompleted} done, ${stats.tasksFailed} failed | Today: ${stats.dailyTaskCount} | Consecutive failures: ${stats.consecutiveFailures}`
}

/** Get today's date in CST as YYYY-MM-DD */
function todayCst(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}
