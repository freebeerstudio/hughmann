import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { showBanner } from './banner.js'
import { runOnboarding } from './onboarding/index.js'
import { generateContextDocuments } from './generators/context-docs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

async function main() {
  showBanner()

  const result = await runOnboarding()

  // Generate context documents
  const contextDir = join(PROJECT_ROOT, 'context')
  const spinner = p.spinner()
  spinner.start('Generating context documents...')

  const files = generateContextDocuments(result, contextDir)

  // Save raw onboarding data for future use
  const dataPath = join(contextDir, '.onboarding-data.json')
  writeFileSync(dataPath, JSON.stringify(result, null, 2), 'utf-8')
  files.push(dataPath)

  spinner.stop('Context documents generated')

  // Show what was created
  console.log()
  p.note(
    files.map(f => {
      const relative = f.replace(PROJECT_ROOT + '/', '')
      return `  ${pc.green('+')} ${relative}`
    }).join('\n'),
    'Files Created'
  )

  // Next steps
  console.log()
  console.log(`  ${pc.bold(`${result.system.name} is ready.`)}`)
  console.log()
  console.log(`  Your context documents are in ${pc.cyan('./context/')}`)
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
