import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../config.js'
import { loadContext } from './context-loader.js'
import { createModelAdapters } from '../adapters/model/index.js'
import { ModelRouter } from './model-router.js'
import { Runtime } from './runtime.js'
import { SessionManager } from './session.js'
import { MemoryManager } from './memory.js'

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
export function boot(): BootResult {
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

  // Create router, session manager, memory manager, and runtime
  const router = new ModelRouter(adapters)
  const sessions = new SessionManager(HUGHMANN_HOME)
  const memory = new MemoryManager(HUGHMANN_HOME)

  // Give memory manager a model adapter for distillation
  // Prefer Claude OAuth (uses haiku tier), fall back to OpenRouter
  const distillAdapter = adapters.find(a => a.id === 'claude-oauth') ?? adapters[0]
  memory.setModel(distillAdapter)

  const runtime = new Runtime(contextResult.store, router, contextDir, sessions, memory)

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
