#!/usr/bin/env node
import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { showBanner } from './banner.js'
import { runOnboarding } from './onboarding/index.js'
import { generateContextDocuments } from './generators/context-docs.js'
import { HUGHMANN_HOME } from './config.js'
import { homedir } from 'node:os'

const GOLD = (text: string) => `\x1b[38;2;200;140;60m${text}\x1b[0m`

async function main() {
  showBanner()

  const result = await runOnboarding()

  // User exited without completing — config is already saved per-section
  if (!result) return

  // Generate context documents to ~/.hughmann/context/
  const contextDir = join(HUGHMANN_HOME, 'context')
  const spinner = p.spinner()
  spinner.start('Generating context documents...')

  const files = generateContextDocuments(result, contextDir)

  spinner.stop('Context documents generated')

  // Show what was created
  const displayHome = HUGHMANN_HOME.replace(homedir(), '~')
  console.log()
  p.note(
    files.map(f => {
      const relative = f.replace(HUGHMANN_HOME, displayHome)
      return `  ${pc.green('+')} ${relative}`
    }).join('\n'),
    'Files Created'
  )

  console.log()
  console.log(`  ${GOLD(result.system.name)} knows who you are.`)
  console.log()
  console.log(`  Your context documents are in ${pc.cyan(displayHome + '/context/')}`)
  console.log(`  These are plain markdown. Review and edit them anytime.`)
  console.log()

  // Offer to launch first conversation
  const startChat = await p.confirm({
    message: `Start your first conversation with ${result.system.name}?`,
    initialValue: true,
  })

  if (p.isCancel(startChat) || !startChat) {
    console.log()
    console.log(`  ${pc.dim('When you\'re ready, run:')} ${pc.cyan('hughmann chat')}`)
    console.log()
    p.outro(`${result.system.name} will be here.`)
    return
  }

  // Boot and launch chat
  console.log()
  const { boot } = await import('./runtime/boot.js')
  const bootResult = await boot()

  if (!bootResult.success || !bootResult.runtime) {
    console.log()
    for (const error of bootResult.errors) {
      console.log(`  ${pc.red('\u2717')} ${error}`)
    }
    console.log()
    console.log(`  ${pc.dim('Fix the above and run:')} ${pc.cyan('hughmann chat')}`)
    return
  }

  // Mark this as first boot so Hugh Mann introduces itself
  bootResult.runtime.firstBoot = true

  const { startChatLoop } = await import('./adapters/frontend/cli.js')
  await startChatLoop(bootResult.runtime, true)
}

main().catch((err) => {
  console.error(pc.red('Setup failed:'), err)
  process.exit(1)
})
