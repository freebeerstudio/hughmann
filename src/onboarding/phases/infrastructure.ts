import * as p from '@clack/prompts'
import type { InfrastructureChoices } from '../types.js'

export async function collectInfrastructure(systemName: string, existing?: InfrastructureChoices): Promise<InfrastructureChoices | symbol> {
  p.note(
    `The technical foundation.\n` +
    `These choices determine where ${systemName} stores data, runs tasks,\n` +
    `and how you interact with it.`,
    existing ? 'Edit Infrastructure' : 'Infrastructure'
  )

  const dataEngine = await p.select({
    message: 'Where should your data live?',
    initialValue: existing?.dataEngine,
    options: [
      {
        value: 'supabase',
        label: 'Supabase',
        hint: 'Managed Postgres + auth + realtime + vector search. Best for full-featured setup.',
      },
      {
        value: 'sqlite',
        label: 'SQLite',
        hint: 'Local, simple, zero config. Good for getting started fast or privacy-first.',
      },
      {
        value: 'turso',
        label: 'Turso',
        hint: 'Cloud SQLite with edge replication. Good balance of simple + scalable.',
      },
    ],
  })
  if (p.isCancel(dataEngine)) return dataEngine

  const executionEngine = await p.select({
    message: `How should ${systemName} execute tasks and workflows?`,
    initialValue: existing?.executionEngine,
    options: [
      {
        value: 'trigger-dev',
        label: 'Trigger.dev (cloud)',
        hint: 'Durable workflows, built-in retry, observable. Runs 24/7 without your machine.',
      },
      {
        value: 'local',
        label: 'Local daemon',
        hint: 'Runs on your machine. Full local access but depends on your computer being on.',
      },
      {
        value: 'hybrid',
        label: 'Hybrid (cloud + local)',
        hint: 'Cloud for always-on tasks, local daemon for things that need your machine.',
      },
    ],
  })
  if (p.isCancel(executionEngine)) return executionEngine

  const frontends = await p.multiselect({
    message: `How do you want to interact with ${systemName}?`,
    initialValues: existing?.frontends,
    options: [
      { value: 'cli', label: 'Terminal / CLI', hint: 'Direct terminal access. Always available.' },
      { value: 'telegram', label: 'Telegram', hint: 'Message from your phone. Quick and portable.' },
      { value: 'discord', label: 'Discord', hint: 'Good for communities or team use.' },
      { value: 'ios', label: 'iOS app', hint: 'Native SwiftUI app. Full dashboard experience.' },
      { value: 'web', label: 'Web dashboard', hint: 'Browser-based dashboard and management.' },
      { value: 'imessage', label: 'iMessage (Mac only)', hint: 'Uses AppleScript. No API key needed.' },
    ],
    required: true,
  })
  if (p.isCancel(frontends)) return frontends

  const modelProviders = await p.multiselect({
    message: 'What AI model access do you have?',
    initialValues: existing?.modelProviders,
    options: [
      {
        value: 'claude-max',
        label: 'Claude Max subscription',
        hint: 'Uses your existing subscription via OAuth. Best value.',
      },
      {
        value: 'claude-api',
        label: 'Claude API key',
        hint: 'Direct API access. Pay per token.',
      },
      {
        value: 'openrouter',
        label: 'OpenRouter',
        hint: 'Access to 100+ models. Great for light tasks and fallback.',
      },
      {
        value: 'openai',
        label: 'OpenAI API',
        hint: 'GPT models + Whisper + embeddings.',
      },
    ],
    required: true,
  })
  if (p.isCancel(modelProviders)) return modelProviders

  return {
    dataEngine: String(dataEngine),
    executionEngine: String(executionEngine),
    frontends: frontends as string[],
    modelProviders: modelProviders as string[],
  }
}
