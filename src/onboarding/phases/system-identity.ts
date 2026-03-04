import * as p from '@clack/prompts'
import type { SystemIdentity } from '../types.js'

export async function collectSystemIdentity(existing?: SystemIdentity): Promise<SystemIdentity | symbol> {
  p.note(
    `Define who your AI is.\n` +
    `This shapes how it thinks, communicates, and presents itself.\n` +
    `The identity you create here becomes its soul.`,
    existing ? 'Edit System Identity' : 'System Identity'
  )

  const name = await p.text({
    message: 'What would you like to name your AI assistant?',
    placeholder: 'Hugh',
    defaultValue: existing?.name ?? 'Hugh',
    validate: (v) => {
      if (!v?.trim()) return 'A name is required'
    },
  })
  if (p.isCancel(name)) return name

  const personality = await p.select({
    message: `What personality should ${String(name)} have?`,
    initialValue: existing?.personality,
    options: [
      {
        value: 'direct',
        label: 'Direct & no-nonsense',
        hint: 'Gets to the point. No fluff. Executes first, explains if asked.',
      },
      {
        value: 'warm',
        label: 'Warm & supportive',
        hint: 'Encouraging, empathetic. Celebrates wins, softens feedback.',
      },
      {
        value: 'analytical',
        label: 'Analytical & precise',
        hint: 'Data-driven, thorough. Weighs options, provides evidence.',
      },
      {
        value: 'balanced',
        label: 'Balanced & adaptive',
        hint: 'Reads the room. Direct when needed, warm when appropriate.',
      },
    ],
  })
  if (p.isCancel(personality)) return personality

  const rules = await p.multiselect({
    message: `What communication rules should ${String(name)} always follow?`,
    initialValues: existing?.communicationRules,
    options: [
      { value: 'no-cliches', label: 'No AI cliches', hint: 'Never say "Certainly!", "Great question!", "As an AI"' },
      { value: 'no-sycophancy', label: 'No sycophancy', hint: 'No empty praise or over-agreement' },
      { value: 'no-apologies', label: 'No excessive apologies', hint: 'Fix mistakes and move on' },
      { value: 'no-emdash', label: 'No em dashes', hint: 'Use commas, periods, or semicolons instead' },
      { value: 'concise', label: 'Keep responses concise', hint: 'Lead with the answer, not the reasoning' },
      { value: 'no-narration', label: "Don't narrate actions", hint: 'Just do it, don\'t explain what you\'re about to do' },
      { value: 'admit-unknowns', label: 'Admit when unsure', hint: 'Say "I don\'t know" plainly when appropriate' },
    ],
    required: false,
  })
  if (p.isCancel(rules)) return rules

  let customRules: string | undefined = existing?.customRules
  const wantsCustom = await p.confirm({
    message: 'Any additional rules or personality traits to add?',
    initialValue: !!existing?.customRules,
  })
  if (p.isCancel(wantsCustom)) return wantsCustom

  if (wantsCustom) {
    const custom = await p.text({
      message: `Describe any other rules or traits for ${String(name)}:`,
      placeholder: 'e.g., "Always use bullet points for lists" or "Be slightly sarcastic"',
      defaultValue: existing?.customRules,
    })
    if (p.isCancel(custom)) return custom
    customRules = String(custom)
  } else {
    customRules = undefined
  }

  return {
    name: String(name),
    personality: String(personality),
    communicationRules: (rules as string[]) || [],
    customRules,
  }
}
