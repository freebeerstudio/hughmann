import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../config.js'
import { loadContext } from './context-loader.js'
import { createModelAdapters } from '../adapters/model/index.js'
import { ModelRouter } from './model-router.js'
import { Runtime } from './runtime.js'
import { SessionManager } from './session.js'
import { MemoryManager } from './memory.js'
import { loadMcpConfig } from './mcp-config.js'
import { SkillManager } from './skills.js'
import { SupabaseAdapter } from '../adapters/data/supabase.js'
import { createEmbeddingAdapter } from '../adapters/embeddings/index.js'

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

  // Initialize Supabase if configured
  let supabase: SupabaseAdapter | undefined
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (supabaseUrl && supabaseKey) {
    supabase = new SupabaseAdapter({ url: supabaseUrl, key: supabaseKey })
    const initResult = await supabase.init()
    if (initResult.success) {
      warnings.push('Supabase connected')
      memory.setSupabase(supabase)
    } else {
      warnings.push(`Supabase: ${initResult.error}`)
      supabase = undefined
    }
  }

  const runtime = new Runtime(contextResult.store, router, contextDir, sessions, memory, mcpConfig.servers, skills, supabase)

  return { success: true, runtime, warnings, errors }
}

/**
 * Simple .env file loader. Reads KEY=VALUE lines and sets them on process.env.
 * Doesn't override existing env vars.
 */
function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      let value = trimmed.slice(eqIndex + 1).trim()
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // Silently ignore .env read errors
  }
}
