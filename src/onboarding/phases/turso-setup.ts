import * as p from '@clack/prompts'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../../config.js'
import { writeEnvFile } from '../../util/env.js'

export interface TursoSetupOptions {
  existingUrl?: string
  existingAuthToken?: string
}

/**
 * Interactive Turso setup flow.
 * Prompts for database URL and auth token, tests connection, creates tables, writes .env.
 *
 * Returns true if setup completed successfully, false otherwise.
 */
export async function setupTurso(options: TursoSetupOptions = {}): Promise<boolean> {
  p.note(
    `You'll need two things from the Turso dashboard (turso.tech):\n` +
    `  1. Database URL      (starts with libsql:// or https://)\n` +
    `  2. Auth token        (Database > Generate Token)`,
    'Turso Setup'
  )

  // Prompt for URL
  const urlResult = options.existingUrl
    ? options.existingUrl
    : await p.text({
        message: 'Turso database URL',
        placeholder: 'libsql://your-db-name-org.turso.io',
        validate: (val) => {
          if (!val) return 'URL is required'
          const trimmed = val.trim()
          if (!trimmed.startsWith('libsql://') && !trimmed.startsWith('https://')) {
            return 'URL should start with libsql:// or https://'
          }
        },
      })
  if (p.isCancel(urlResult)) return false
  const tursoUrl = String(urlResult).trim()

  // Prompt for auth token
  const tokenResult = options.existingAuthToken
    ? options.existingAuthToken
    : await p.password({
        message: 'Auth token',
        validate: (val) => {
          if (!val) return 'Auth token is required'
          if (val.length < 10) return 'Token seems too short'
        },
      })
  if (p.isCancel(tokenResult)) return false
  const authToken = String(tokenResult).trim()

  // Test connection
  const spin = p.spinner()
  spin.start('Testing Turso connection...')

  let client: import('@libsql/client').Client
  try {
    const { createClient } = await import('@libsql/client')
    client = createClient({ url: tursoUrl, authToken })
    await client.execute({ sql: 'SELECT 1', args: [] })
    spin.stop('Turso connection OK')
  } catch (err) {
    spin.stop('Turso connection failed')
    p.log.error(`Could not connect to Turso: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }

  // Create tables
  spin.start('Creating tables...')
  try {
    const { TursoAdapter } = await import('../../adapters/data/turso.js')
    const adapter = new TursoAdapter({ url: tursoUrl, authToken })
    const initResult = await adapter.init()
    if (!initResult.success) {
      spin.stop('Table creation failed')
      p.log.error(`Migration error: ${initResult.error}`)
      return false
    }
    spin.stop('Turso ready')
  } catch (err) {
    spin.stop('Table creation failed')
    p.log.error(`Migration error: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }

  // Write credentials to .env
  const envPath = join(HUGHMANN_HOME, '.env')
  writeEnvFile(envPath, {
    TURSO_URL: tursoUrl,
    TURSO_AUTH_TOKEN: authToken,
  })

  // Set on process.env for immediate use
  process.env.TURSO_URL = tursoUrl
  process.env.TURSO_AUTH_TOKEN = authToken

  p.log.success('Tables created: sessions, memories, decisions, domain_notes, memory_embeddings')
  p.log.info('Credentials saved to ~/.hughmann/.env')

  return true
}
