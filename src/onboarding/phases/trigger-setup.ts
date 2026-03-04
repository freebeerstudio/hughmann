/**
 * Trigger.dev onboarding phase.
 * Collects project reference and secret key for cloud task execution.
 */

import * as p from '@clack/prompts'
import pc from 'picocolors'
import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../../config.js'

export async function setupTriggerDev(): Promise<boolean> {
  p.note(
    'Trigger.dev enables cloud-scheduled tasks (morning dashboard, closeout, review)\n' +
    'that run 24/7 without your machine being on.\n\n' +
    `Sign up at ${pc.cyan('https://trigger.dev')} and create a project.`,
    'Trigger.dev Setup',
  )

  const projectRef = await p.text({
    message: 'Trigger.dev project reference:',
    placeholder: 'proj_xxxxxxxxxxxx',
    validate: (val) => {
      if (!val?.startsWith('proj_')) return 'Project ref should start with proj_'
    },
  })
  if (p.isCancel(projectRef)) return false

  const secretKey = await p.password({
    message: 'Trigger.dev secret key:',
    validate: (val) => {
      if (!val?.startsWith('tr_')) return 'Secret key should start with tr_'
    },
  })
  if (p.isCancel(secretKey)) return false

  // Save to .env
  const envPath = join(HUGHMANN_HOME, '.env')
  const envVars = [
    `\n# Trigger.dev`,
    `TRIGGER_PROJECT_REF=${projectRef}`,
    `TRIGGER_SECRET_KEY=${secretKey}`,
  ].join('\n')

  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, 'utf-8')
    if (existing.includes('TRIGGER_PROJECT_REF')) {
      p.log.warn('Trigger.dev keys already exist in .env. Please update manually if needed.')
      return true
    }
    appendFileSync(envPath, envVars + '\n', 'utf-8')
  } else {
    appendFileSync(envPath, envVars + '\n', 'utf-8')
  }

  p.log.success('Trigger.dev credentials saved to ~/.hughmann/.env')
  p.log.info(`Next steps:`)
  p.log.info(`  1. Run ${pc.cyan('hughmann trigger dev')} to start the dev server`)
  p.log.info(`  2. Run ${pc.cyan('hughmann trigger sync')} to sync context docs`)
  p.log.info(`  3. Run ${pc.cyan('hughmann trigger deploy')} when ready for production`)

  return true
}
