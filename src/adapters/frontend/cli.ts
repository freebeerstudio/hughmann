import { createInterface } from 'node:readline'
import pc from 'picocolors'
import type { Runtime } from '../../runtime/runtime.js'

const GOLD = (text: string) => `\x1b[38;2;200;140;60m${text}\x1b[0m`
const DIM_COPPER = (text: string) => `\x1b[38;2;120;80;30m${text}\x1b[0m`

/**
 * readline-based CLI chat frontend.
 * Supports slash commands: /domain, /domains, /context, /reload, /clear, /help, /exit
 */
export async function startChatLoop(runtime: Runtime): Promise<void> {
  const systemName = runtime.context.config.systemName
  const ownerName = runtime.context.config.ownerName

  console.log()
  console.log(`  ${GOLD(systemName)} is online. ${DIM_COPPER(`Type /help for commands.`)}`)
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
        const active = d.slug === runtime.activeDomain ? pc.green(' ← active') : ''
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
      console.log()
      console.log(`  ${pc.bold('System')}: ${ctx.config.systemName}`)
      console.log(`  ${pc.bold('Owner')}: ${ctx.config.ownerName}`)
      console.log(`  ${pc.bold('Timezone')}: ${ctx.config.timezone}`)
      console.log(`  ${pc.bold('Domains')}: ${ctx.domains.size}`)
      console.log(`  ${pc.bold('Active domain')}: ${runtime.activeDomain ?? 'None'}`)
      console.log(`  ${pc.bold('Loaded at')}: ${ctx.loadedAt.toLocaleString()}`)
      console.log(`  ${pc.bold('Adapters')}: ${runtime.router.getAvailableAdapters().map(a => a.name).join(', ')}`)
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

    case '/clear': {
      runtime.clearHistory()
      console.log(`  ${pc.dim('Conversation history cleared.')}`)
      return
    }

    case '/help': {
      console.log()
      console.log(`  ${pc.bold('Commands')}:`)
      console.log(`    ${pc.cyan('/domain <name>')}  Switch to a domain context`)
      console.log(`    ${pc.cyan('/domain')}         Clear domain (general context)`)
      console.log(`    ${pc.cyan('/domains')}        List all domains with isolation status`)
      console.log(`    ${pc.cyan('/context')}        Show loaded context info`)
      console.log(`    ${pc.cyan('/reload')}         Re-read context documents from disk`)
      console.log(`    ${pc.cyan('/clear')}          Clear conversation history`)
      console.log(`    ${pc.cyan('/help')}           Show this help`)
      console.log(`    ${pc.cyan('/exit')}           Exit`)
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
