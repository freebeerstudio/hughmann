/**
 * Plugin System — formal extension points for HughMann.
 *
 * Plugins can hook into lifecycle events, register custom tools,
 * modify prompts, and respond to system events. They are loaded
 * from ~/.hughmann/plugins/ as ES modules.
 *
 * Plugin manifest format (plugin.json):
 * {
 *   "name": "my-plugin",
 *   "version": "1.0.0",
 *   "description": "What it does",
 *   "entry": "index.js",
 *   "hooks": ["onBoot", "onSessionStart", "onTaskComplete"]
 * }
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Task } from '../types/tasks.js'

// ─── Event Types ────────────────────────────────────────────────────────

export type PluginEvent =
  | 'onBoot'
  | 'onShutdown'
  | 'onSessionStart'
  | 'onSessionEnd'
  | 'onTaskCreate'
  | 'onTaskComplete'
  | 'onTaskFail'
  | 'onMemoryDistill'
  | 'onDomainSwitch'
  | 'onPromptBuild'

export interface PluginContext {
  hughmannHome: string
  activeDomain: string | null
  ownerName: string
}

export interface PluginManifest {
  name: string
  version: string
  description: string
  entry: string
  hooks: PluginEvent[]
}

export interface Plugin {
  manifest: PluginManifest
  /** Called on system boot */
  onBoot?: (ctx: PluginContext) => Promise<void> | void
  /** Called on system shutdown */
  onShutdown?: (ctx: PluginContext) => Promise<void> | void
  /** Called when an interactive session starts */
  onSessionStart?: (ctx: PluginContext & { sessionId: string }) => Promise<void> | void
  /** Called when an interactive session ends */
  onSessionEnd?: (ctx: PluginContext & { sessionId: string }) => Promise<void> | void
  /** Called when a task is created */
  onTaskCreate?: (ctx: PluginContext & { task: Task }) => Promise<void> | void
  /** Called when a task completes successfully */
  onTaskComplete?: (ctx: PluginContext & { task: Task; result: string }) => Promise<void> | void
  /** Called when a task fails */
  onTaskFail?: (ctx: PluginContext & { task: Task; error: string }) => Promise<void> | void
  /** Called after memory distillation */
  onMemoryDistill?: (ctx: PluginContext & { distilledContent: string }) => Promise<void> | void
  /** Called when the active domain switches */
  onDomainSwitch?: (ctx: PluginContext & { from: string | null; to: string }) => Promise<void> | void
  /** Called during prompt building — can append content to the system prompt */
  onPromptBuild?: (ctx: PluginContext & { currentPrompt: string }) => Promise<string | null> | string | null
}

// ─── Plugin Manager ─────────────────────────────────────────────────────

export class PluginManager {
  private plugins: Plugin[] = []
  private pluginsDir: string

  constructor(hughmannHome: string) {
    this.pluginsDir = join(hughmannHome, 'plugins')
  }

  /**
   * Load all plugins from the plugins directory.
   * Each plugin is a directory with a plugin.json manifest.
   */
  async loadAll(): Promise<{ loaded: string[]; errors: string[] }> {
    const loaded: string[] = []
    const errors: string[] = []

    if (!existsSync(this.pluginsDir)) {
      return { loaded, errors }
    }

    const entries = readdirSync(this.pluginsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const pluginDir = join(this.pluginsDir, entry.name)
      const manifestPath = join(pluginDir, 'plugin.json')

      if (!existsSync(manifestPath)) {
        errors.push(`${entry.name}: missing plugin.json`)
        continue
      }

      try {
        const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        const entryPath = join(pluginDir, manifest.entry)

        if (!existsSync(entryPath)) {
          errors.push(`${entry.name}: entry file "${manifest.entry}" not found`)
          continue
        }

        const module = await import(entryPath)
        const plugin: Plugin = {
          manifest,
          ...module.default ?? module,
        }

        this.plugins.push(plugin)
        loaded.push(manifest.name)
      } catch (err) {
        errors.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { loaded, errors }
  }

  /**
   * Emit an event to all plugins that listen for it.
   * Errors in individual plugins are caught and logged, never thrown.
   */
  async emit<E extends PluginEvent>(
    event: E,
    ctx: Parameters<NonNullable<Plugin[E]>>[0],
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const handler = plugin[event]
      if (!handler) continue

      try {
        await (handler as (ctx: unknown) => Promise<void> | void)(ctx)
      } catch (err) {
        console.error(`[Plugin:${plugin.manifest.name}] Error in ${event}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  /**
   * Emit onPromptBuild and collect prompt additions.
   * Returns additional prompt content to append, or null.
   */
  async emitPromptBuild(ctx: PluginContext & { currentPrompt: string }): Promise<string | null> {
    const additions: string[] = []

    for (const plugin of this.plugins) {
      if (!plugin.onPromptBuild) continue

      try {
        const result = await plugin.onPromptBuild(ctx)
        if (result) additions.push(result)
      } catch {
        // Best-effort
      }
    }

    return additions.length > 0 ? additions.join('\n\n') : null
  }

  /** Get list of loaded plugins */
  list(): PluginManifest[] {
    return this.plugins.map(p => p.manifest)
  }

  /** Get count of loaded plugins */
  get count(): number {
    return this.plugins.length
  }
}
