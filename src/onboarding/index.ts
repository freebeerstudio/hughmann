import * as p from '@clack/prompts'
import pc from 'picocolors'
import { collectSystemIdentity } from './phases/system-identity.js'
import { collectUserIdentity } from './phases/user-identity.js'
import { collectDomains, deepDiveDomains } from './phases/domains.js'
import { collectInfrastructure } from './phases/infrastructure.js'
import { collectAutonomy } from './phases/autonomy.js'
import { reviewAndConfirm } from './phases/review.js'
import type { OnboardingResult } from './types.js'

function handleCancel(): never {
  p.cancel('Setup cancelled. Run again anytime.')
  process.exit(0)
}

export async function runOnboarding(): Promise<OnboardingResult> {
  p.intro(pc.bold('Welcome to HughMann'))

  console.log()
  console.log('  HughMann is a personal AI operating system that manages')
  console.log('  your entire life across every domain: work, business,')
  console.log('  health, projects, everything.')
  console.log()
  console.log('  It runs autonomously, understands your goals, and grows')
  console.log('  its own capabilities over time. You steer. It executes.')
  console.log()
  console.log('  This setup builds the foundation. Every question shapes')
  console.log('  the context documents that define who your AI is, who')
  console.log('  you are, and what you\'re building together.')
  console.log()
  console.log(`  ${pc.dim('Takes about 10-15 minutes. Worth every second.')}`)
  console.log()

  const ready = await p.confirm({
    message: 'Ready to begin?',
    initialValue: true,
  })
  if (p.isCancel(ready) || !ready) handleCancel()

  // Phase 1: System Identity
  const system = await collectSystemIdentity()
  if (p.isCancel(system)) handleCancel()

  const systemName = (system as Exclude<typeof system, symbol>).name

  // Phase 2: User Identity
  const user = await collectUserIdentity(systemName)
  if (p.isCancel(user)) handleCancel()

  // Phase 3: Life Domains (high level)
  const domainsResult = await collectDomains(systemName)
  if (p.isCancel(domainsResult)) handleCancel()

  // Phase 4: Domain Deep Dive
  const deepDomains = await deepDiveDomains(
    systemName,
    domainsResult as Exclude<typeof domainsResult, symbol>
  )
  if (p.isCancel(deepDomains)) handleCancel()

  // Phase 5: Infrastructure
  const infrastructure = await collectInfrastructure(systemName)
  if (p.isCancel(infrastructure)) handleCancel()

  // Phase 6: Autonomy
  const autonomy = await collectAutonomy(systemName)
  if (p.isCancel(autonomy)) handleCancel()

  // Build result
  const result: OnboardingResult = {
    system: system as Exclude<typeof system, symbol>,
    user: user as Exclude<typeof user, symbol>,
    domains: deepDomains as Exclude<typeof deepDomains, symbol>,
    infrastructure: infrastructure as Exclude<typeof infrastructure, symbol>,
    autonomy: autonomy as Exclude<typeof autonomy, symbol>,
  }

  // Phase 7: Review
  const confirmed = await reviewAndConfirm(result)
  if (p.isCancel(confirmed) || !confirmed) {
    p.log.warn('Let\'s try again. Running setup from the top...')
    return runOnboarding()
  }

  return result
}
