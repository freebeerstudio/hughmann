/**
 * HughMann Daemon
 *
 * A long-running background process that:
 * 1. Runs scheduled skills at configured times
 * 2. Watches ~/.hughmann/inbox/ for trigger files
 * 3. Processes incoming tasks from a queue file
 * 4. Maintains a heartbeat for liveness checking
 *
 * Run via: hughmann daemon
 * Stop via: hughmann daemon stop
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../config.js'
import { boot } from '../runtime/boot.js'
import type { Runtime } from '../runtime/runtime.js'
import { loadStats, saveStats, canExecuteTask, recordSuccess, recordFailure, getStatsSummary, DEFAULT_GUARDRAIL_CONFIG, type DaemonStats, type GuardrailConfig } from './guardrails.js'
import { appendProgress } from './progress.js'
import { runProactiveChecks } from './proactive.js'
import { buildTaskPrompt, selectBestTask, recordTaskResult } from '../runtime/task-executor.js'
import { createDaemonLogger } from '../util/logger.js'

const DAEMON_DIR = join(HUGHMANN_HOME, 'daemon')
const INBOX_DIR = join(HUGHMANN_HOME, 'inbox')
const LOG_DIR = join(HUGHMANN_HOME, 'logs')
const PID_FILE = join(DAEMON_DIR, 'daemon.pid')
const HEARTBEAT_FILE = join(DAEMON_DIR, 'heartbeat')
const QUEUE_FILE = join(DAEMON_DIR, 'queue.jsonl')

const POLL_INTERVAL_MS = 60_000 // Check every minute
const HEARTBEAT_INTERVAL_MS = 30_000 // Update heartbeat every 30s

export interface DaemonTask {
  type: 'skill' | 'task' | 'chat'
  content: string
  domain?: string
  source?: string // 'schedule' | 'inbox' | 'queue' | 'api'
  createdAt: string
}

interface ScheduleRule {
  skillId: string
  hour: number
  minute: number
  weekday?: number // 0=Sun, 1=Mon, ... 6=Sat
}

export async function startDaemon(): Promise<void> {
  // Ensure directories exist
  for (const dir of [DAEMON_DIR, INBOX_DIR, LOG_DIR]) {
    mkdirSync(dir, { recursive: true })
  }

  // Check if already running
  if (isDaemonRunning()) {
    log('Daemon is already running. Use "hughmann daemon stop" first.')
    return
  }

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid), 'utf-8')

  // Boot runtime
  log('Booting runtime...')
  const result = await boot()
  if (!result.success || !result.runtime) {
    log(`Boot failed: ${result.errors.join(', ')}`)
    cleanup()
    return
  }

  const runtime = result.runtime
  await runtime.initSession()
  log(`Daemon started (PID: ${process.pid})`)

  // Recover orphaned tasks from a previous crash
  if (runtime.data) {
    try {
      const orphaned = await runtime.data.listTasks({ status: ['in_progress'], limit: 50 })
      if (orphaned.length > 0) {
        for (const task of orphaned) {
          await runtime.data.updateTask(task.id, { status: 'todo' })
        }
        log(`[Recovery] Reset ${orphaned.length} orphaned in_progress task(s) to todo`)
      }
    } catch {
      // Best-effort
    }
  }

  // Initialize guardrails — load persisted stats or start fresh
  const stats = loadStats(DAEMON_DIR)
  const guardrailConfig = DEFAULT_GUARDRAIL_CONFIG
  log(`Stats loaded: ${getStatsSummary(stats)}`)

  // Load schedule
  const schedule = loadSchedule()
  if (schedule.length > 0) {
    log(`Loaded ${schedule.length} scheduled rules`)
  }

  // Track what's already been run today
  const executedToday = new Set<string>()
  let lastVaultSync = Date.now() // Just synced on boot
  let lastMailCheck = 0
  let lastProactiveCheck = 0
  const VAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
  const MAIL_CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
  const PROACTIVE_CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

  // Heartbeat loop
  const heartbeatTimer = setInterval(() => {
    writeFileSync(HEARTBEAT_FILE, new Date().toISOString(), 'utf-8')
  }, HEARTBEAT_INTERVAL_MS)

  // Initial heartbeat
  writeFileSync(HEARTBEAT_FILE, new Date().toISOString(), 'utf-8')

  // Graceful shutdown
  const shutdown = () => {
    log('Shutting down daemon...')
    clearInterval(heartbeatTimer)
    clearInterval(pollTimer)
    cleanup()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // Main poll loop
  const pollTimer = setInterval(async () => {
    try {
      // 1. Check scheduled skills
      await checkSchedule(runtime, schedule, executedToday)

      // 2. Process inbox files
      await processInbox(runtime)

      // 3. Process queue
      await processQueue(runtime)

      // 4. Process task queue (autonomous task execution with guardrails)
      await processTaskQueue(runtime, stats, guardrailConfig)

      // Periodic mail check (7am-6pm only)
      const hour = new Date().getHours()
      if (hour >= 7 && hour < 18 && Date.now() - lastMailCheck > MAIL_CHECK_INTERVAL_MS) {
        lastMailCheck = Date.now()
        runMailCheck(runtime).catch(err => {
          log(`Mail check error: ${err instanceof Error ? err.message : String(err)}`)
        })
      }

      // Periodic vault sync
      if (Date.now() - lastVaultSync > VAULT_SYNC_INTERVAL_MS) {
        lastVaultSync = Date.now()
        runVaultSync(runtime).catch(err => {
          log(`Periodic vault sync error: ${err instanceof Error ? err.message : String(err)}`)
        })
      }

      // Proactive checks (deadlines, stale projects, blocked tasks)
      if (runtime.data && Date.now() - lastProactiveCheck > PROACTIVE_CHECK_INTERVAL_MS) {
        lastProactiveCheck = Date.now()
        runProactiveChecks(runtime.data, DAEMON_DIR).then(nudges => {
          if (nudges.length > 0) {
            log(`Proactive: ${nudges.length} nudge(s) — ${nudges.map(n => n.type).join(', ')}`)
          }
        }).catch(err => {
          log(`Proactive check error: ${err instanceof Error ? err.message : String(err)}`)
        })
      }

      // Reset executed set at midnight
      const now = new Date()
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        executedToday.clear()
      }
    } catch (err) {
      log(`Poll error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, POLL_INTERVAL_MS)

  // Run initial poll immediately
  await checkSchedule(runtime, schedule, executedToday)
  await processInbox(runtime)
  await processQueue(runtime)

  // Run vault sync on daemon start (best-effort)
  runVaultSync(runtime).catch(err => {
    log(`Vault sync error: ${err instanceof Error ? err.message : String(err)}`)
  })

  // Keep process alive
  log('Daemon is running. Polling every 60 seconds.')
}

export function stopDaemon(): boolean {
  if (!existsSync(PID_FILE)) {
    return false
  }

  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim())
    process.kill(pid, 'SIGTERM')
    cleanup()
    return true
  } catch {
    cleanup()
    return false
  }
}

export function isDaemonRunning(): boolean {
  if (!existsSync(PID_FILE)) return false

  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim())
    process.kill(pid, 0) // Check if process exists
    return true
  } catch {
    // Process doesn't exist, clean up stale PID file
    cleanup()
    return false
  }
}

export function getDaemonStatus(): {
  running: boolean
  pid?: number
  lastHeartbeat?: string
  uptime?: string
} {
  const running = isDaemonRunning()
  if (!running) return { running: false }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim())
  let lastHeartbeat: string | undefined

  if (existsSync(HEARTBEAT_FILE)) {
    lastHeartbeat = readFileSync(HEARTBEAT_FILE, 'utf-8').trim()
  }

  let uptime: string | undefined
  if (lastHeartbeat) {
    const ms = Date.now() - new Date(lastHeartbeat).getTime()
    if (ms < 120_000) {
      uptime = `${Math.round(ms / 1000)}s since last heartbeat`
    } else {
      uptime = `${Math.round(ms / 60_000)}m since last heartbeat (may be stale)`
    }
  }

  return { running, pid, lastHeartbeat, uptime }
}

/**
 * Enqueue a task for the daemon to process.
 */
