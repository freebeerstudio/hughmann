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
    const { getMigrationSQL } = await import('./adapters/data/supabase.js')
    console.log(getMigrationSQL())
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
  console.log(`    ${pc.cyan('schedule')}          Manage scheduled skills ${pc.dim('(launchd)')}`)
  console.log(`    ${pc.cyan('telegram')}          Start Telegram bot`)
  console.log(`    ${pc.cyan('serve')}             Start as MCP server ${pc.dim('(stdio)')}`)
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
