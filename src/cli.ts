#!/usr/bin/env node
import pc from 'picocolors'
import { showBanner } from './banner.js'
import { StreamMarkdownRenderer } from './util/markdown.js'

const GOLD = (text: string) => `\x1b[38;2;200;140;60m${text}\x1b[0m`

interface CliFlags {
  command: string
  args: string[]
  continue: boolean
  new: boolean
  domain: string | null
  quiet: boolean
}

function parseArgs(): CliFlags {
  const args = process.argv.slice(2)
  const flags: CliFlags = {
    command: 'chat',
    args: [],
    continue: false,
    new: false,
    domain: null,
    quiet: false,
  }

  let i = 0
  let commandSet = false
  while (i < args.length) {
    const arg = args[i]
    if (!commandSet && !arg.startsWith('-')) {
      flags.command = arg
      commandSet = true
      // Collect remaining non-flag args
      i++
      while (i < args.length) {
        const next = args[i]
        if (next === '-c' || next === '--continue') {
          flags.continue = true
        } else if (next === '-n' || next === '--new') {
          flags.new = true
        } else if (next === '-d' || next === '--domain') {
          flags.domain = args[++i] ?? null
        } else if (next === '-q' || next === '--quiet') {
          flags.quiet = true
        } else if (next === '-h' || next === '--help') {
          flags.command = 'help'
        } else {
          flags.args.push(next)
        }
        i++
      }
      break
    } else if (arg === '-c' || arg === '--continue') {
      flags.continue = true
    } else if (arg === '-n' || arg === '--new') {
      flags.new = true
    } else if (arg === '-d' || arg === '--domain') {
      flags.domain = args[++i] ?? null
    } else if (arg === '-q' || arg === '--quiet') {
      flags.quiet = true
    } else if (arg === '-h' || arg === '--help') {
      flags.command = 'help'
    }
    i++
  }

  return flags
}

const flags = parseArgs()

switch (flags.command) {
  case 'setup': {
    await import('./index.js')
    break
  }

  case 'chat': {
    await startChat(flags)
    break
  }

  case 'run': {
    await runSkill(flags)
    break
  }

  case 'skills': {
    await listSkills()
    break
  }

  case 'domains': {
    await listDomains()
    break
  }

  case 'schedule': {
    await manageSchedule(flags)
    break
  }

  case 'migrate': {
    const { join } = await import('node:path')
    const { HUGHMANN_HOME, loadConfig } = await import('./config.js')
    const { loadEnvFile } = await import('./util/env.js')
    const envPath = join(HUGHMANN_HOME, '.env')
    loadEnvFile(envPath)

    const config = loadConfig()
    const engine = config.infrastructure?.dataEngine ?? 'supabase'

    if (flags.args.includes('--apply')) {
      if (engine === 'turso') {
        const { setupTurso } = await import('./onboarding/phases/turso-setup.js')
        const ok = await setupTurso({
          existingUrl: process.env.TURSO_URL,
          existingAuthToken: process.env.TURSO_AUTH_TOKEN,
        })
        process.exit(ok ? 0 : 1)
      } else {
        const { setupSupabase } = await import('./onboarding/phases/supabase-setup.js')
        const ok = await setupSupabase({
          existingUrl: process.env.SUPABASE_URL,
          existingKey: process.env.SUPABASE_KEY,
        })
        process.exit(ok ? 0 : 1)
      }
    } else {
      if (engine === 'turso') {
        const { getTursoMigrationSQL } = await import('./adapters/data/turso.js')
        console.log(getTursoMigrationSQL())
      } else {
        const { getMigrationSQL } = await import('./adapters/data/supabase.js')
        console.log(getMigrationSQL())
      }
    }
    break
  }

  case 'telegram': {
    await startTelegram(flags)
    break
  }

  case 'serve': {
    await startMcpServer()
    break
  }

  case 'daemon': {
    await manageDaemon(flags)
    break
  }

  case 'mail': {
    await manageMail(flags)
    break
  }

  case 'vault': {
    await manageVault(flags)
    break
  }

  case 'trigger': {
    await manageTrigger(flags)
    break
  }

  case 'status': {
    await runBuiltinSkill('status', flags)
    break
  }

  case 'morning': {
    await runBuiltinSkill('morning', flags)
    break
  }

  case 'help': {
    showUsage()
    break
  }

  default: {
    // Check if it's a skill name used as a subcommand
    try {
      const runtime = await bootRuntime({ quiet: true })
      if (runtime.skills.has(flags.command)) {
        await runBuiltinSkill(flags.command, flags)
      } else {
        showUsage()
      }
    } catch {
      showUsage()
    }
    break
  }
}