export function enqueueTask(task: DaemonTask): void {
  mkdirSync(DAEMON_DIR, { recursive: true })
  const line = JSON.stringify(task) + '\n'
  appendFileSync(QUEUE_FILE, line, 'utf-8')
}

// ─── Internal ──────────────────────────────────────────────────────────────

async function checkSchedule(
  runtime: Runtime,
  schedule: ScheduleRule[],
  executedToday: Set<string>,
): Promise<void> {
  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const currentDay = now.getDay() // 0=Sun

  for (const rule of schedule) {
    const key = `${rule.skillId}-${now.toISOString().split('T')[0]}`

    // Skip if already executed today
    if (executedToday.has(key)) continue

    // Check time match (within the poll window)
    if (rule.hour !== currentHour) continue
    if (Math.abs(rule.minute - currentMinute) > 1) continue

    // Check day match
    if (rule.weekday !== undefined && rule.weekday !== currentDay) continue

    // Execute the skill
    log(`Executing scheduled skill: ${rule.skillId}`)
    executedToday.add(key)

    try {
      await executeSkill(runtime, rule.skillId)
      log(`Completed: ${rule.skillId}`)
    } catch (err) {
      log(`Failed: ${rule.skillId} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function processInbox(runtime: Runtime): Promise<void> {
  if (!existsSync(INBOX_DIR)) return

  const files = readdirSync(INBOX_DIR).filter(f =>
    f.endsWith('.md') || f.endsWith('.txt')
  )

  for (const file of files) {
    const path = join(INBOX_DIR, file)
    try {
      const content = readFileSync(path, 'utf-8')
      log(`Processing inbox: ${file}`)

      // Use the file content as a task
      const chunks: string[] = []
      for await (const chunk of runtime.doTaskStream(content, { maxTurns: 30 })) {
        if (chunk.type === 'text') chunks.push(chunk.content)
      }

      // Log the result
      const result = chunks.join('')
      if (result) {
        logResult(`inbox-${file}`, result)
      }

      // Remove processed file
      unlinkSync(path)
      log(`Processed and removed: ${file}`)
    } catch (err) {
      log(`Inbox error (${file}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function processQueue(runtime: Runtime): Promise<void> {
  if (!existsSync(QUEUE_FILE)) return

  let content: string
  try {
    content = readFileSync(QUEUE_FILE, 'utf-8')
  } catch {
    return
  }

  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length === 0) return

  // Clear the queue file immediately (new tasks will append fresh)
  writeFileSync(QUEUE_FILE, '', 'utf-8')

  for (const line of lines) {
    try {
      const task = JSON.parse(line) as DaemonTask

      // Switch domain if needed
      if (task.domain) {
        try { runtime.setDomain(task.domain) } catch { /* proceed */ }
      }

      log(`Processing queue task: ${task.type} — ${task.content.slice(0, 80)}`)

      switch (task.type) {
        case 'skill':
          await executeSkill(runtime, task.content)
          break
        case 'task': {
          const chunks: string[] = []
          for await (const chunk of runtime.doTaskStream(task.content, { maxTurns: 30 })) {
            if (chunk.type === 'text') chunks.push(chunk.content)
          }
          const result = chunks.join('')
          if (result) logResult(`task-${Date.now()}`, result)
          break
        }
        case 'chat': {
          const response = await runtime.chat(task.content)
          logResult(`chat-${Date.now()}`, response)
          break
        }
      }

      log(`Queue task completed`)
    } catch (err) {
      log(`Queue error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function executeSkill(runtime: Runtime, skillId: string): Promise<void> {
  const skill = runtime.skills.get(skillId)
  if (!skill) {
    log(`Unknown skill: ${skillId}`)
    return
  }

  // Auto-switch domain
  const prevDomain = runtime.activeDomain
  if (skill.domain) {
    try { runtime.setDomain(skill.domain) } catch { /* proceed */ }
  }

  // All skills use doTaskStream — tools available, model chooses whether to use them
  const chunks: string[] = []
  for await (const chunk of runtime.doTaskStream(skill.prompt)) {
    if (chunk.type === 'text') chunks.push(chunk.content)
  }

  const result = chunks.join('')
  if (result) {
    logResult(skillId, result)
  }

  // Restore domain
  if (skill.domain && prevDomain !== runtime.activeDomain) {
    runtime.setDomain(prevDomain)
  }
}

function loadSchedule(): ScheduleRule[] {
  const path = join(DAEMON_DIR, 'schedule.json')
  if (!existsSync(path)) {
    // Derive defaults from config's active hours if available
    const defaults = deriveDefaultSchedule()
    writeFileSync(path, JSON.stringify(defaults, null, 2), 'utf-8')
    return defaults
  }

  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return []
  }
}

/** Parse active hours string like "7am-6pm" into { start, end } in 24h format */
function parseActiveHours(activeHours: string): { start: number; end: number } | null {
  const match = activeHours.match(/(\d{1,2})(am|pm)?\s*-\s*(\d{1,2})(am|pm)?/i)
  if (!match) return null
  let startHour = parseInt(match[1])
  const startAmPm = (match[2] || '').toLowerCase()
  let endHour = parseInt(match[3])
  const endAmPm = (match[4] || '').toLowerCase()
  if (startAmPm === 'pm' && startHour < 12) startHour += 12
  if (startAmPm === 'am' && startHour === 12) startHour = 0
  if (endAmPm === 'pm' && endHour < 12) endHour += 12
  if (endAmPm === 'am' && endHour === 12) endHour = 0
  return { start: startHour, end: endHour }
}

/** Derive schedule times from onboarding config's activeHours (e.g. "7am-6pm") */
function deriveDefaultSchedule(): ScheduleRule[] {
  try {
    const configPath = join(HUGHMANN_HOME, '.onboarding-data.json')
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      const activeHours = config.autonomy?.activeHours
      if (activeHours) {
        const hours = parseActiveHours(activeHours)
        if (hours) {
          return [
            { skillId: 'morning', hour: hours.start, minute: 0 },
            { skillId: 'closeout', hour: hours.end, minute: 0 },
            { skillId: 'review', hour: Math.min(hours.start + 2, hours.end - 1), minute: 0, weekday: 5 },
          ]
        }
      }
    }
  } catch {
    // Fall through to defaults
  }

  return [
    { skillId: 'morning', hour: 7, minute: 0 },
    { skillId: 'closeout', hour: 16, minute: 0 },
    { skillId: 'review', hour: 9, minute: 0, weekday: 5 },
  ]
}

const logger = createDaemonLogger(LOG_DIR)

function log(message: string): void {
  if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
    logger.error(message)
  } else {
    logger.info(message)
  }
}

function logResult(taskId: string, result: string): void {
  const timestamp = new Date().toISOString().split('T')[0]
  const path = join(LOG_DIR, `results-${timestamp}.md`)
  const entry = `## ${taskId} — ${new Date().toLocaleTimeString()}\n\n${result}\n\n---\n\n`

  appendFileSync(path, entry, 'utf-8')
}

async function runVaultSync(runtime: Runtime): Promise<void> {
  try {
    const { loadVaultConfigs, syncVault } = await import('../runtime/vault-sync.js')
    const { createEmbeddingAdapter } = await import('../adapters/embeddings/index.js')

    const configs = loadVaultConfigs()
    if (configs.length === 0) return
    if (!runtime.data) return

    const embedAdapter = createEmbeddingAdapter()
    if (!embedAdapter) return

    for (const config of configs) {
      log(`Vault sync starting: ${config.name}`)
      const stats = await syncVault(config, runtime.data, embedAdapter, (msg) => log(msg))
      log(`Vault sync done: ${config.name} — ${stats.filesSynced} files, ${stats.chunksCreated} chunks`)
    }
  } catch (err) {
    log(`Vault sync failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function runMailCheck(runtime: Runtime): Promise<void> {
  try {
    const { runMailPipeline } = await import('../mail/index.js')
    log('Mail check starting...')
    const result = await runMailPipeline({}, (msg) => log(msg))
    log(`Mail check done: ${result.processed} processed, ${result.filesWritten} files written, ${result.errors} errors`)

    // If new files were written, trigger vault sync targeting _inbox/
    if (result.filesWritten > 0) {
      runInboxSync(runtime).catch(err => {
        log(`Inbox sync error: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
  } catch (err) {
    log(`Mail check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function runInboxSync(runtime: Runtime): Promise<void> {
  try {
    const { loadVaultConfigs, syncVault } = await import('../runtime/vault-sync.js')
    const { createEmbeddingAdapter } = await import('../adapters/embeddings/index.js')

    const configs = loadVaultConfigs()
    const omnissa = configs.find(c => c.name === 'omnissa')
    if (!omnissa || !runtime.data) return

    const embedAdapter = createEmbeddingAdapter()
    if (!embedAdapter) return

    // Sync only the _inbox folder
    const inboxConfig = { ...omnissa, folders: ['_inbox'] }
    log('Inbox vault sync starting...')
    const stats = await syncVault(inboxConfig, runtime.data, embedAdapter, (msg) => log(msg))
    log(`Inbox vault sync done: ${stats.filesSynced} files, ${stats.chunksCreated} chunks`)
  } catch (err) {
    log(`Inbox vault sync failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Autonomous task execution from the task database */
async function processTaskQueue(
  runtime: Runtime,
  stats: DaemonStats,
  config: GuardrailConfig,
): Promise<void> {
  if (!runtime.data) return

  // Check guardrails
  const check = canExecuteTask(stats, config)
  if (!check.allowed) return // Silently skip — not an error, just not time yet

  // Get next available task
  const tasks = await runtime.data.listTasks({ status: 'todo', limit: 10 })
  const task = selectBestTask(tasks)
  if (!task) return

  log(`[TaskQueue] Picking up task: "${task.title}" (${task.id.slice(0, 8)}) [${task.task_type} P${task.priority}]`)

  // Mark as in_progress
  await runtime.data.updateTask(task.id, { status: 'in_progress' })
  const taskStartTime = Date.now()

  // Switch domain if task has one
  const prevDomain = runtime.activeDomain
  if (task.domain) {
    try { runtime.setDomain(task.domain) } catch { /* proceed */ }
  }

  // Build task prompt with project context and memories (shared module)
  const prompt = await buildTaskPrompt(
    task,
    runtime.data,
    (query, opts) => runtime.memory.searchSemantic(query, opts),
  )

  try {
    const chunks: string[] = []
    for await (const chunk of runtime.doTaskStream(prompt, {
      maxTurns: config.maxTurnsPerTask,
      cwd: task.cwd ?? undefined,
    })) {
      if (chunk.type === 'text') chunks.push(chunk.content)
    }

    const result = chunks.join('')
    const summary = result.length > 500 ? result.slice(0, 500) + '...' : result

    // Record result via shared module + daemon-specific tracking
    await recordTaskResult(task, { success: true, summary, durationMs: Date.now() - taskStartTime }, runtime.data)
    recordSuccess(stats)
    saveStats(DAEMON_DIR, stats)
    log(`[TaskQueue] Completed: "${task.title}" — ${getStatsSummary(stats)}`)
    appendProgress(DAEMON_DIR, {
      taskId: task.id,
      title: task.title,
      status: 'completed',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - taskStartTime,
      summary: summary || undefined,
      domain: task.domain ?? undefined,
      project: task.project ?? undefined,
    })

    // Log result
    logResult(`task-${task.id.slice(0, 8)}`, `# ${task.title}\n\n${result}`)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await recordTaskResult(task, { success: false, summary: '', durationMs: Date.now() - taskStartTime, error: errorMsg }, runtime.data)
    recordFailure(stats)
    saveStats(DAEMON_DIR, stats)
    log(`[TaskQueue] Failed: "${task.title}" — ${errorMsg} — ${getStatsSummary(stats)}`)
    appendProgress(DAEMON_DIR, {
      taskId: task.id,
      title: task.title,
      status: 'failed',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - taskStartTime,
      error: errorMsg,
      domain: task.domain ?? undefined,
      project: task.project ?? undefined,
    })
  }

  // Restore domain
  if (task.domain && prevDomain !== runtime.activeDomain) {
    runtime.setDomain(prevDomain)
  }
}

function cleanup(): void {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE) } catch {}
  try { if (existsSync(HEARTBEAT_FILE)) unlinkSync(HEARTBEAT_FILE) } catch {}
}
