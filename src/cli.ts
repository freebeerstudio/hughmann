import pc from 'picocolors'
import { showBanner } from './banner.js'

interface CliFlags {
  command: string
  continue: boolean
  new: boolean
  domain: string | null
}

function parseArgs(): CliFlags {
  const args = process.argv.slice(2)
  const flags: CliFlags = {
    command: 'chat',
    continue: false,
    new: false,
    domain: null,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === 'setup' || arg === 'chat') {
      flags.command = arg
    } else if (arg === '-c' || arg === '--continue') {
      flags.continue = true
    } else if (arg === '-n' || arg === '--new') {
      flags.new = true
    } else if (arg === '-d' || arg === '--domain') {
      flags.domain = args[++i] ?? null
    } else if (arg === '-h' || arg === '--help') {
      flags.command = 'help'
    } else if (!arg.startsWith('-')) {
      flags.command = arg
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

  case 'help': {
    showUsage()
    break
  }

  default: {
    showUsage()
    break
  }
}

async function startChat(flags: CliFlags) {
  showBanner()

  const { boot } = await import('./runtime/boot.js')
  const result = boot()

  // Show warnings
  for (const warning of result.warnings) {
    console.log(`  ${pc.yellow('\u26a0')} ${pc.dim(warning)}`)
  }

  // Show errors and exit if boot failed
  if (!result.success || !result.runtime) {
    console.log()
    for (const error of result.errors) {
      console.log(`  ${pc.red('\u2717')} ${error}`)
    }
    console.log()
    process.exit(1)
  }

  if (result.warnings.length > 0) {
    console.log()
  }

  // Set domain if provided via flag
  if (flags.domain) {
    try {
      result.runtime.setDomain(flags.domain)
    } catch (err) {
      console.log(`  ${pc.red('\u2717')} ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  // Handle session: --new forces fresh, --continue resumes, default resumes latest
  if (flags.new) {
    result.runtime.clearHistory()
  }
  // If --continue or default behavior, the CLI frontend handles resume on its own

  // Start CLI chat loop
  const { startChatLoop } = await import('./adapters/frontend/cli.js')
  await startChatLoop(result.runtime)
}

function showUsage() {
  showBanner()
  console.log(`  ${pc.bold('Usage')}: hughmann [command] [flags]`)
  console.log()
  console.log(`  ${pc.bold('Commands')}:`)
  console.log(`    ${pc.cyan('chat')}              Start a conversation ${pc.dim('(default)')}`)
  console.log(`    ${pc.cyan('setup')}             Run onboarding / configuration`)
  console.log()
  console.log(`  ${pc.bold('Flags')}:`)
  console.log(`    ${pc.cyan('-c, --continue')}    Resume the most recent session`)
  console.log(`    ${pc.cyan('-n, --new')}         Start a fresh session`)
  console.log(`    ${pc.cyan('-d, --domain')}      Set active domain ${pc.dim('(e.g. -d omnissa)')}`)
  console.log(`    ${pc.cyan('-h, --help')}        Show this help`)
  console.log()
}
