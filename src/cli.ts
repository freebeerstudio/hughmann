import pc from 'picocolors'
import { showBanner } from './banner.js'

const command = process.argv[2]

switch (command) {
  case 'setup': {
    // Run the existing onboarding flow
    await import('./index.js')
    break
  }

  case 'chat':
  case undefined: {
    // Default: start chat
    await startChat()
    break
  }

  default: {
    showUsage()
    break
  }
}

async function startChat() {
  showBanner()

  const { boot } = await import('./runtime/boot.js')
  const result = boot()

  // Show warnings
  for (const warning of result.warnings) {
    console.log(`  ${pc.yellow('⚠')} ${pc.dim(warning)}`)
  }

  // Show errors and exit if boot failed
  if (!result.success || !result.runtime) {
    console.log()
    for (const error of result.errors) {
      console.log(`  ${pc.red('✗')} ${error}`)
    }
    console.log()
    process.exit(1)
  }

  if (result.warnings.length > 0) {
    console.log()
  }

  // Start CLI chat loop
  const { startChatLoop } = await import('./adapters/frontend/cli.js')
  await startChatLoop(result.runtime)
}

function showUsage() {
  showBanner()
  console.log(`  ${pc.bold('Usage')}: hughmann [command]`)
  console.log()
  console.log(`  ${pc.bold('Commands')}:`)
  console.log(`    ${pc.cyan('chat')}    Start a conversation (default)`)
  console.log(`    ${pc.cyan('setup')}   Run onboarding / configuration`)
  console.log()
}
