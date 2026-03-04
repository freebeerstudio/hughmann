import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

/**
 * File watcher for context hot-reload.
 * Watches ~/.hughmann/context/ and triggers a callback when files change.
 *
 * Uses Node.js fs.watch (inotify on Linux, FSEvents on macOS).
 * Debounces rapid changes (e.g. editor save-and-rename patterns).
 */
export class ContextWatcher {
  private watcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number

  constructor(private contextDir: string, debounceMs = 500) {
    this.debounceMs = debounceMs
  }

  /**
   * Start watching the context directory.
   * Calls onReload whenever a .md file changes.
   */
  start(onReload: () => void): void {
    if (this.watcher) return

    try {
      this.watcher = watch(this.contextDir, { recursive: true }, (event, filename) => {
        // Only react to markdown file changes
        if (!filename || !filename.endsWith('.md')) return

        // Debounce: editors often write temp files then rename
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer)
        }

        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null
          onReload()
        }, this.debounceMs)
      })

      this.watcher.on('error', () => {
        // Silently handle watcher errors (directory deleted, etc.)
        this.stop()
      })
    } catch {
      // fs.watch not supported or permission denied — silently degrade
    }
  }

  /** Stop watching. */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  /** Check if the watcher is active. */
  isActive(): boolean {
    return this.watcher !== null
  }
}
