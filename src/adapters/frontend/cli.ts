import { createInterface } from 'node:readline'
import pc from 'picocolors'
import type { Runtime } from '../../runtime/runtime.js'

const GOLD = (text: string) => `\x1b[38;2;200;140;60m${text}\x1b[0m`
const DIM_COPPER = (text: string) => `\x1b[38;2;120;80;30m${text}\x1b[0m`
const TOOL_ICON = '\u2699'  // ⚙
const CHECK_ICON = '\u2713' // ✓

// Store numbered session list for /resume by number
let lastSessionList: { id: string }[] = []

export async function startChatLoop(runtime: Runtime, firstBoot: boolean = false): Promise<void> {
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
    // Distill on exit
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

      let hasOutput = false
      for await (const chunk of runtime.chatStream(trimmed)) {
        if (chunk.type === 'text') {
          process.stdout.write(chunk.content)
          hasOutput = true
        } else if (chunk.type === 'error') {
          console.error(pc.red(`\n  Error: ${chunk.content}`))
        }
      }

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

        for await (const chunk of runtime.doTaskStream(args)) {
          switch (chunk.type) {
            case 'tool_use': {
              // Show tool being invoked
              if (hasText) {
                process.stdout.write('\n')
                hasText = false
              }
              lastToolName = chunk.metadata?.toolName ?? null
              console.log(`  ${pc.yellow(TOOL_ICON)} ${pc.dim(chunk.content)}`)
              break
            }
            case 'tool_progress': {
              // Show tool progress (subtle)
              break
            }
            case 'status': {
              console.log(`  ${pc.green(CHECK_ICON)} ${pc.dim(chunk.content)}`)
              break
            }
            case 'text': {
              if (!hasText && lastToolName) {
                // Transition from tool use to text output
                console.log()
                process.stdout.write(`  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)
                lastToolName = null
              } else if (!hasText) {
                process.stdout.write(`  ${GOLD(systemName)} ${pc.dim('>')}\n\n`)
              }
              process.stdout.write(chunk.content)
              hasText = true
              break
            }
            case 'error': {
              console.error(pc.red(`\n  Error: ${chunk.content}`))
              break
            }
            case 'done': {
              if (hasText) {
                process.stdout.write('\n')
              }
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

    case '/help': {
      console.log()
      console.log(`  ${pc.bold('Conversation')}:`)
      console.log(`    ${pc.cyan('/new')}              Distill current session and start fresh`)
      console.log(`    ${pc.cyan('/sessions')}         List past sessions (numbered)`)
      console.log(`    ${pc.cyan('/resume <#>')}       Resume a session by number or ID`)
      console.log(`    ${pc.cyan('/clear')}            Start fresh without distilling`)
      console.log()
      console.log(`  ${pc.bold('Autonomous')}:`)
      console.log(`    ${pc.cyan('/do <task>')}        Execute a task with tools ${pc.dim('(Opus + file/shell/web)')}`)
      console.log()
      console.log(`  ${pc.bold('Memory')}:`)
      console.log(`    ${pc.cyan('/distill')}          Extract learnings from current session`)
      console.log(`    ${pc.cyan('/memory')}           Show recent memories (last 3 days)`)
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
      console.log(`    ${pc.cyan('/reload')}           Re-read context documents from disk`)
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
      console.log(`  ${pc.dim(`Unknown command: ${command}. Type /help for available commands.`)}`)
      return
    }
  }
}
