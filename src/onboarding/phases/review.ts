import * as p from '@clack/prompts'
import pc from 'picocolors'
import type { OnboardingResult } from '../types.js'

function formatRules(rules: string[]): string {
  const ruleLabels: Record<string, string> = {
    'no-cliches': 'No AI cliches',
    'no-sycophancy': 'No sycophancy',
    'no-apologies': 'No excessive apologies',
    'no-emdash': 'No em dashes',
    'concise': 'Keep responses concise',
    'no-narration': 'Don\'t narrate actions',
    'admit-unknowns': 'Admit when unsure',
  }
  return rules.map(r => ruleLabels[r] || r).join(', ') || 'None selected'
}

function formatPersonality(p: string): string {
  const labels: Record<string, string> = {
    'direct': 'Direct & no-nonsense',
    'warm': 'Warm & supportive',
    'analytical': 'Analytical & precise',
    'balanced': 'Balanced & adaptive',
  }
  return labels[p] || p
}

function formatLevel(l: string): string {
  const labels: Record<string, string> = {
    'conservative': 'Conservative - asks before most actions',
    'balanced': 'Balanced - routine tasks autonomous, big decisions need approval',
    'aggressive': 'Aggressive - acts autonomously, reports after',
    'full': 'Full autonomy - executes the plan, reports daily',
  }
  return labels[l] || l
}

export async function reviewAndConfirm(result: OnboardingResult): Promise<boolean | symbol> {
  const systemSection = [
    `${pc.bold('Name:')} ${result.system.name}`,
    `${pc.bold('Personality:')} ${formatPersonality(result.system.personality)}`,
    `${pc.bold('Rules:')} ${formatRules(result.system.communicationRules)}`,
    result.system.customRules ? `${pc.bold('Custom:')} ${result.system.customRules}` : '',
  ].filter(Boolean).join('\n')

  const userSection = [
    `${pc.bold('Name:')} ${result.user.name}`,
    `${pc.bold('About:')} ${result.user.description.slice(0, 100)}${result.user.description.length > 100 ? '...' : ''}`,
    `${pc.bold('Timezone:')} ${result.user.timezone}`,
    `${pc.bold('Peak hours:')} ${result.user.peakHours}`,
    `${pc.bold('Style:')} ${result.user.communicationStyle}`,
  ].join('\n')

  const domainLines = result.domains.map(d =>
    `  ${pc.bold(d.name)} (${d.type}) - ${d.primaryGoal.slice(0, 60)}${d.primaryGoal.length > 60 ? '...' : ''}`
  ).join('\n')

  const infraSection = [
    `${pc.bold('Data:')} ${result.infrastructure.dataEngine}`,
    `${pc.bold('Execution:')} ${result.infrastructure.executionEngine}`,
    `${pc.bold('Frontends:')} ${result.infrastructure.frontends.join(', ')}`,
    `${pc.bold('Models:')} ${result.infrastructure.modelProviders.join(', ')}`,
  ].join('\n')

  const autonomySection = [
    `${pc.bold('Level:')} ${formatLevel(result.autonomy.level)}`,
    `${pc.bold('Updates via:')} ${result.autonomy.communicationChannels.join(', ')}`,
    `${pc.bold('Active:')} ${result.autonomy.activeHours}${result.autonomy.customSchedule ? ` (${result.autonomy.customSchedule})` : ''}`,
  ].join('\n')

  p.note(
    `${pc.underline('AI System')}\n${systemSection}\n\n` +
    `${pc.underline('You')}\n${userSection}\n\n` +
    `${pc.underline('Life Domains')}\n${domainLines}\n\n` +
    `${pc.underline('Infrastructure')}\n${infraSection}\n\n` +
    `${pc.underline('Autonomy')}\n${autonomySection}`,
    'Review Your Setup'
  )

  const confirmed = await p.confirm({
    message: 'Everything look right? This will generate your context documents.',
    initialValue: true,
  })

  return confirmed
}