// ─── Boot helpers ───────────────────────────────────────────────────────────

async function bootRuntime(flags: { domain?: string | null; quiet?: boolean }) {
  const { boot } = await import('./runtime/boot.js')
  const result = await boot()

  if (!flags.quiet) {
    for (const warning of result.warnings) {
      console.log(`  ${pc.yellow('\u26a0')} ${pc.dim(warning)}`)
    }
  }

  if (!result.success || !result.runtime) {
    if (!flags.quiet) console.log()
    for (const error of result.errors) {
      console.error(`  ${pc.red('\u2717')} ${error}`)
    }
    process.exit(1)
  }

  if (flags.domain) {
    try {
      result.runtime.setDomain(flags.domain)
    } catch (err) {
      console.error(`  ${pc.red('\u2717')} ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  return result.runtime
}

// ─── Subcommands ────────────────────────────────────────────────────────────

async function startChat(flags: CliFlags) {
  showBanner()

  const runtime = await bootRuntime(flags)

  if (flags.new) {
    runtime.clearHistory()
  }

  const { startChatLoop } = await import('./adapters/frontend/cli.js')
  await startChatLoop(runtime)
}

/**
 * `hughmann run <skill> [extra args]`
 * Non-interactive skill execution. Boots, runs, prints output, exits.
 */
async function runSkill(flags: CliFlags) {
  const skillId = flags.args[0]
  if (!skillId) {
    console.error(`  ${pc.red('Usage')}: hughmann run <skill> [additional context]`)
    console.error(`  ${pc.dim('Use "hughmann skills" to see available skills.')}`)
    process.exit(1)
  }

  const runtime = await bootRuntime({ domain: flags.domain, quiet: flags.quiet })
  const skill = runtime.skills.get(skillId)

  if (!skill) {
    console.error(`  ${pc.red('Unknown skill')}: ${skillId}`)
    console.error(`  ${pc.dim('Use "hughmann skills" to see available skills.')}`)
    process.exit(1)
  }

  // Auto-switch domain
  if (skill.domain) {
    try { runtime.setDomain(skill.domain) } catch { /* proceed */ }
  }

  // Build prompt with any extra args
  const extraArgs = flags.args.slice(1).join(' ')
  let prompt = skill.prompt
  if (extraArgs) {
    prompt += `\n\nAdditional context from user: ${extraArgs}`
  }

  // Init session for context
  await runtime.initSession()

  const systemName = runtime.context.config.systemName

  if (!flags.quiet) {
    console.log(`  ${GOLD(systemName)} ${pc.dim('running:')} ${pc.bold(skill.name)}`)
    console.log()
  }

  // Use markdown rendering for interactive, raw for quiet/piped
  const md = flags.quiet ? null : new StreamMarkdownRenderer()

  if (skill.complexity === 'autonomous') {
    // Autonomous: opus + tools
    let hasText = false

    for await (const chunk of runtime.doTaskStream(prompt, { maxTurns: skill.maxTurns })) {
      switch (chunk.type) {
        case 'tool_use':
          if (!flags.quiet) {
            if (hasText) {
              if (md) { const f = md.flush(); if (f) process.stdout.write(f) }
              process.stdout.write('\n'); hasText = false
            }
            console.log(`  ${pc.yellow('\u2699')} ${pc.dim(chunk.content)}`)
          }
          break
        case 'status':
          if (!flags.quiet) console.log(`  ${pc.green('\u2713')} ${pc.dim(chunk.content)}`)
          break
        case 'text':
          if (!hasText && !flags.quiet) {
            process.stdout.write('\n')
          }
          if (md) {
            const rendered = md.feed(chunk.content)
            if (rendered) process.stdout.write(rendered)
          } else {
            process.stdout.write(chunk.content)
          }
          hasText = true
          break
        case 'error':
          console.error(pc.red(`Error: ${chunk.content}`))
          break
        case 'done':
          if (md) { const f = md.flush(); if (f) process.stdout.write(f) }
          if (hasText) process.stdout.write('\n')
          break
      }
    }
  } else {
    // Conversational/lightweight
    for await (const chunk of runtime.chatStream(prompt)) {
      if (chunk.type === 'text') {
        if (md) {
          const rendered = md.feed(chunk.content)
          if (rendered) process.stdout.write(rendered)
        } else {
          process.stdout.write(chunk.content)
        }
      } else if (chunk.type === 'error') {
        console.error(pc.red(`Error: ${chunk.content}`))
      }
    }
    if (md) { const f = md.flush(); if (f) process.stdout.write(f) }
    process.stdout.write('\n')
  }

  // Distill after running
  await runtime.distillCurrent()
}

/**
 * Shorthand: `hughmann morning` is the same as `hughmann run morning`
 */
async function runBuiltinSkill(skillId: string, flags: CliFlags) {
  flags.args = [skillId, ...flags.args]
  await runSkill(flags)
}

/**
 * `hughmann skills` — List all available skills
 */
async function listSkills() {
  const runtime = await bootRuntime({ quiet: true })

  const builtins = runtime.skills.listBuiltin()
  const custom = runtime.skills.listCustom()

  console.log()
  console.log(`  ${pc.bold('Built-in Skills')}:`)
  for (const s of builtins) {
    const tier = s.complexity === 'autonomous'
      ? pc.yellow('[opus+tools]')
      : s.complexity === 'lightweight'
        ? pc.dim('[haiku]')
        : pc.blue('[sonnet]')
    console.log(`    ${pc.cyan(s.id)}${' '.repeat(Math.max(1, 16 - s.id.length))}${s.description} ${tier}`)
  }

  if (custom.length > 0) {
    console.log()
    console.log(`  ${pc.bold('Custom Skills')}:`)
    for (const s of custom) {
      const tier = s.complexity === 'autonomous'
        ? pc.yellow('[opus+tools]')
        : s.complexity === 'lightweight'
          ? pc.dim('[haiku]')
          : pc.blue('[sonnet]')
      console.log(`    ${pc.cyan(s.id)}${' '.repeat(Math.max(1, 16 - s.id.length))}${s.description} ${tier}`)
    }
  }

  console.log()
  console.log(`  ${pc.bold('Run a skill')}:`)
  console.log(`    ${pc.cyan('hughmann run <skill>')}    ${pc.dim('or just')}  ${pc.cyan('hughmann <skill>')}`)
  console.log()
}

/**
 * `hughmann domains` — List all domains
 */
async function listDomains() {
  const runtime = await bootRuntime({ quiet: true })
  const domains = runtime.getAvailableDomains()

  console.log()
  for (const d of domains) {
    const isolation = d.isolation === 'isolated'
      ? pc.yellow('[isolated]')
      : pc.blue('[personal]')
    console.log(`  ${pc.bold(d.name)} ${pc.dim(`(${d.domainType})`)} ${isolation}`)
  }
  console.log()
}

/**
 * `hughmann telegram` — Start the Telegram bot
 */
async function startTelegram(flags: CliFlags) {
  const runtime = await bootRuntime(flags)
  await runtime.initSession()

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error(`  ${pc.red('TELEGRAM_BOT_TOKEN not set.')}`)
    console.error(`  ${pc.dim('Add it to ~/.hughmann/.env:')}`)
    console.error(`  ${pc.dim('TELEGRAM_BOT_TOKEN=your-bot-token-here')}`)
    console.error()
    console.error(`  ${pc.dim('Create a bot via @BotFather on Telegram to get a token.')}`)
    process.exit(1)
  }

  const { startTelegramBot } = await import('./adapters/frontend/telegram.js')
  await startTelegramBot(runtime, token)
}

/**
 * `hughmann serve` — Start as an MCP server (stdio transport)
 */
async function startMcpServer() {
  await import('./mcp-server.js')
}

/**
 * `hughmann daemon [start|stop|status]` — Manage the daemon process
 */
async function manageDaemon(flags: CliFlags) {
  const { startDaemon, stopDaemon, getDaemonStatus, enqueueTask } = await import('./daemon/index.js')
  const subcommand = flags.args[0] ?? 'start'

  switch (subcommand) {
    case 'start': {
      await startDaemon()
      break
    }
    case 'stop': {
      const stopped = stopDaemon()
      if (stopped) {
        console.log(`  ${pc.green('\u2713')} Daemon stopped`)
      } else {
        console.log(`  ${pc.dim('No daemon running')}`)
      }
      break
    }
    case 'status': {
      const status = getDaemonStatus()
      if (status.running) {
        console.log(`  ${pc.green('\u2713')} Daemon running (PID: ${status.pid})`)
        if (status.uptime) {
          console.log(`  ${pc.dim(status.uptime)}`)
        }
      } else {
        console.log(`  ${pc.dim('Daemon not running')}`)
      }
      break
    }
    case 'queue': {
      const taskContent = flags.args.slice(1).join(' ')
      if (!taskContent) {
        console.error(`  ${pc.red('Usage')}: hughmann daemon queue <task description>`)
        process.exit(1)
      }
      enqueueTask({
        type: 'task',
        content: taskContent,
        source: 'cli',
        createdAt: new Date().toISOString(),
      })
      console.log(`  ${pc.green('\u2713')} Task queued for daemon`)
      break
    }
    default: {
      console.log(`  ${pc.bold('Usage')}: hughmann daemon [start|stop|status|queue]`)
      console.log()
      console.log(`    ${pc.cyan('start')}             Start the daemon process`)
      console.log(`    ${pc.cyan('stop')}              Stop the daemon`)
      console.log(`    ${pc.cyan('status')}            Check daemon status`)
      console.log(`    ${pc.cyan('queue <task>')}      Queue a task for the daemon`)
      console.log()
    }
  }
}

/**
 * `hughmann schedule [install|list|remove]` — Manage scheduled skills via launchd
 */
async function manageSchedule(flags: CliFlags) {
  const { installSchedule, removeSchedule, removeAllSchedules, listSchedules, DEFAULT_SCHEDULES } = await import('./scheduler/launchd.js')

  const subcommand = flags.args[0] ?? 'list'
  const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  switch (subcommand) {
    case 'install': {
      const skillId = flags.args[1]

      if (skillId) {
        // Install a specific skill schedule
        const defaults = DEFAULT_SCHEDULES.find(d => d.skillId === skillId)
        if (!defaults) {
          console.error(`  ${pc.red('No default schedule for')} ${skillId}`)
          console.error(`  ${pc.dim('Available: ' + DEFAULT_SCHEDULES.map(d => d.skillId).join(', '))}`)
          process.exit(1)
        }
        const result = installSchedule(defaults.skillId, defaults.hour, defaults.minute, defaults.weekday)
        if (result.success) {
          console.log(`  ${pc.green('\u2713')} Installed: ${defaults.description}`)
          console.log(`  ${pc.dim(result.path)}`)
        } else {
          console.error(`  ${pc.red('\u2717')} Failed: ${result.error}`)
        }
      } else {
        // Install all default schedules
        console.log()
        for (const sched of DEFAULT_SCHEDULES) {
          const result = installSchedule(sched.skillId, sched.hour, sched.minute, sched.weekday)
          if (result.success) {
            console.log(`  ${pc.green('\u2713')} ${sched.description}`)
          } else {
            console.log(`  ${pc.red('\u2717')} ${sched.skillId}: ${result.error}`)
          }
        }
        console.log()
        console.log(`  ${pc.dim('Logs: ~/.hughmann/logs/')}`)
        console.log(`  ${pc.dim('Manage: hughmann schedule list | hughmann schedule remove')}`)
        console.log()
      }
      break
    }

    case 'list': {
      const schedules = listSchedules()
      if (schedules.length === 0) {
        console.log(`  ${pc.dim('No schedules installed.')}`)
        console.log(`  ${pc.dim('Run "hughmann schedule install" to set up defaults.')}`)
        return
      }
      console.log()
      for (const s of schedules) {
        const time = `${s.hour.toString().padStart(2, '0')}:${s.minute.toString().padStart(2, '0')}`
        const day = s.weekday ? ` ${WEEKDAYS[s.weekday]}` : ' daily'
        const status = s.loaded ? pc.green('active') : pc.yellow('inactive')
        console.log(`  ${pc.bold(s.skillId)}${' '.repeat(Math.max(1, 14 - s.skillId.length))}${time}${day}  ${status}`)
      }
      console.log()
      break
    }

    case 'remove': {
      const skillId = flags.args[1]
      if (skillId === 'all' || !skillId) {
        const count = removeAllSchedules()
        console.log(`  ${pc.green('\u2713')} Removed ${count} schedule${count !== 1 ? 's' : ''}`)
      } else {
        const removed = removeSchedule(skillId)
        if (removed) {
          console.log(`  ${pc.green('\u2713')} Removed schedule for ${skillId}`)
        } else {
          console.log(`  ${pc.dim('No schedule found for')} ${skillId}`)
        }
      }
      break
    }

    default: {
      console.log(`  ${pc.bold('Usage')}: hughmann schedule [install|list|remove]`)
      console.log()
      console.log(`    ${pc.cyan('install')}           Install all default schedules (morning, closeout, review)`)
      console.log(`    ${pc.cyan('install <skill>')}   Install schedule for a specific skill`)
      console.log(`    ${pc.cyan('list')}              Show installed schedules`)
      console.log(`    ${pc.cyan('remove')}            Remove all schedules`)
      console.log(`    ${pc.cyan('remove <skill>')}    Remove a specific schedule`)
      console.log()
    }
  }
}

/**
 * `hughmann trigger [dev|deploy|sync]`
 */
async function manageTrigger(flags: CliFlags) {
  const subcommand = flags.args[0] ?? 'help'

  switch (subcommand) {
    case 'sync': {
      // Sync local context docs to Supabase for cloud access
      const runtime = await bootRuntime({ quiet: false })
      if (!runtime.data) {
        console.error(`  ${pc.red('✗')} No data adapter configured. Context sync requires Supabase.`)
        process.exit(1)
      }

      const { join } = await import('node:path')
      const { HUGHMANN_HOME } = await import('./config.js')
      const { readFileSync, readdirSync, existsSync } = await import('node:fs')
      const { createHash } = await import('node:crypto')

      const contextDir = join(HUGHMANN_HOME, 'context')
      if (!existsSync(contextDir)) {
        console.error(`  ${pc.red('✗')} Context directory not found: ${contextDir}`)
        process.exit(1)
      }

      const files = readdirSync(contextDir).filter(f => f.endsWith('.md'))
      console.log(`  ${pc.dim(`Found ${files.length} context files`)}`)

      const { SupabaseAdapter } = await import('./adapters/data/supabase.js')
      const adapter = runtime.data as InstanceType<typeof SupabaseAdapter>
      const client = adapter.getClient()

      let synced = 0
      for (const file of files) {
        const filePath = join(contextDir, file)
        const content = readFileSync(filePath, 'utf-8')
        const name = file.replace('.md', '')
        const contentHash = createHash('sha256').update(content).digest('hex')

        // Extract title and type
        const titleMatch = content.match(/^#\s+(.+)/m)
        const title = titleMatch?.[1] ?? name
        const nameLower = name.toLowerCase()

        let docType = 'other'
        let domainSlug: string | null = null
        let isolationZone: string | null = null

        if (nameLower.includes('soul')) docType = 'soul'
        else if (nameLower.includes('owner')) docType = 'owner'
        else if (nameLower.includes('master-plan')) docType = 'master-plan'
        else if (nameLower.includes('capabilities')) docType = 'capabilities'
        else if (nameLower.includes('growth')) docType = 'growth'
        else {
          const domainMatch = nameLower.match(/^domain-(\w+)$/)
          if (domainMatch) {
            docType = 'domain'
            domainSlug = domainMatch[1]
            const isoMatch = content.match(/isolation[:\s]+(isolated|personal)/i)
            isolationZone = isoMatch?.[1]?.toLowerCase() ?? 'personal'
          }
        }

        // Check if unchanged
        const { data: existing } = await client
          .from('context_docs')
          .select('content_hash')
          .eq('id', docType === 'domain' ? `domain-${domainSlug}` : docType === 'other' ? name : docType)
          .single()

        if (existing?.content_hash === contentHash) continue

        await client.from('context_docs').upsert({
          id: docType === 'domain' ? `domain-${domainSlug}` : docType === 'other' ? name : docType,
          doc_type: docType,
          title,
          content,
          domain_slug: domainSlug,
          isolation_zone: isolationZone,
          content_hash: contentHash,
          synced_at: new Date().toISOString(),
        })
        synced++
      }

      console.log(`  ${pc.green('✓')} Synced ${synced} context docs to Supabase (${files.length - synced} unchanged)`)
      break
    }

    case 'dev': {
      console.log(`  ${pc.bold('Starting Trigger.dev dev server...')}`)
      console.log(`  ${pc.dim('This connects to Trigger.dev cloud and registers your tasks.')}`)
      console.log()
      const { execSync } = await import('node:child_process')
      try {
        execSync('npx trigger dev', { stdio: 'inherit', cwd: process.cwd() })
      } catch {
        console.error(`  ${pc.red('✗')} Trigger.dev dev server failed. Make sure TRIGGER_SECRET_KEY is set.`)
      }
      break
    }

    case 'deploy': {
      console.log(`  ${pc.bold('Deploying tasks to Trigger.dev...')}`)
      const { execSync } = await import('node:child_process')
      try {
        execSync('npx trigger deploy', { stdio: 'inherit', cwd: process.cwd() })
      } catch {
        console.error(`  ${pc.red('✗')} Deployment failed. Make sure TRIGGER_SECRET_KEY is set.`)
      }
      break
    }

    default: {
      console.log(`  ${pc.bold('Usage')}: hughmann trigger [dev|deploy|sync]`)
      console.log()
      console.log(`    ${pc.cyan('sync')}              Sync context docs to Supabase for cloud access`)
      console.log(`    ${pc.cyan('dev')}               Start Trigger.dev dev server (registers tasks)`)
      console.log(`    ${pc.cyan('deploy')}            Deploy tasks to Trigger.dev cloud`)
      console.log()
    }
  }
}

/**
 * `hughmann mail [process|status]` — Process Elle mailbox emails
 */
async function manageMail(flags: CliFlags) {
  const subcommand = flags.args[0] ?? 'process'

  switch (subcommand) {
    case 'process': {
      const { join } = await import('node:path')
      const { HUGHMANN_HOME } = await import('./config.js')
      const { loadEnvFile } = await import('./util/env.js')
      loadEnvFile(join(HUGHMANN_HOME, '.env'))

      const { runMailPipeline } = await import('./mail/index.js')

      const dryRun = flags.args.includes('--dry-run')
      const limitIdx = flags.args.indexOf('--limit')
      const limit = limitIdx !== -1 ? parseInt(flags.args[limitIdx + 1], 10) : undefined

      console.log()
      console.log(`  ${pc.bold('Elle Mail Processor')}`)
      if (dryRun) console.log(`  ${pc.yellow('DRY RUN')} — classify only, no files written`)
      if (limit) console.log(`  ${pc.dim(`Limit: ${limit}`)}`)
      console.log()

      try {
        const result = await runMailPipeline({ dryRun, limit }, (msg) => {
          console.log(`  ${pc.dim(msg)}`)
        })

        console.log()
        console.log(`  ${pc.bold('Summary')}:`)
        console.log(`    Processed: ${result.processed}`)
        console.log(`    Files written: ${result.filesWritten}`)
        console.log(`    Noise skipped: ${result.skippedNoise}`)
        if (result.errors > 0) {
          console.log(`    ${pc.red(`Errors: ${result.errors}`)}`)
        }

        if (Object.keys(result.typeCounts).length > 0) {
          console.log(`    ${pc.dim('By type:')}`)
          for (const [type, count] of Object.entries(result.typeCounts).sort()) {
            console.log(`      ${type}: ${count}`)
          }
        }
        console.log()
      } catch (err) {
        console.error(`  ${pc.red('✗')} ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
      break
    }

    case 'status': {
      const { join } = await import('node:path')
      const { HUGHMANN_HOME } = await import('./config.js')
      const { loadEnvFile } = await import('./util/env.js')
      loadEnvFile(join(HUGHMANN_HOME, '.env'))

      const { getMailStatus } = await import('./mail/index.js')
      const status = getMailStatus()

      console.log()
      if (status.lastRun) {
        console.log(`  ${pc.bold('Last run')}: ${status.lastRun}`)
        console.log(`  ${pc.bold('Total processed')}: ${status.totalProcessed}`)
        console.log(`  ${pc.bold('Last run count')}: ${status.lastRunCount}`)
        if (status.lastRunErrors > 0) {
          console.log(`  ${pc.bold('Last run errors')}: ${pc.red(String(status.lastRunErrors))}`)
        }
      } else {
        console.log(`  ${pc.dim('No mail processing runs yet.')}`)
        console.log(`  ${pc.dim('Run "hughmann mail process" to start.')}`)
      }
      console.log()
      break
    }

    default: {
      console.log(`  ${pc.bold('Usage')}: hughmann mail [process|status]`)
      console.log()
      console.log(`    ${pc.cyan('process')}           Process new emails from Elle ${pc.dim('(default)')}`)
      console.log(`    ${pc.cyan('process --dry-run')} Classify only, no files written`)
      console.log(`    ${pc.cyan('process --limit N')} Process at most N emails`)
      console.log(`    ${pc.cyan('status')}            Show last run time + total processed`)
      console.log()
    }
  }
}

/**
 * `hughmann vault sync [--vault omnissa|fbs|personal|all]`
 */
async function manageVault(flags: CliFlags) {
  const subcommand = flags.args[0] ?? 'sync'

  if (subcommand !== 'sync') {
    console.log(`  ${pc.bold('Usage')}: hughmann vault sync [--vault <name>]`)
    console.log()
    console.log(`    ${pc.cyan('sync')}              Sync Obsidian vault files to database`)
    console.log(`    ${pc.dim('--vault <name>')}     Sync a specific vault (omnissa, fbs, personal, all)`)
    console.log()
    return
  }

  const runtime = await bootRuntime({ quiet: false })
  if (!runtime.data) {
    console.error(`  ${pc.red('✗')} No data adapter configured. Vault sync requires Supabase.`)
    process.exit(1)
  }

  if (!runtime.memory.hasVectorMemory()) {
    console.error(`  ${pc.red('✗')} Embeddings not available. Set EMBEDDING_API_KEY or OPENAI_API_KEY in ~/.hughmann/.env`)
    process.exit(1)
  }

  const { loadVaultConfigs, syncVault } = await import('./runtime/vault-sync.js')
  const { createEmbeddingAdapter } = await import('./adapters/embeddings/index.js')

  const configs = loadVaultConfigs()
  if (configs.length === 0) {
    console.error(`  ${pc.red('✗')} No vault configurations found.`)
    console.error(`  ${pc.dim('Add to ~/.hughmann/.env:')}`)
    console.error(`  ${pc.dim('VAULT_OMNISSA_PATH=/path/to/vault')}`)
    console.error(`  ${pc.dim('VAULT_OMNISSA_FOLDERS=Customers,Products,Resources')}`)
    process.exit(1)
  }

  const vaultFilter = flags.args.find(a => !a.startsWith('-'))?.replace('sync', '').trim() ||
    flags.args[flags.args.indexOf('--vault') + 1]

  const toSync = vaultFilter && vaultFilter !== 'all'
    ? configs.filter(c => c.name === vaultFilter.toLowerCase())
    : configs

  if (toSync.length === 0) {
    console.error(`  ${pc.red('✗')} No vault found with name: ${vaultFilter}`)
    console.error(`  ${pc.dim('Available: ' + configs.map(c => c.name).join(', '))}`)
    process.exit(1)
  }

  const embedAdapter = createEmbeddingAdapter()
  if (!embedAdapter) {
    console.error(`  ${pc.red('✗')} Embedding adapter not available.`)
    process.exit(1)
  }

  for (const config of toSync) {
    console.log()
    console.log(`  ${pc.bold(config.name)} vault: ${pc.dim(config.path)}`)
    console.log(`  ${pc.dim('Folders: ' + (config.folders.length > 0 ? config.folders.join(', ') : 'all'))}`)

    const stats = await syncVault(config, runtime.data, embedAdapter, (msg) => {
      console.log(`  ${pc.dim(msg)}`)
    })

    console.log(`  ${pc.green('✓')} Scanned: ${stats.filesScanned}, Changed: ${stats.filesChanged}, Synced: ${stats.filesSynced}, Chunks: ${stats.chunksCreated}`)
    if (stats.errors.length > 0) {
      console.log(`  ${pc.yellow('⚠')} ${stats.errors.length} error${stats.errors.length !== 1 ? 's' : ''}:`)
      for (const err of stats.errors.slice(0, 5)) {
        console.log(`    ${pc.dim(err)}`)
      }
      if (stats.errors.length > 5) {
        console.log(`    ${pc.dim(`... and ${stats.errors.length - 5} more`)}`)
      }
    }
  }
  console.log()
}

// ─── Usage ──────────────────────────────────────────────────────────────────

function showUsage() {
  showBanner()
  console.log(`  ${pc.bold('Usage')}: hughmann [command] [flags]`)
  console.log()
  console.log(`  ${pc.bold('Commands')}:`)
  console.log(`    ${pc.cyan('chat')}              Start a conversation ${pc.dim('(default)')}`)
  console.log(`    ${pc.cyan('setup')}             Run onboarding / configuration`)
  console.log(`    ${pc.cyan('run <skill>')}       Run a skill non-interactively`)
  console.log(`    ${pc.cyan('<skill>')}           Shorthand for run ${pc.dim('(e.g. hughmann morning)')}`)
  console.log(`    ${pc.cyan('skills')}            List available skills`)
  console.log(`    ${pc.cyan('domains')}           List configured domains`)
  console.log(`    ${pc.cyan('mail')}              Process Elle mailbox emails ${pc.dim('(process|status)')}`)
  console.log(`    ${pc.cyan('vault sync')}        Sync Obsidian vaults to database`)
  console.log(`    ${pc.cyan('trigger')}           Manage Trigger.dev ${pc.dim('(dev|deploy|sync)')}`)
  console.log(`    ${pc.cyan('schedule')}          Manage scheduled skills ${pc.dim('(launchd)')}`)
  console.log(`    ${pc.cyan('migrate')}           Print migration SQL ${pc.dim('(auto-detects Supabase/Turso)')}`)
  console.log(`    ${pc.cyan('migrate --apply')}   Connect and create tables ${pc.dim('(auto-detects engine)')}`)
  console.log(`    ${pc.cyan('telegram')}          Start Telegram bot`)
  console.log(`    ${pc.cyan('serve')}             Start as MCP server ${pc.dim('(stdio)')}`)
  console.log(`    ${pc.cyan('daemon')}            Manage background daemon ${pc.dim('(start|stop|status|queue)')}`)
  console.log()
  console.log(`  ${pc.bold('Flags')}:`)
  console.log(`    ${pc.cyan('-c, --continue')}    Resume the most recent session`)
  console.log(`    ${pc.cyan('-n, --new')}         Start a fresh session`)
  console.log(`    ${pc.cyan('-d, --domain')}      Set active domain ${pc.dim('(e.g. -d omnissa)')}`)
  console.log(`    ${pc.cyan('-q, --quiet')}       Minimal output (for scripts/cron)`)
  console.log(`    ${pc.cyan('-h, --help')}        Show this help`)
  console.log()
  console.log(`  ${pc.bold('Examples')}:`)
  console.log(`    ${pc.dim('hughmann')}                       ${pc.dim('# Start chatting')}`)
  console.log(`    ${pc.dim('hughmann morning')}                ${pc.dim('# Run morning dashboard')}`)
  console.log(`    ${pc.dim('hughmann run review')}             ${pc.dim('# Run weekly review')}`)
  console.log(`    ${pc.dim('hughmann status -q')}              ${pc.dim('# Quick status (quiet mode)')}`)
  console.log(`    ${pc.dim('hughmann chat -d omnissa')}        ${pc.dim('# Chat in Omnissa domain')}`)
  console.log(`    ${pc.dim('hughmann schedule install')}       ${pc.dim('# Auto-schedule daily routines')}`)
  console.log()
}
