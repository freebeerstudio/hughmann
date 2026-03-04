import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { OnboardingResult, SystemIdentity, UserIdentity, LifeDomain, InfrastructureChoices, AutonomySettings } from './onboarding/types.js'

export interface HughmannConfig {
  system: SystemIdentity | null
  user: UserIdentity | null
  domains: LifeDomain[] | null
  infrastructure: InfrastructureChoices | null
  autonomy: AutonomySettings | null
}

export const HUGHMANN_HOME = process.env.HUGHMANN_HOME || join(homedir(), '.hughmann')
const CONFIG_PATH = join(HUGHMANN_HOME, '.onboarding-data.json')

export function emptyConfig(): HughmannConfig {
  return {
    system: null,
    user: null,
    domains: null,
    infrastructure: null,
    autonomy: null,
  }
}

export function loadConfig(): HughmannConfig {
  if (!existsSync(CONFIG_PATH)) return emptyConfig()
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const data = JSON.parse(raw)
    return {
      system: data.system ?? null,
      user: data.user ?? null,
      domains: data.domains ?? null,
      infrastructure: data.infrastructure ?? null,
      autonomy: data.autonomy ?? null,
    }
  } catch {
    return emptyConfig()
  }
}

export function saveConfig(config: HughmannConfig): void {
  mkdirSync(HUGHMANN_HOME, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export function isComplete(config: HughmannConfig): boolean {
  return !!(config.system && config.user && config.domains && config.infrastructure && config.autonomy)
}

export function completedCount(config: HughmannConfig): number {
  return [config.system, config.user, config.domains, config.infrastructure, config.autonomy]
    .filter(Boolean).length
}

export function toOnboardingResult(config: HughmannConfig): OnboardingResult {
  return {
    system: config.system!,
    user: config.user!,
    domains: config.domains!,
    infrastructure: config.infrastructure!,
    autonomy: config.autonomy!,
  }
}
