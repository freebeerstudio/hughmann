import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../config.js'
import { loadEnvFile } from '../util/env.js'
import { loadContext } from './context-loader.js'
import { createModelAdapters } from '../adapters/model/index.js'
import { ModelRouter } from './model-router.js'
import { Runtime } from './runtime.js'
import { SessionManager } from './session.js'
import { MemoryManager } from './memory.js'
import { loadMcpConfig } from './mcp-config.js'
import { ContextWriter } from './context-writer.js'
import { SkillManager } from './skills.js'
import { SupabaseAdapter } from '../adapters/data/supabase.js'
import { SQLiteAdapter } from '../adapters/data/sqlite.js'
import type { DataAdapter } from '../adapters/data/types.js'
import { loadConfig } from '../config.js'
import { createEmbeddingAdapter } from '../adapters/embeddings/index.js'
import { UsageTracker } from './usage.js'

export interface BootResult {
  success: boolean
  runtime?: Runtime
  warnings: string[]
  errors: string[]
}

/**
 * Boot sequence:
 * 1. Resolve paths
 * 2. Validate ~/.hughmann exists and has been onboarded
 * 3. Load context documents
 * 4. Initialize model adapters
 * 5. Create router and runtime
 */
export async function boot(): Promise<BootResult> {
  const warnings: string[] = []
  const errors: string[] = []

  const contextDir = join(HUGHMANN_HOME, 'context')
  const onboardingData = join(HUGHMANN_HOME, '.onboarding-data.json')

  // Load .env from ~/.hughmann/.env if it exists
  const envPath = join(HUGHMANN_HOME, '.env')
  if (existsSync(envPath)) {
    loadEnvFile(envPath)
  }

  // Validate prerequisites
  if (!existsSync(HUGHMANN_HOME)) {
    errors.push(`${HUGHMANN_HOME} does not exist. Run \`hughmann setup\` first.`)
    return { success: false, warnings, errors }
  }

  if (!existsSync(onboardingData)) {
    errors.push(`No onboarding data found. Run \`hughmann setup\` first.`)
    return { success: false, warnings, errors }
  }

  if (!existsSync(contextDir)) {
    errors.push(`No context documents found at ${contextDir}. Run \`hughmann setup\` and generate context documents.`)
    return { success: false, warnings, errors }
  }

  // Load context
  let contextResult
  try {
    contextResult = loadContext(contextDir)
    warnings.push(...contextResult.warnings)
  } catch (err) {
    errors.push(`Failed to load context: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, warnings, errors }
  }

  // Initialize model adapters
  const { adapters, warnings: adapterWarnings } = createModelAdapters()
  warnings.push(...adapterWarnings)

  if (adapters.length === 0) {
    errors.push('No model adapters available. Install @anthropic-ai/claude-agent-sdk or set OPENROUTER_API_KEY in ~/.hughmann/.env')
    return { success: false, warnings, errors }
  }

  // Load MCP server config
  const { config: mcpConfig, warnings: mcpWarnings } = loadMcpConfig(HUGHMANN_HOME)
  warnings.push(...mcpWarnings)

  const mcpCount = Object.keys(mcpConfig.servers).length
  if (mcpCount > 0) {
    warnings.push(`Loaded ${mcpCount} MCP server${mcpCount !== 1 ? 's' : ''}: ${Object.keys(mcpConfig.servers).join(', ')}`)
  }

  // Create router, session manager, memory manager, and runtime
  const router = new ModelRouter(adapters)
  const sessions = new SessionManager(HUGHMANN_HOME)
  const memory = new MemoryManager(HUGHMANN_HOME)

  // Give memory manager a model adapter for distillation
  // Prefer Claude OAuth (uses haiku tier), fall back to OpenRouter
  const distillAdapter = adapters.find(a => a.id === 'claude-oauth') ?? adapters[0]
  memory.setModel(distillAdapter)

  // Initialize embedding adapter for vector memory
  const embeddingAdapter = createEmbeddingAdapter()
  if (embeddingAdapter) {
    memory.setEmbeddings(embeddingAdapter)
    warnings.push('Embeddings available (vector memory enabled)')
  }

  // Load skills
  const skills = new SkillManager(HUGHMANN_HOME)
  skills.initSkillsDir()
  const customSkillCount = skills.listCustom().length
  if (customSkillCount > 0) {
    warnings.push(`Loaded ${customSkillCount} custom skill${customSkillCount !== 1 ? 's' : ''}`)
  }

  // Initialize data adapter based on onboarding config
  let dataAdapter: DataAdapter | undefined
  const config = loadConfig()
  const dataEngine = config.infrastructure?.dataEngine ?? 'none'

  if (dataEngine === 'supabase') {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY
    if (supabaseUrl && supabaseKey) {
      const adapter = new SupabaseAdapter({ url: supabaseUrl, key: supabaseKey })
      const initResult = await adapter.init()
      if (initResult.success) {
        warnings.push('Supabase connected')
        dataAdapter = adapter
      } else {
        warnings.push(`Supabase: ${initResult.error}`)
      }
    }
  } else if (dataEngine === 'sqlite') {
    const adapter = new SQLiteAdapter(HUGHMANN_HOME)
    const initResult = await adapter.init()
    if (initResult.success) {
      warnings.push('SQLite connected')
      dataAdapter = adapter
    } else {
      warnings.push(`SQLite: ${initResult.error}`)
    }
  } else if (dataEngine === 'turso') {
    const tursoUrl = process.env.TURSO_URL
    const tursoAuthToken = process.env.TURSO_AUTH_TOKEN
    if (tursoUrl && tursoAuthToken) {
      const { TursoAdapter } = await import('../adapters/data/turso.js')
      const adapter = new TursoAdapter({ url: tursoUrl, authToken: tursoAuthToken })
      const initResult = await adapter.init()
      if (initResult.success) {
        warnings.push('Turso connected')
        dataAdapter = adapter
      } else {
        warnings.push(`Turso: ${initResult.error}`)
      }
    }
  } else if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    // Fallback: if env vars are set but no config, still try Supabase
    const adapter = new SupabaseAdapter({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY })
    const initResult = await adapter.init()
    if (initResult.success) {
      warnings.push('Supabase connected')
      dataAdapter = adapter
    } else {
      warnings.push(`Supabase: ${initResult.error}`)
    }
  }

  if (dataAdapter) {
    memory.setDataAdapter(dataAdapter)

    // Seed self-improvement project if it doesn't exist
    dataAdapter.getProjectBySlug('self-improvement').then(existing => {
      if (existing) return
      return dataAdapter.createProject({
        name: 'Self-Improvement',
        slug: 'self-improvement',
        description: 'Permanent project for tracking and resolving Hugh\'s capability gaps. Auto-populated from distillation analysis and daemon failures.',
        domain: 'personal',
        status: 'active',
        goals: ['Identify capability gaps proactively', 'Reduce recurring failures', 'Improve autonomously over time'],
      })
    }).catch(() => {}) // Best-effort, never blocks boot
  }

  // Create internal tool server (task management, project listing, planning, etc.)
  const contextWriter = new ContextWriter(contextDir)
  let internalToolServer: unknown
  if (dataAdapter) {
    try {
      const { createInternalToolServer } = await import('../tools/internal-tools.js')
      internalToolServer = createInternalToolServer(dataAdapter, contextResult.store, contextWriter, memory)
      warnings.push('Internal tools available (tasks, projects, planning)')
    } catch {
      // Best-effort — internal tools are optional
    }
  }

  // Initialize usage tracker
  const usage = new UsageTracker(HUGHMANN_HOME)

  const runtime = new Runtime(contextResult.store, router, contextDir, sessions, memory, mcpConfig.servers, skills, dataAdapter, usage, internalToolServer)

  return { success: true, runtime, warnings, errors }
}

