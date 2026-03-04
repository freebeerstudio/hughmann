import * as p from '@clack/prompts'
import pc from 'picocolors'
import { collectSystemIdentity } from './phases/system-identity.js'
import { collectUserIdentity } from './phases/user-identity.js'
import { collectDomains, deepDiveDomains } from './phases/domains.js'
import { collectInfrastructure } from './phases/infrastructure.js'
import { collectAutonomy } from './phases/autonomy.js'
import { reviewAndConfirm } from './phases/review.js'
import { loadConfig, saveConfig, isComplete, completedCount, toOnboardingResult, type HughmannConfig } from '../config.js'
import type { OnboardingResult } from './types.js'

function sectionStatus(configured: boolean, label: string, summary?: string): { value: string; label: string; hint?: string } {
  if (configured) {
    return {
      value: label,
      label: `${pc.green('✓')} ${label}`,
      hint: summary ? `${summary}  ${pc.dim('[Edit]')}` : pc.dim('[Edit]'),
    }
  }
  return {
    value: label,
    label: `${pc.yellow('○')} ${label}`,
    hint: pc.yellow('Setup →'),
  }
}

function systemSummary(config: HughmannConfig): string | undefined {
  if (!config.system) return undefined
  return `${config.system.name} — ${config.system.personality}`
}

function userSummary(config: HughmannConfig): string | undefined {
  if (!config.user) return undefined
  return config.user.name
}

function domainsSummary(config: HughmannConfig): string | undefined {
  if (!config.domains) return undefined
  return `${config.domains.length} domain${config.domains.length !== 1 ? 's' : ''}: ${config.domains.map(d => d.name).join(', ')}`
}

function infraSummary(config: HughmannConfig): string | undefined {
  if (!config.infrastructure) return undefined
  return `${config.infrastructure.dataEngine}, ${config.infrastructure.executionEngine}`
}

function autonomySummary(config: HughmannConfig): string | undefined {
  if (!config.autonomy) return undefined
  return config.autonomy.level
}

function getSystemName(config: HughmannConfig): string {
  return config.system?.name ?? 'your AI'
}

export async function runOnboarding(): Promise<OnboardingResult | null> {
  let config = loadConfig()
  const isFirstRun = completedCount(config) === 0

  p.intro(pc.bold('HughMann Setup'))

  if (isFirstRun) {
    console.log()
    console.log('  HughMann is a personal AI operating system that manages')
    console.log('  your entire life across every domain: work, business,')
    console.log('  health, projects, everything.')
    console.log()
    console.log('  It runs autonomously, understands your goals, and grows')
    console.log('  its own capabilities over time. You steer. It executes.')
    console.log()
    console.log('  This setup builds the foundation. Configure each section')
    console.log('  below. You can do them in any order, come back anytime,')
    console.log('  and edit anything after the fact.')
    console.log()
    console.log(`  ${pc.dim('Complete all 5 sections to generate your context documents.')}`)
    console.log()
  }

  // Main menu loop
  while (true) {
    const done = completedCount(config)
    const total = 5

    const menuMessage = isComplete(config)
      ? `All sections configured. Edit anything or generate your documents.`
      : `${done}/${total} sections complete. Pick a section to configure.`

    const options = [
      sectionStatus(!!config.system, 'System Identity', systemSummary(config)),
      sectionStatus(!!config.user, 'Your Identity', userSummary(config)),
      sectionStatus(!!config.domains, 'Life Domains', domainsSummary(config)),
      sectionStatus(!!config.infrastructure, 'Infrastructure', infraSummary(config)),
      sectionStatus(!!config.autonomy, 'Autonomy', autonomySummary(config)),
    ]

    // Add separator and action options
    if (isComplete(config)) {
      options.push({
        value: '_generate',
        label: `${pc.green(pc.bold('▶ Generate Context Documents'))}`,
        hint: 'Build your soul.md, owner.md, master-plan.md, and more',
      })
    }

    options.push({
      value: '_exit',
      label: pc.dim('Exit'),
      hint: !isComplete(config) ? pc.yellow(`${total - done} section${total - done !== 1 ? 's' : ''} remaining`) : undefined,
    })

    const choice = await p.select({
      message: menuMessage,
      options,
    })

    if (p.isCancel(choice)) {
      return handleExit(config)
    }

    const section = String(choice)

    // Handle actions
    if (section === '_generate') {
      const result = toOnboardingResult(config)
      const confirmed = await reviewAndConfirm(result)
      if (p.isCancel(confirmed)) continue
      if (confirmed) return result
      continue
    }

    if (section === '_exit') {
      return handleExit(config)
    }

    // Handle section selection
    const systemName = getSystemName(config)

    if (section === 'System Identity') {
      const result = await collectSystemIdentity(config.system ?? undefined)
      if (!p.isCancel(result)) {
        config.system = result as Exclude<typeof result, symbol>
        saveConfig(config)
        p.log.success('System Identity saved.')
      }
    }

    if (section === 'Your Identity') {
      const result = await collectUserIdentity(systemName, config.user ?? undefined)
      if (!p.isCancel(result)) {
        config.user = result as Exclude<typeof result, symbol>
        saveConfig(config)
        p.log.success('Your Identity saved.')
      }
    }

    if (section === 'Life Domains') {
      const domainsResult = await collectDomains(systemName, config.domains ?? undefined)
      if (!p.isCancel(domainsResult)) {
        const domains = domainsResult as Exclude<typeof domainsResult, symbol>
        // Deep dive
        const deepResult = await deepDiveDomains(systemName, domains)
        if (!p.isCancel(deepResult)) {
          config.domains = deepResult as Exclude<typeof deepResult, symbol>
          saveConfig(config)
          p.log.success(`${config.domains.length} domain${config.domains.length !== 1 ? 's' : ''} saved.`)
        }
      }
    }

    if (section === 'Infrastructure') {
      const result = await collectInfrastructure(systemName, config.infrastructure ?? undefined)
      if (!p.isCancel(result)) {
        config.infrastructure = result as Exclude<typeof result, symbol>
        saveConfig(config)
        p.log.success('Infrastructure saved.')
      }
    }

    if (section === 'Autonomy') {
      const result = await collectAutonomy(systemName, config.autonomy ?? undefined)
      if (!p.isCancel(result)) {
        config.autonomy = result as Exclude<typeof result, symbol>
        saveConfig(config)
        p.log.success('Autonomy settings saved.')
      }
    }
  }
}

async function handleExit(config: HughmannConfig): Promise<null> {
  if (!isComplete(config)) {
    const done = completedCount(config)
    p.log.warn(
      `${5 - done} section${5 - done !== 1 ? 's' : ''} still need configuration.\n` +
      `  Run ${pc.cyan('hughmann setup')} anytime to pick up where you left off.`
    )
  }
  p.outro(pc.dim('See you next time.'))
  return null
}
