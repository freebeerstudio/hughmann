import * as p from '@clack/prompts'
import type { AutonomySettings } from '../types.js'

export async function collectAutonomy(systemName: string): Promise<AutonomySettings | symbol> {
  p.note(
    `Last section. This defines how independently ${systemName} operates.\n\n` +
    `There's a spectrum from "ask me before everything" to\n` +
    `"handle it and tell me what you did." Most people start\n` +
    `in the middle and dial up autonomy as trust builds.`,
    'Autonomy & Communication'
  )

  const level = await p.select({
    message: `How much autonomy should ${systemName} have?`,
    options: [
      {
        value: 'conservative',
        label: 'Conservative',
        hint: 'Asks before most actions. Good for getting comfortable.',
      },
      {
        value: 'balanced',
        label: 'Balanced (recommended)',
        hint: 'Handles routine tasks autonomously. Asks for big decisions and anything irreversible.',
      },
      {
        value: 'aggressive',
        label: 'Aggressive',
        hint: 'Acts on most things autonomously. Reports after. Only asks for truly high-stakes decisions.',
      },
      {
        value: 'full',
        label: 'Full autonomy',
        hint: 'Executes the plan. Reports daily. Only interrupts for emergencies or blockers.',
      },
    ],
  })
  if (p.isCancel(level)) return level

  const channels = await p.multiselect({
    message: `How should ${systemName} keep you informed?`,
    options: [
      { value: 'push', label: 'Push notifications', hint: 'For important items and completed tasks' },
      { value: 'morning', label: 'Daily morning briefing', hint: 'Summary of the day ahead + priorities' },
      { value: 'evening', label: 'Daily evening summary', hint: 'What got done, what shifted, tomorrow\'s priorities' },
      { value: 'realtime', label: 'Real-time chat updates', hint: 'Messages as things happen' },
      { value: 'weekly', label: 'Weekly digest', hint: 'Big picture progress and trends' },
    ],
    required: true,
  })
  if (p.isCancel(channels)) return channels

  const activeHours = await p.select({
    message: `When should ${systemName} be active?`,
    options: [
      { value: '24/7', label: 'Always on', hint: 'Runs around the clock. Best for full autonomy.' },
      { value: 'work-hours', label: 'Work hours only', hint: 'Active during your typical work hours.' },
      { value: 'waking-hours', label: 'Waking hours', hint: 'Active from morning to bedtime. Quiet overnight.' },
      { value: 'custom', label: 'Custom schedule', hint: 'You define the hours.' },
    ],
  })
  if (p.isCancel(activeHours)) return activeHours

  let customSchedule: string | undefined
  if (String(activeHours) === 'custom') {
    const schedule = await p.text({
      message: 'Define your schedule:',
      placeholder: 'e.g., "7am-10pm weekdays, 9am-6pm weekends" or "6am-11pm daily"',
    })
    if (p.isCancel(schedule)) return schedule
    customSchedule = String(schedule)
  }

  return {
    level: String(level),
    communicationChannels: channels as string[],
    activeHours: String(activeHours),
    customSchedule,
  }
}
