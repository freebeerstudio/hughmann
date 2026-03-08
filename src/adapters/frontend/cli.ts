import { createInterface } from 'node:readline'
import pc from 'picocolors'
import type { Runtime } from '../../runtime/runtime.js'
import type { Skill } from '../../runtime/skills.js'
import { StreamMarkdownRenderer } from '../../util/markdown.js'
import { generateWelcomeBriefing } from '../../runtime/welcome.js'
import { suppressStderr } from '../../util/logger.js'

const GOLD = (text: string) => `\x1b[38;2;200;140;60m${text}\x1b[0m`
const DIM_COPPER = (text: string) => `\x1b[38;2;120;80;30m${text}\x1b[0m`
const TOOL_ICON = '\u2699'  // ⚙
const CHECK_ICON = '\u2713' // ✓

// Store numbered session list for /resume by number
let lastSessionList: { id: string }[] = []

export async function startChatLoop(runtime: Runtime, firstBoot: boolean = false): Promise<void> {
  // Suppress Logger stderr output during interactive chat — errors still go to log files
  suppressStderr(true)

  const systemName = runtime.context.config.systemName
  const ownerName = runtime.context.config.ownerName

  // Smart session init: resume if recent, distill + fresh if stale
  const initResult = await runtime.initSession()

  console.log()
  if (firstBoot) {
    console.log(`  ${GOLD(systemName)} is online for the first time.`)
    console.log(`  ${pc.dim(`Say hello. ${systemName} already knows who you are.`)}`)
  } else {
    console.log(`  ${GOLD(systemName)} is online. ${DIM_COPPER(`Type /help for commands.`)}`)
    console.log(`  ${pc.dim(initResult.message)}`)
  }
  console.log()

  // Welcome briefing — quick update on last session + system changes
  if (!firstBoot) {
    try {
      const briefing = await generateWelcomeBriefing(runtime)
      if (briefing) {
        const md = new StreamMarkdownRenderer()
        process.stdout.write(`  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)
        const rendered = md.feed(briefing)
        if (rendered) process.stdout.write(rendered)
        const remaining = md.flush()
        if (remaining) process.stdout.write(remaining)
        process.stdout.write('\n\n')
      }
    } catch {
      // Best-effort — don't block chat startup
    }
  }

  // Start file watcher for auto-reload
  runtime.startWatching((result) => {
    console.log(`\n  ${pc.yellow('\u26a0')} ${pc.dim(`Context auto-reloaded: ${result.domainCount} domains, ${result.docCount} docs`)}`)
    for (const w of result.warnings) {
      console.log(`  ${pc.yellow('\u26a0')} ${pc.dim(w)}`)
    }
    prompt()
  })

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  const prompt = () => {
    const domainTag = runtime.activeDomain
      ? pc.dim(` [${runtime.context.domains.get(runtime.activeDomain)?.name ?? runtime.activeDomain}]`)
      : ''
    rl.setPrompt(`${pc.bold(ownerName)}${domainTag} ${pc.dim('>')} `)
    rl.prompt()
  }

  rl.on('close', async () => {
    // Clean up
    runtime.stopWatching()
    await runtime.distillCurrent()
    console.log()
    console.log(`  ${DIM_COPPER(`${systemName} signing off.`)}`)
    console.log()
    process.exit(0)
  })

  rl.on('line', async (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) {
      prompt()
      return
    }

    // Handle bare exit/quit commands (without /)
    const lower = trimmed.toLowerCase()
    if (lower === 'exit' || lower === 'quit' || lower === 'bye') {
      const session = runtime.getSessionInfo()
      if (session && session.messageCount > 0) {
        console.log(`  ${pc.dim('Distilling session...')}`)
        await runtime.distillCurrent()
      }
      console.log()
      console.log(`  ${DIM_COPPER(`${runtime.context.config.systemName} signing off.`)}`)
      console.log()
      process.exit(0)
    }

    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed, runtime)
      if (handled === 'exit') {
        // Distill before exiting
        const session = runtime.getSessionInfo()
        if (session && session.messageCount > 0) {
          console.log(`  ${pc.dim('Distilling session...')}`)
          await runtime.distillCurrent()
        }
        console.log()
        console.log(`  ${DIM_COPPER(`${runtime.context.config.systemName} signing off.`)}`)
        console.log()
        process.exit(0)
      }
      prompt()
      return
    }

    // Chat message
    try {
      process.stdout.write(`\n  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)

      const md = new StreamMarkdownRenderer()
      let hasOutput = false
      let hadToolUse = false
      for await (const chunk of runtime.chatStream(trimmed)) {
        switch (chunk.type) {
          case 'text': {
            if (!hasOutput && hadToolUse) {
              // First text after tool use — re-print Hugh's header
              console.log()
              process.stdout.write(`  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)
            }
            const rendered = md.feed(chunk.content)
            if (rendered) process.stdout.write(rendered)
            hasOutput = true
            break
          }
          case 'tool_use':
            if (hasOutput) {
              const flushed = md.flush()
              if (flushed) process.stdout.write(flushed)
              process.stdout.write('\n')
              hasOutput = false
            }
            console.log(`  ${pc.yellow(TOOL_ICON)} ${pc.dim(chunk.content)}`)
            hadToolUse = true
            break
          case 'tool_progress':
            break  // silent
          case 'status':
            console.log(`  ${pc.green(CHECK_ICON)} ${pc.dim(chunk.content)}`)
            break
          case 'error':
            console.error(pc.red(`\n  Error: ${chunk.content}`))
            break
          case 'done':
            break  // silent in chat
        }
      }

      const remaining = md.flush()
      if (remaining) process.stdout.write(remaining)
      if (hasOutput) {
        process.stdout.write('\n')
      }
      console.log()
    } catch (err) {
      console.error(pc.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`))
      console.log()
    }

    prompt()
  })

  prompt()
}

async function handleSlashCommand(input: string, runtime: Runtime): Promise<string | void> {
  const parts = input.split(/\s+/)
  const command = parts[0].toLowerCase()
  const args = parts.slice(1).join(' ').trim()

  switch (command) {
    case '/domain': {
      if (!args) {
        runtime.setDomain(null)
        console.log(`  ${pc.dim('Cleared domain. Back to general context.')}`)
        return
      }
      try {
        runtime.setDomain(args)
        const domain = runtime.context.domains.get(runtime.activeDomain!)
        console.log(`  ${pc.green('Switched to')} ${pc.bold(domain?.name ?? args)} ${pc.dim(`[${domain?.isolation}]`)}`)
      } catch (err) {
        console.error(`  ${pc.red(err instanceof Error ? err.message : String(err))}`)
      }
      return
    }

    case '/domains': {
      const domains = runtime.getAvailableDomains()
      console.log()
      for (const d of domains) {
        const active = d.slug === runtime.activeDomain ? pc.green(' \u2190 active') : ''
        const isolation = d.isolation === 'isolated'
          ? pc.yellow(`[isolated]`)
          : pc.blue(`[personal]`)
        console.log(`  ${pc.bold(d.name)} (${d.domainType}) ${isolation}${active}`)
      }
      console.log()
      return
    }

    case '/context': {
      const ctx = runtime.context
      const session = runtime.getSessionInfo()
      console.log()
      console.log(`  ${pc.bold('System')}: ${ctx.config.systemName}`)
      console.log(`  ${pc.bold('Owner')}: ${ctx.config.ownerName}`)
      console.log(`  ${pc.bold('Timezone')}: ${ctx.config.timezone}`)
      console.log(`  ${pc.bold('Domains')}: ${ctx.domains.size}`)
      console.log(`  ${pc.bold('Active domain')}: ${runtime.activeDomain ?? 'None'}`)
      console.log(`  ${pc.bold('Loaded at')}: ${ctx.loadedAt.toLocaleString()}`)
      console.log(`  ${pc.bold('Adapters')}: ${runtime.router.getAvailableAdapters().map(a => a.name).join(', ')}`)
      if (session) {
        console.log(`  ${pc.bold('Session')}: ${session.title} (${session.messageCount} messages)`)
      }
      console.log()
      return
    }

    case '/reload': {
      try {
        const result = runtime.reloadContext()
        console.log(`  ${pc.green('Context reloaded')} (${result.domainCount} domains, ${result.docCount} docs)`)
        for (const w of result.warnings) {
          console.log(`  ${pc.yellow('Warning')}: ${w}`)
        }
      } catch (err) {
        console.error(`  ${pc.red('Reload failed')}: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }

    case '/new': {
      const session = runtime.getSessionInfo()
      if (session && session.messageCount > 0) {
        console.log(`  ${pc.dim('Distilling current session...')}`)
        await runtime.clearAndDistill()
        console.log(`  ${pc.green('Session distilled. New session started.')}`)
      } else {
        runtime.clearHistory()
        console.log(`  ${pc.green('New session started.')}`)
      }
      return
    }

    case '/sessions': {
      const sessions = runtime.listSessions()
      if (sessions.length === 0) {
        console.log(`  ${pc.dim('No past sessions.')}`)
        return
      }
      console.log()
      const current = runtime.getSessionInfo()
      lastSessionList = sessions.slice(0, 10)
      for (let i = 0; i < lastSessionList.length; i++) {
        const s = sessions[i]
        const num = pc.bold(`${i + 1}.`)
        const active = current && s.id === current.id ? pc.green(' \u2190 active') : ''
        const domain = s.domain ? pc.dim(` [${s.domain}]`) : ''
        const date = new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const msgs = pc.dim(`${s.messageCount} msgs`)
        console.log(`  ${num} ${pc.bold(s.title)}${domain} ${pc.dim('\u2014')} ${date}, ${msgs}${active}`)
      }
      if (sessions.length > 10) {
        console.log(`  ${pc.dim(`...and ${sessions.length - 10} more`)}`)
      }
      console.log()
      console.log(`  ${pc.dim('Use /resume <number> to switch sessions')}`)
      console.log()
      return
    }

    case '/resume': {
      if (!args) {
        console.log(`  ${pc.dim('Usage: /resume <number> or /resume <session-id>')}`)
        console.log(`  ${pc.dim('Use /sessions to see available sessions')}`)
        return
      }

      // Support numbered resume from /sessions list
      const num = parseInt(args, 10)
      let targetId: string | undefined

      if (!isNaN(num) && num >= 1 && num <= lastSessionList.length) {
        targetId = lastSessionList[num - 1].id
      } else {
        // Partial ID match
        const sessions = runtime.listSessions()
        const match = sessions.find(s => s.id === args || s.id.startsWith(args))
        targetId = match?.id
      }

      if (!targetId) {
        console.log(`  ${pc.red('No session found matching:')} ${args}`)
        return
      }

      // Distill current session before switching
      const currentSession = runtime.getSessionInfo()
      if (currentSession && currentSession.messageCount > 0 && currentSession.id !== targetId) {
        await runtime.distillCurrent()
      }

      const success = runtime.resumeSession(targetId)
      if (success) {
        const info = runtime.getSessionInfo()
        console.log(`  ${pc.green('Resumed')}: ${info?.title} (${info?.messageCount} messages)`)
      } else {
        console.log(`  ${pc.red('Failed to resume session')}`)
      }
      return
    }

    case '/distill': {
      const session = runtime.getSessionInfo()
      if (!session || session.messageCount < 2) {
        console.log(`  ${pc.dim('Nothing to distill (session is empty or too short).')}`)
        return
      }
      console.log(`  ${pc.dim('Distilling...')}`)
      const result = await runtime.distillCurrent()
      if (result) {
        console.log(`  ${pc.green('Memory saved.')}`)
      } else {
        console.log(`  ${pc.yellow('Distillation produced no output.')}`)
      }
      return
    }

    case '/memory': {
      const memories = runtime.memory.getRecentMemories(3)
      if (!memories) {
        console.log(`  ${pc.dim('No memories yet. Memories are created when sessions are distilled.')}`)
      } else {
        console.log()
        console.log(memories)
      }
      return
    }

    case '/usage': {
      if (!runtime.usage) {
        console.log(`  ${pc.dim('Usage tracking not available.')}`)
        return
      }
      const summary = runtime.usage.getSummary()
      console.log()
      console.log(`  ${pc.bold('Usage')}:`)
      console.log(`    Today:  ${pc.cyan(summary.today.calls + ' calls')}  ${pc.dim('$' + summary.today.costUsd.toFixed(4))}`)
      console.log(`    Week:   ${pc.cyan(summary.week.calls + ' calls')}  ${pc.dim('$' + summary.week.costUsd.toFixed(4))}`)
      console.log(`    Month:  ${pc.cyan(summary.month.calls + ' calls')}  ${pc.dim('$' + summary.month.costUsd.toFixed(4))}`)

      const limits = runtime.usage.getLimits()
      console.log()
      console.log(`  ${pc.bold('Limits')}: ${pc.dim(`$${limits.dailyUsd}/day, $${limits.monthlyUsd}/month`)}`)

      const domainEntries = Object.entries(summary.byDomain).sort((a, b) => b[1].costUsd - a[1].costUsd)
      if (domainEntries.length > 0) {
        console.log()
        console.log(`  ${pc.bold('By Domain')}:`)
        for (const [domain, data] of domainEntries) {
          console.log(`    ${domain}: ${pc.dim('$' + data.costUsd.toFixed(4))}`)
        }
      }
      console.log()
      return
    }

    case '/clear': {
      runtime.clearHistory()
      console.log(`  ${pc.green('New session started.')} ${pc.dim('(Previous session not distilled. Use /new to distill first.)')}`)
      return
    }

    case '/log': {
      const pipeParts = args.split('|').map(s => s.trim())
      if (pipeParts.length < 2) {
        console.log(`  ${pc.dim('Usage: /log <decision> | <reasoning> | <domain>')}`)
        console.log(`  ${pc.dim('Example: /log Chose Supabase for data | Best combo of features and price | Free Beer Studio')}`)
        return
      }
      const [decision, reasoning, domain] = pipeParts
      const ok = runtime.writer.logDecision(decision, reasoning ?? '', domain ?? 'General')
      if (ok) {
        runtime.reloadContext()
        console.log(`  ${pc.green('Decision logged')} to master-plan.md`)
      } else {
        console.log(`  ${pc.red('Failed to log decision')} (master-plan.md not found or table missing)`)
      }
      return
    }

    case '/note': {
      if (!args) {
        console.log(`  ${pc.dim('Usage: /note <text>')}`)
        console.log(`  ${pc.dim('Appends a note to the active domain document. Set domain first with /domain.')}`)
        return
      }
      if (!runtime.activeDomain) {
        console.log(`  ${pc.yellow('No active domain.')} Use ${pc.cyan('/domain <name>')} first.`)
        return
      }
      const ok = runtime.writer.appendDomainNote(runtime.activeDomain, args)
      if (ok) {
        runtime.reloadContext()
        console.log(`  ${pc.green('Note added')} to ${runtime.activeDomain}.md`)
      } else {
        console.log(`  ${pc.red('Failed to add note')} (domain doc not found)`)
      }
      return
    }

    case '/gap': {
      if (!args) {
        console.log(`  ${pc.dim('Usage: /gap <capability needed>')}`)
        console.log(`  ${pc.dim('Example: /gap Send emails via Gmail API')}`)
        return
      }
      const ok = runtime.writer.logCapabilityGap(args)
      if (ok) {
        runtime.reloadContext()
        console.log(`  ${pc.green('Capability gap logged')} to capabilities.md`)
      } else {
        console.log(`  ${pc.red('Failed to log gap')} (capabilities.md not found or table missing)`)
      }
      return
    }

    case '/mcp': {
      const servers = runtime.mcpServers
      const names = Object.keys(servers)
      if (names.length === 0) {
        console.log(`  ${pc.dim('No MCP servers configured.')}`)
        console.log(`  ${pc.dim('Add servers to ~/.hughmann/mcp.json to enable external tools.')}`)
        console.log()
        console.log(`  ${pc.dim('Example mcp.json:')}`)
        console.log(`  ${pc.dim('{')}`)
        console.log(`  ${pc.dim('  "servers": {')}`)
        console.log(`  ${pc.dim('    "filesystem": {')}`)
        console.log(`  ${pc.dim('      "command": "npx",')}`)
        console.log(`  ${pc.dim('      "args": ["-y", "@anthropic-ai/filesystem-mcp", "/path/to/dir"]')}`)
        console.log(`  ${pc.dim('    }')}`)
        console.log(`  ${pc.dim('  }')}`)
        console.log(`  ${pc.dim('}')}`)
      } else {
        console.log()
        console.log(`  ${pc.bold('MCP Servers')} (${names.length}):`)
        for (const name of names) {
          const server = servers[name]
          const transport = server.type === 'sse' ? 'SSE' : 'stdio'
          const cmd = server.command + (server.args ? ' ' + server.args.join(' ') : '')
          console.log(`  ${pc.green('\u2022')} ${pc.bold(name)} ${pc.dim(`[${transport}]`)} ${pc.dim(cmd)}`)
        }
        console.log()
        console.log(`  ${pc.dim('These servers are available when using /do tasks.')}`)
      }
      console.log()
      return
    }

    case '/tasks': {
      if (!runtime.data) {
        console.log(`  ${pc.dim('No data adapter configured. Tasks require a database.')}`)
        return
      }

      if (args.startsWith('create ')) {
        const title = args.replace('create ', '').trim()
        if (!title) {
          console.log(`  ${pc.dim('Usage: /tasks create <title>')}`)
          return
        }
        const task = await runtime.data.createTask({ title, domain: runtime.activeDomain ?? undefined })
        console.log(`  ${pc.green('\u2713')} Created: ${task.title} ${pc.dim(`(${task.id.slice(0, 8)})`)}`)
        return
      }

      if (args.startsWith('done ')) {
        const id = args.replace('done ', '').trim()
        const allTasks = await runtime.data.listTasks()
        const match = allTasks.find(t => t.id.startsWith(id))
        if (!match) {
          console.log(`  ${pc.red('No task found matching')}: ${id}`)
          return
        }
        const task = await runtime.data.completeTask(match.id)
        if (task) console.log(`  ${pc.green('\u2713')} Completed: ${task.title}`)
        return
      }

      // Default: list active tasks
      const tasks = await runtime.data.listTasks({ status: ['todo', 'in_progress', 'blocked'] })
      if (tasks.length === 0) {
        console.log(`  ${pc.dim('No active tasks. Use /tasks create <title> to add one.')}`)
        return
      }
      console.log()
      for (const t of tasks) {
        const status = t.status === 'in_progress' ? pc.yellow('\u25b6')
          : t.status === 'blocked' ? pc.red('\u2716')
          : pc.green('\u25cb')
        const type = t.task_type !== 'standard' ? pc.cyan(`[${t.task_type}]`) : ''
        const domain = t.domain ? pc.dim(`(${t.domain})`) : ''
        console.log(`  ${status} ${type} ${t.title} ${domain} ${pc.dim(t.id.slice(0, 8))}`)
      }
      console.log()
      return
    }

    case '/projects': {
      if (!runtime.data) {
        console.log(`  ${pc.dim('No data adapter configured. Projects require a database.')}`)
        return
      }

      const projects = await runtime.data.listProjects({ status: ['planning', 'active', 'paused'] })
      if (projects.length === 0) {
        console.log(`  ${pc.dim('No projects yet. Use /focus to start a planning session and create projects.')}`)
        return
      }

      // Group by domain
      const grouped = new Map<string, typeof projects>()
      for (const p of projects) {
        const domain = p.domain ?? 'general'
        const group = grouped.get(domain) ?? []
        group.push(p)
        grouped.set(domain, group)
      }

      console.log()
      for (const [domain, group] of grouped) {
        const domainCtx = runtime.context.domains.get(domain)
        const label = domainCtx?.name ?? domain
        console.log(`  ${pc.bold(label)}:`)
        for (const p of group) {
          const status = p.status === 'active' ? pc.green(`[active]`)
            : p.status === 'planning' ? pc.blue(`[planning]`)
            : pc.yellow(`[${p.status}]`)
          const guardrailCount = (p.guardrails?.length ?? 0) > 0 ? pc.dim(` (${p.guardrails!.length} guardrails)`) : ''
          console.log(`    ${status} ${p.name}${guardrailCount} ${pc.dim(p.id.slice(0, 8))}`)
        }
      }
      console.log()
      return
    }

    case '/do': {
      if (!args) {
        console.log(`  ${pc.dim('Usage: /do <task description>')}`)
        console.log(`  ${pc.dim('Example: /do Create a summary of my Omnissa domain goals')}`)
        console.log(`  ${pc.dim('Example: /do Search the web for the latest MDM trends and write a report')}`)
        return
      }

      const systemName = runtime.context.config.systemName
      console.log()
      console.log(`  ${GOLD(systemName)} ${pc.dim('is working on:')} ${pc.bold(args)}`)
      console.log(`  ${pc.dim('Using Opus with tools. This may take a moment...')}`)
      console.log()

      try {
        let hasText = false
        let lastToolName: string | null = null
        const md = new StreamMarkdownRenderer()

        for await (const chunk of runtime.doTaskStream(args)) {
          switch (chunk.type) {
            case 'tool_use': {
              if (hasText) {
                const flushed = md.flush()
                if (flushed) process.stdout.write(flushed)
                process.stdout.write('\n')
                hasText = false
              }
              lastToolName = chunk.metadata?.toolName ?? null
              console.log(`  ${pc.yellow(TOOL_ICON)} ${pc.dim(chunk.content)}`)
              break
            }
            case 'tool_progress': break
            case 'status': {
              console.log(`  ${pc.green(CHECK_ICON)} ${pc.dim(chunk.content)}`)
              break
            }
            case 'text': {
              if (!hasText && lastToolName) {
                console.log()
                process.stdout.write(`  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)
                lastToolName = null
              } else if (!hasText) {
                process.stdout.write(`  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)
              }
              const rendered = md.feed(chunk.content)
              if (rendered) process.stdout.write(rendered)
              hasText = true
              break
            }
            case 'error': {
              console.error(pc.red(`\n  Error: ${chunk.content}`))
              break
            }
            case 'done': {
              const flushed = md.flush()
              if (flushed) process.stdout.write(flushed)
              if (hasText) process.stdout.write('\n')
              const turns = chunk.metadata?.turnCount
              const cost = chunk.metadata?.costUsd
              const stats: string[] = []
              if (turns) stats.push(`${turns} turns`)
              if (cost !== undefined) stats.push(`$${cost.toFixed(4)}`)
              if (stats.length > 0) {
                console.log()
                console.log(`  ${pc.dim(`Task complete (${stats.join(', ')})`)}`)
              }
              break
            }
          }
        }
        console.log()
      } catch (err) {
        console.error(pc.red(`\n  Task failed: ${err instanceof Error ? err.message : String(err)}`))
        console.log()
      }
      return
    }

    case '/parallel': {
      if (!args) {
        console.log(`  ${pc.dim('Usage: /parallel <complex task description>')}`)
        console.log(`  ${pc.dim('Decomposes the task into sub-agents and runs them in parallel.')}`)
        return
      }

      const systemName2 = runtime.context.config.systemName
      console.log()
      console.log(`  ${GOLD(systemName2)} ${pc.dim('decomposing and parallelizing:')} ${pc.bold(args)}`)
      console.log()

      try {
        const md = new StreamMarkdownRenderer()
        for await (const chunk of runtime.decomposeAndRun(args)) {
          switch (chunk.type) {
            case 'status':
              console.log(`  ${pc.green(CHECK_ICON)} ${pc.dim(chunk.content)}`)
              break
            case 'tool_use':
              console.log(`  ${pc.yellow(TOOL_ICON)} ${pc.dim(chunk.content)}`)
              break
            case 'text': {
              const rendered = md.feed(chunk.content)
              if (rendered) process.stdout.write(rendered)
              break
            }
            case 'error':
              console.error(`  ${pc.red(chunk.content)}`)
              break
            case 'done': {
              const flushed = md.flush()
              if (flushed) process.stdout.write(flushed)
              break
            }
          }
        }
        console.log()
      } catch (err) {
        console.error(pc.red(`\n  Parallel task failed: ${err instanceof Error ? err.message : String(err)}`))
      }
      return
    }

    case '/skills': {
      const builtins = runtime.skills.listBuiltin()
      const custom = runtime.skills.listCustom()

      console.log()
      console.log(`  ${pc.bold('Built-in Skills')}:`)
      for (const s of builtins) {
        console.log(`    ${pc.cyan('/' + s.id)}${' '.repeat(Math.max(1, 18 - s.id.length))}${s.description}`)
      }

      if (custom.length > 0) {
        console.log()
        console.log(`  ${pc.bold('Custom Skills')}:`)
        for (const s of custom) {
          console.log(`    ${pc.cyan('/' + s.id)}${' '.repeat(Math.max(1, 18 - s.id.length))}${s.description}`)
        }
      }

      console.log()
      console.log(`  ${pc.dim('Add custom skills to ~/.hughmann/skills/ as directories with SKILL.md.')}`)
      console.log()
      return
    }

    case '/help': {
      console.log()
      console.log(`  ${pc.bold('Conversation')}:`)
      console.log(`    ${pc.cyan('/new')}              Distill current session and start fresh`)
      console.log(`    ${pc.cyan('/sessions')}         List past sessions (numbered)`)
      console.log(`    ${pc.cyan('/resume <#>')}       Resume a session by number or ID`)
      console.log(`    ${pc.cyan('/clear')}            Start fresh without distilling`)
      console.log()
      console.log(`  ${pc.bold('Autonomous')}:`)
      console.log(`    ${pc.cyan('/do <task>')}        Execute a task with tools ${pc.dim('(Opus + file/shell/web/MCP)')}`)
      console.log(`    ${pc.cyan('/parallel <task>')}  Decompose into sub-agents and run in parallel`)
      console.log(`    ${pc.cyan('/tasks')}            List active tasks ${pc.dim('(create <title> | done <id>)')}`)
      console.log(`    ${pc.cyan('/projects')}         List active projects grouped by domain`)
      console.log(`    ${pc.cyan('/skills')}           List all available skills`)
      console.log(`    ${pc.cyan('/mcp')}              List configured MCP servers`)
      console.log()
      console.log(`  ${pc.bold('Memory')}:`)
      console.log(`    ${pc.cyan('/distill')}          Extract learnings from current session`)
      console.log(`    ${pc.cyan('/memory')}           Show recent memories (last 3 days)`)
      console.log(`    ${pc.cyan('/usage')}            Show usage stats and costs`)
      console.log()
      console.log(`  ${pc.bold('Domains')}:`)
      console.log(`    ${pc.cyan('/domain <name>')}    Switch to a domain context`)
      console.log(`    ${pc.cyan('/domain')}           Clear domain (general context)`)
      console.log(`    ${pc.cyan('/domains')}          List all domains with isolation status`)
      console.log()
      console.log(`  ${pc.bold('Context Updates')}:`)
      console.log(`    ${pc.cyan('/log')}              Log a decision ${pc.dim('(decision | reasoning | domain)')}`)
      console.log(`    ${pc.cyan('/note')}             Add a note to active domain`)
      console.log(`    ${pc.cyan('/gap')}              Log a capability gap`)
      console.log()
      console.log(`  ${pc.bold('System')}:`)
      console.log(`    ${pc.cyan('/context')}          Show loaded context info`)
      console.log(`    ${pc.cyan('/reload')}           Re-read context documents from disk ${pc.dim('(also auto-reloads)')}`)
      console.log(`    ${pc.cyan('/help')}             Show this help`)
      console.log(`    ${pc.cyan('/exit')}             Distill and exit`)
      console.log()
      return
    }

    case '/exit':
    case '/quit': {
      return 'exit'
    }

    default: {
      // Check if command matches a skill
      const skillId = command.slice(1) // remove leading /
      const skill = runtime.skills.get(skillId)

      if (skill) {
        return await runSkill(skill, runtime, args)
      }

      console.log(`  ${pc.dim(`Unknown command: ${command}. Type /help or /skills for available commands.`)}`)
      return
    }
  }
}

/**
 * Execute a skill. Always uses doTaskStream — tools available, model chooses whether to use them.
 */
async function runSkill(skill: Skill, runtime: Runtime, extraArgs: string): Promise<void> {
  const systemName = runtime.context.config.systemName

  // Auto-switch domain if the skill specifies one
  const previousDomain = runtime.activeDomain
  if (skill.domain) {
    try {
      runtime.setDomain(skill.domain)
    } catch {
      // Domain doesn't exist, proceed without switching
    }
  }

  // Build the prompt — skill prompt + any extra args the user passed
  let prompt = skill.prompt
  if (extraArgs) {
    prompt += `\n\nAdditional context from user: ${extraArgs}`
  }

  console.log()
  console.log(`  ${GOLD(systemName)} ${pc.dim('running skill:')} ${pc.bold(skill.name)}`)
  console.log()

  try {
    let hasText = false
    let lastToolName: string | null = null
    const md = new StreamMarkdownRenderer()

    for await (const chunk of runtime.doTaskStream(prompt)) {
      switch (chunk.type) {
        case 'tool_use': {
          if (hasText) {
            const flushed = md.flush()
            if (flushed) process.stdout.write(flushed)
            process.stdout.write('\n')
            hasText = false
          }
          lastToolName = chunk.metadata?.toolName ?? null
          console.log(`  ${pc.yellow(TOOL_ICON)} ${pc.dim(chunk.content)}`)
          break
        }
        case 'tool_progress': break
        case 'status': {
          console.log(`  ${pc.green(CHECK_ICON)} ${pc.dim(chunk.content)}`)
          break
        }
        case 'text': {
          if (!hasText && lastToolName) {
            console.log()
            process.stdout.write(`  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)
            lastToolName = null
          } else if (!hasText) {
            process.stdout.write(`  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)
          }
          const rendered = md.feed(chunk.content)
          if (rendered) process.stdout.write(rendered)
          hasText = true
          break
        }
        case 'error': {
          console.error(pc.red(`\n  Error: ${chunk.content}`))
          break
        }
        case 'done': {
          const flushed = md.flush()
          if (flushed) process.stdout.write(flushed)
          if (hasText) process.stdout.write('\n')
          const turns = chunk.metadata?.turnCount
          const cost = chunk.metadata?.costUsd
          const stats: string[] = []
          if (turns) stats.push(`${turns} turns`)
          if (cost !== undefined) stats.push(`$${cost.toFixed(4)}`)
          if (stats.length > 0) {
            console.log()
            console.log(`  ${pc.dim(`Skill complete (${stats.join(', ')})`)}`)
          }
          break
        }
      }
    }
    console.log()
  } catch (err) {
    console.error(pc.red(`\n  Skill failed: ${err instanceof Error ? err.message : String(err)}`))
    console.log()
  }

  // Restore domain if we auto-switched
  if (skill.domain && previousDomain !== runtime.activeDomain) {
    runtime.setDomain(previousDomain)
  }
}
