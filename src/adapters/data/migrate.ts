import pg from 'pg'
import { MIGRATION_SQL } from './supabase.js'

const { Client } = pg

/**
 * Extract the project ref from a Supabase project URL.
 * e.g. "https://abcdef123.supabase.co" → "abcdef123"
 */
export function extractProjectRef(supabaseUrl: string): string {
  const url = new URL(supabaseUrl)
  const ref = url.hostname.split('.')[0]
  if (!ref) throw new Error(`Could not extract project ref from URL: ${supabaseUrl}`)
  return ref
}

/**
 * Build a direct Postgres connection string for a Supabase project.
 */
export function buildConnectionString(supabaseUrl: string, dbPassword: string): string {
  const ref = extractProjectRef(supabaseUrl)
  const encodedPassword = encodeURIComponent(dbPassword)
  return `postgresql://postgres:${encodedPassword}@db.${ref}.supabase.co:5432/postgres`
}

/**
 * Test connectivity to the Postgres database with a simple SELECT 1.
 */
export async function testConnection(connectionString: string): Promise<{ success: boolean; error?: string }> {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  })

  try {
    await client.connect()
    await client.query('SELECT 1')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * Execute the migration SQL and verify the expected tables were created.
 */
export async function applyMigration(connectionString: string): Promise<{ success: boolean; tables: string[]; error?: string }> {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  })

  try {
    await client.connect()
    await client.query(MIGRATION_SQL)

    // Verify tables exist
    const { rows } = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('sessions', 'memories', 'decisions', 'domain_notes')
      ORDER BY tablename
    `)

    const tables = rows.map((r: { tablename: string }) => r.tablename)
    if (tables.length < 4) {
      const missing = ['decisions', 'domain_notes', 'memories', 'sessions'].filter(t => !tables.includes(t))
      return { success: false, tables, error: `Missing tables: ${missing.join(', ')}` }
    }

    return { success: true, tables }
  } catch (err) {
    return { success: false, tables: [], error: err instanceof Error ? err.message : String(err) }
  } finally {
    await client.end().catch(() => {})
  }
}
