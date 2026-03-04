import * as p from '@clack/prompts'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { HUGHMANN_HOME } from '../../config.js'
import { writeEnvFile } from '../../util/env.js'
import { buildConnectionString, testConnection, applyMigration } from '../../adapters/data/migrate.js'

export interface SupabaseSetupOptions {
  existingUrl?: string
  existingKey?: string
}

/**
 * Interactive Supabase setup flow.
 * Prompts for credentials, tests connections, runs migration, and writes .env.
 *
 * Returns true if setup completed successfully, false otherwise.
 */
export async function setupSupabase(options: SupabaseSetupOptions = {}): Promise<boolean> {
  p.note(
    `You'll need three things from supabase.com/dashboard:\n` +
    `  1. Project URL        (Settings > API > Project URL)\n` +
    `  2. Service role key   (Settings > API > service_role)\n` +
    `  3. Database password  (Settings > Database)`,
    'Supabase Setup'
  )

  // Prompt for URL (pre-fill if available)
  const urlResult = options.existingUrl
    ? options.existingUrl
    : await p.text({
        message: 'Supabase Project URL',
        placeholder: 'https://xyz.supabase.co',
        validate: (val) => {
          if (!val) return 'URL is required'
          try {
            const url = new URL(val)
            if (!url.hostname.endsWith('.supabase.co')) {
              return 'URL should end with .supabase.co'
            }
          } catch {
            return 'Invalid URL'
          }
        },
      })
  if (p.isCancel(urlResult)) return false
  const supabaseUrl = String(urlResult).trim()

  // Prompt for service role key (pre-fill if available)
  const keyResult = options.existingKey
    ? options.existingKey
    : await p.password({
        message: 'Service role key',
        validate: (val) => {
          if (!val) return 'Service role key is required'
          if (val.length < 30) return 'Key seems too short — use the service_role key, not the anon key'
        },
      })
  if (p.isCancel(keyResult)) return false
  const serviceKey = String(keyResult).trim()

  // Prompt for database password (always required)
  const pwResult = await p.password({
    message: 'Database password',
    validate: (val) => {
      if (!val) return 'Database password is required'
    },
  })
  if (p.isCancel(pwResult)) return false
  const dbPassword = String(pwResult)

  // Test PostgREST connection (URL + service key)
  const spin = p.spinner()
  spin.start('Testing PostgREST connection...')

  try {
    const client = createClient(supabaseUrl, serviceKey)
    const { error } = await client.from('sessions').select('id').limit(1)
    // "relation does not exist" is fine — tables just aren't created yet
    if (error && !error.message.includes('does not exist') && !error.message.includes('relation')) {
      spin.stop('PostgREST connection failed')
      p.log.error(`PostgREST error: ${error.message}`)
      return false
    }
    spin.stop('PostgREST connection OK')
  } catch (err) {
    spin.stop('PostgREST connection failed')
    p.log.error(`Could not connect to Supabase API: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }

  // Test direct Postgres connection
  const connectionString = buildConnectionString(supabaseUrl, dbPassword)

  spin.start('Testing Postgres connection...')
  const pgTest = await testConnection(connectionString)
  if (!pgTest.success) {
    spin.stop('Postgres connection failed')
    p.log.error(`Could not connect to Postgres: ${pgTest.error}`)
    p.log.info('Check your database password (Settings > Database in the Supabase dashboard)')
    return false
  }
  spin.stop('Postgres connection OK')

  // Run migration
  spin.start('Creating tables...')
  const migration = await applyMigration(connectionString)
  if (!migration.success) {
    spin.stop('Migration failed')
    p.log.error(`Migration error: ${migration.error}`)
    return false
  }
  spin.stop('Supabase ready')

  // Write credentials to .env
  const envPath = join(HUGHMANN_HOME, '.env')
  writeEnvFile(envPath, {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_KEY: serviceKey,
  })

  // Also set on process.env for immediate use
  process.env.SUPABASE_URL = supabaseUrl
  process.env.SUPABASE_KEY = serviceKey

  p.log.success(`Tables created: ${migration.tables.join(', ')}`)
  p.log.info(`Credentials saved to ~/.hughmann/.env`)

  return true
}
