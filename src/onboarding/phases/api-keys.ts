import * as p from '@clack/prompts'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../../config.js'
import { writeEnvFile } from '../../util/env.js'

interface KeySpec {
  id: string
  envVar: string
  label: string
  hint: string
  validate: (key: string) => Promise<{ valid: boolean; error?: string }>
}

const KEY_SPECS: KeySpec[] = [
  {
    id: 'openrouter',
    envVar: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    hint: 'Get your key at openrouter.ai/keys',
    validate: async (key) => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        })
        if (res.ok) return { valid: true }
        return { valid: false, error: `HTTP ${res.status}: ${res.statusText}` }
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  },
  {
    id: 'claude-api',
    envVar: 'ANTHROPIC_API_KEY',
    label: 'Anthropic (Claude API)',
    hint: 'Get your key at console.anthropic.com',
    validate: async (key) => {
      try {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
        })
        if (res.ok) return { valid: true }
        return { valid: false, error: `HTTP ${res.status}: ${res.statusText}` }
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  },
  {
    id: 'openai',
    envVar: 'OPENAI_API_KEY',
    label: 'OpenAI',
    hint: 'Get your key at platform.openai.com/api-keys',
    validate: async (key) => {
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        })
        if (res.ok) return { valid: true }
        return { valid: false, error: `HTTP ${res.status}: ${res.statusText}` }
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  },
  {
    id: 'telegram',
    envVar: 'TELEGRAM_BOT_TOKEN',
    label: 'Telegram Bot',
    hint: 'Get a token from @BotFather on Telegram',
    validate: async (key) => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${key}/getMe`)
        const data = await res.json() as { ok: boolean; description?: string }
        if (data.ok) return { valid: true }
        return { valid: false, error: data.description ?? 'Invalid token' }
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  },
]

/**
 * Collect and validate API keys for selected model providers and frontends.
 * Skips keys already present in process.env.
 * Writes all collected keys to ~/.hughmann/.env.
 *
 * Returns true if at least one key was collected or all were already configured.
 */
export async function collectApiKeys(
  modelProviders: string[],
  frontends: string[]
): Promise<boolean> {
  // Determine which keys we need
  const neededIds = new Set<string>()
  for (const provider of modelProviders) {
    if (provider === 'claude-max') continue // No key needed
    neededIds.add(provider)
  }
  if (frontends.includes('telegram')) {
    neededIds.add('telegram')
  }

  const specs = KEY_SPECS.filter(s => neededIds.has(s.id))
  if (specs.length === 0) return true

  p.note(
    `Let's configure API keys for your selected services.\n` +
    `Keys are stored locally in ~/.hughmann/.env (owner-only permissions).`,
    'API Keys'
  )

  const collectedKeys: Record<string, string> = {}
  let allConfigured = true

  for (const spec of specs) {
    // Check if already in env
    if (process.env[spec.envVar]) {
      p.log.success(`${spec.label}: already configured`)
      continue
    }

    allConfigured = false
    let collected = false

    while (!collected) {
      const keyResult = await p.password({
        message: `${spec.label} API key`,
        validate: (val) => {
          if (!val) return 'Key is required (or press Ctrl+C to skip)'
        },
      })

      if (p.isCancel(keyResult)) {
        p.log.warn(`Skipped ${spec.label} — you can add it later to ~/.hughmann/.env`)
        break
      }

      const key = String(keyResult).trim()

      // Validate
      const spin = p.spinner()
      spin.start(`Validating ${spec.label} key...`)
      const result = await spec.validate(key)

      if (result.valid) {
        spin.stop(`${spec.label} key valid`)
        collectedKeys[spec.envVar] = key
        process.env[spec.envVar] = key
        collected = true
      } else {
        spin.stop(`${spec.label} key invalid`)
        p.log.error(result.error ?? 'Validation failed')

        const retry = await p.confirm({
          message: 'Try again?',
          initialValue: true,
        })

        if (p.isCancel(retry) || !retry) {
          p.log.warn(`Skipped ${spec.label} — you can add it later to ~/.hughmann/.env`)
          break
        }
      }
    }
  }

  // Write all collected keys at once
  if (Object.keys(collectedKeys).length > 0) {
    const envPath = join(HUGHMANN_HOME, '.env')
    writeEnvFile(envPath, collectedKeys)
    p.log.info(`${Object.keys(collectedKeys).length} key${Object.keys(collectedKeys).length !== 1 ? 's' : ''} saved to ~/.hughmann/.env`)
  } else if (allConfigured) {
    p.log.success('All API keys already configured')
  }

  return true
}
