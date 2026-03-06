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
import { createStats, canExecuteTask, recordSuccess, recordFailure, getStatsSummary, DEFAULT_GUARDRAIL_CONFIG, type DaemonStats, type GuardrailConfig } from './guardrails.js'
import type { Task } from '../types/tasks.js'

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

  // Initialize guardrails for autonomous task execution
  const stats = createStats()
  const guardrailConfig = DEFAULT_GUARDRAIL_CONFIG

  // Load schedule
  const schedule = loadSchedule()
  if (schedule.length > 0) {
    log(`Loaded ${schedule.length} scheduled rules`)
  }

  // Track what's already been run today
  const executedToday = new Set<string>()
  let lastVaultSync = Date.now() // Just synced on boot
  let lastMailCheck = 0
  const VAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
  const MAIL_CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

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
    // Create default schedule
    const defaults: ScheduleRule[] = [
      { skillId: 'morning', hour: 7, minute: 0 },
      { skillId: 'closeout', hour: 16, minute: 0 },
      { skillId: 'review', hour: 9, minute: 0, weekday: 5 }, // Friday
    ]
    writeFileSync(path, JSON.stringify(defaults, null, 2), 'utf-8')
    return defaults
  }

  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return []
  }
}

function log(message: string): void {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${message}\n`

  // Write to daemon log
  const logPath = join(LOG_DIR, 'daemon.log')
  appendFileSync(logPath, line, 'utf-8')

  // Also log to stderr (visible if running in foreground)
  process.stderr.write(line)
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
  if (tasks.length === 0) return

  // Select best task: sort by priority → type weight → created_at
  const typeWeight: Record<string, number> = { MUST: 0, MIT: 1, BIG_ROCK: 2, STANDARD: 3 }
  const sorted = tasks.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const wa = typeWeight[a.task_type] ?? 3
    const wb = typeWeight[b.task_type] ?? 3
    if (wa !== wb) return wa - wb
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  const task = sorted[0]
  log(`[TaskQueue] Picking up task: "${task.title}" (${task.id.slice(0, 8)}) [${task.task_type} P${task.priority}]`)

  // Mark as in_progress
  await runtime.data.updateTask(task.id, { status: 'in_progress' })

  // Switch domain if task has one
  const prevDomain = runtime.activeDomain
  if (task.domain) {
    try { runtime.setDomain(task.domain) } catch { /* proceed */ }
  }

  // Build task prompt with project context and memories
  const prompt = await buildTaskPrompt(task, runtime)

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

    // Mark complete
    await runtime.data.completeTask(task.id, summary || 'Task completed')
    recordSuccess(stats)
    log(`[TaskQueue] Completed: "${task.title}" — ${getStatsSummary(stats)}`)

    // Log result
    logResult(`task-${task.id.slice(0, 8)}`, `# ${task.title}\n\n${result}`)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await runtime.data.updateTask(task.id, { status: 'blocked' })
    recordFailure(stats)
    log(`[TaskQueue] Failed: "${task.title}" — ${errorMsg} — ${getStatsSummary(stats)}`)

    // Record gap for self-improvement
    import('../runtime/gap-analyzer.js').then(({ analyzeGapFromFailure }) =>
      analyzeGapFromFailure(task, errorMsg, runtime.data!).catch(() => {})
    ).catch(() => {})
  }

  // Restore domain
  if (task.domain && prevDomain !== runtime.activeDomain) {
    runtime.setDomain(prevDomain)
  }
}

async function buildTaskPrompt(task: Task, runtime: Runtime): Promise<string> {
  let prompt = `Execute the following task:\n\n**Title**: ${task.title}\n`
  if (task.description) prompt += `**Description**: ${task.description}\n`
  if (task.project) prompt += `**Project**: ${task.project}\n`
  if (task.domain) prompt += `**Domain**: ${task.domain}\n`
  if (task.due_date) prompt += `**Due**: ${task.due_date}\n`

  // Load project context if task has a project_id
  if (task.project_id && runtime.data) {
    try {
      const project = await runtime.data.getProject(task.project_id)
      if (project) {
        prompt += `\n**Project Context**:\n`
        prompt += `  Name: ${project.name}\n`
        if (project.quarterly_goal) prompt += `  Quarterly Goal: ${project.quarterly_goal}\n`
        if (project.goals.length > 0) prompt += `  Goals: ${project.goals.join('; ')}\n`
        const activeMilestones = project.milestones.filter(m => !m.completed)
        if (activeMilestones.length > 0) {
          prompt += `  Active Milestones: ${activeMilestones.map(m => m.title).join(', ')}\n`
        }
      }
    } catch {
      // Best-effort — don't block task execution
    }
  }

  // Search semantic memory for task relevance
  try {
    const memories = await runtime.memory.searchSemantic(task.title, { limit: 3 })
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

  prompt += `\nComplete this task thoroughly. When done, provide a summary of what was accomplished.`
  return prompt
}

function cleanup(): void {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE) } catch {}
  try { if (existsSync(HEARTBEAT_FILE)) unlinkSync(HEARTBEAT_FILE) } catch {}
}
