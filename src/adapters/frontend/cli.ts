import { createInterface } from 'node:readline'
import pc from 'picocolors'
import type { Runtime } from '../../runtime/runtime.js'

const GOLD = (text: string) => `\x1b[38;2;200;140;60m${text}\x1b[0m`
const DIM_COPPER = (text: string) => `\x1b[38;2;120;80;30m${text}\x1b[0m`

/**
 * readline-based CLI chat frontend.
 */
export async function startChatLoop(runtime: Runtime): Promise<void> {
  const systemName = runtime.context.config.systemName
  const ownerName = runtime.context.config.ownerName

  // Resume latest session or start a new one
  const resumed = runtime.resumeLatest()
  const sessionInfo = runtime.getSessionInfo()

  console.log()
  console.log(`  ${GOLD(systemName)} is online. ${DIM_COPPER(`Type /help for commands.`)}`)
  if (resumed && sessionInfo && sessionInfo.messageCount > 0) {
    console.log(`  ${pc.dim(`Resumed session: ${sessionInfo.title} (${sessionInfo.messageCount} messages)`)}`)
  } else {
    console.log(`  ${pc.dim('New session started.')}`)
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

  rl.on('close', () => {
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

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const handled = handleSlashCommand(trimmed, runtime)
      if (handled === 'exit') {
        rl.close()
        return
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

function handleSlashCommand(input: string, runtime: Runtime): string | void {
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
        if (result.warnings.length > 0) {
          for (const w of result.warnings) {
            console.log(`  ${pc.yellow('Warning')}: ${w}`)
          }
        }
      } catch (err) {
        console.error(`  ${pc.red('Reload failed')}: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }

    case '/new': {
      runtime.clearHistory()
      console.log(`  ${pc.green('New session started.')}`)
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
      for (const s of sessions.slice(0, 10)) {
        const active = current && s.id === current.id ? pc.green(' \u2190 active') : ''
        const domain = s.domain ? pc.dim(` [${s.domain}]`) : ''
        const date = new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const msgs = pc.dim(`${s.messageCount} msgs`)
        console.log(`  ${pc.bold(s.title)}${domain} ${pc.dim('\u2014')} ${date}, ${msgs}${active}`)
        console.log(`  ${pc.dim(s.id)}`)
      }
      if (sessions.length > 10) {
        console.log(`  ${pc.dim(`...and ${sessions.length - 10} more`)}`)
      }
      console.log()
      console.log(`  ${pc.dim('Use /resume <id> to switch sessions')}`)
      console.log()
      return
    }

    case '/resume': {
      if (!args) {
        console.log(`  ${pc.dim('Usage: /resume <session-id>')}`)
        console.log(`  ${pc.dim('Use /sessions to see available sessions')}`)
        return
      }
      // Support partial ID matching
      const sessions = runtime.listSessions()
      const match = sessions.find(s => s.id === args || s.id.startsWith(args))
      if (!match) {
        console.log(`  ${pc.red('No session found matching:')} ${args}`)
        return
      }
      const success = runtime.resumeSession(match.id)
      if (success) {
        const info = runtime.getSessionInfo()
        console.log(`  ${pc.green('Resumed')}: ${info?.title} (${info?.messageCount} messages)`)
      } else {
        console.log(`  ${pc.red('Failed to resume session')}`)
      }
      return
    }

    case '/clear': {
      runtime.clearHistory()
      console.log(`  ${pc.green('New session started.')}`)
      return
    }

    case '/log': {
      // /log <decision> | <reasoning> | <domain>
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
      // /note <text> — append to active domain's notes
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
      // /gap <capability> — log a capability gap
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

    case '/help': {
      console.log()
      console.log(`  ${pc.bold('Conversation')}:`)
      console.log(`    ${pc.cyan('/new')}              Start a new session`)
      console.log(`    ${pc.cyan('/sessions')}         List past sessions`)
      console.log(`    ${pc.cyan('/resume <id>')}      Resume a previous session`)
      console.log(`    ${pc.cyan('/clear')}            Start a new session (alias for /new)`)
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
      console.log(`    ${pc.cyan('/exit')}             Exit`)
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
