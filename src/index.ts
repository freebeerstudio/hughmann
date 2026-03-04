import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { showBanner } from './banner.js'
import { runOnboarding } from './onboarding/index.js'
import { generateContextDocuments } from './generators/context-docs.js'
import { HUGHMANN_HOME, saveConfig } from './config.js'
import { homedir } from 'node:os'

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

  // Next steps
  console.log()
  console.log(`  ${pc.bold(`${result.system.name} is ready.`)}`)
  console.log()
  console.log(`  Your context documents are in ${pc.cyan(displayHome + '/context/')}`)
  console.log(`  These are the foundation of everything ${result.system.name} does.`)
  console.log(`  Review and edit them anytime. They're plain markdown.`)
  console.log()
  console.log(`  ${pc.dim('What happens next:')}`)
  console.log(`  ${pc.dim(`1. Review your context docs (especially master-plan.md)`)}`)
  console.log(`  ${pc.dim(`2. Configure your infrastructure (API keys, services)`)}`)
  console.log(`  ${pc.dim(`3. Start ${result.system.name}: npm run start`)}`)
  console.log()

  p.outro(`${result.system.name} knows who you are. Time to build.`)
}

main().catch((err) => {
  console.error(pc.red('Setup failed:'), err)
  process.exit(1)
})
