import * as p from '@clack/prompts'
import pc from 'picocolors'
import type { InfrastructureChoices } from '../types.js'
import { setupSupabase } from './supabase-setup.js'
import { setupTurso } from './turso-setup.js'
import { collectApiKeys } from './api-keys.js'

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

  const choices: InfrastructureChoices = {
    dataEngine: String(dataEngine),
    executionEngine: String(executionEngine),
    frontends: frontends as string[],
    modelProviders: modelProviders as string[],
  }

  // Offer Supabase setup if selected
  if (choices.dataEngine === 'supabase') {
    const setupNow = await p.confirm({
      message: 'Set up Supabase connection now?',
      initialValue: true,
    })

    if (!p.isCancel(setupNow) && setupNow) {
      const ok = await setupSupabase()
      if (!ok) {
        p.log.info(`You can set up Supabase later with: ${pc.cyan('hughmann migrate --apply')}`)
      }
    } else {
      p.log.info(`Run ${pc.cyan('hughmann migrate --apply')} when you're ready to connect Supabase.`)
    }
  }

  // Offer Turso setup if selected
  if (choices.dataEngine === 'turso') {
    const setupNow = await p.confirm({
      message: 'Set up Turso connection now?',
      initialValue: true,
    })

    if (!p.isCancel(setupNow) && setupNow) {
      const ok = await setupTurso()
      if (!ok) {
        p.log.info(`You can set up Turso later with: ${pc.cyan('hughmann migrate --apply')}`)
      }
    } else {
      p.log.info(`Run ${pc.cyan('hughmann migrate --apply')} when you're ready to connect Turso.`)
    }
  }

  // Offer Trigger.dev setup if selected
  if (choices.executionEngine === 'trigger-dev' || choices.executionEngine === 'hybrid') {
    const setupNow = await p.confirm({
      message: 'Set up Trigger.dev connection now?',
      initialValue: true,
    })

    if (!p.isCancel(setupNow) && setupNow) {
      const { setupTriggerDev } = await import('./trigger-setup.js')
      const ok = await setupTriggerDev()
      if (!ok) {
        p.log.info(`You can set up Trigger.dev later with: ${pc.cyan('hughmann setup')} and select trigger-dev.`)
      }
    } else {
      p.log.info(`Run ${pc.cyan('hughmann trigger dev')} when you're ready to set up cloud tasks.`)
    }
  }

  // Collect API keys for selected providers and frontends
  const needsKeys = choices.modelProviders.some(p => p !== 'claude-max') ||
    choices.frontends.includes('telegram')

  if (needsKeys) {
    const setupKeys = await p.confirm({
      message: 'Configure API keys now?',
      initialValue: true,
    })

    if (!p.isCancel(setupKeys) && setupKeys) {
      await collectApiKeys(choices.modelProviders, choices.frontends)
    } else {
      p.log.info(`You can add API keys later in ${pc.cyan('~/.hughmann/.env')}`)
    }
  }

  return choices
}
