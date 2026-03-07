/**
 * Structured Logger — JSON-lines output for daemon and runtime.
 *
 * Writes structured log entries to stderr and optionally to a file.
 * File writes are best-effort (try/catch) to never block the caller.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  ts: string
  level: LogLevel
  component: string
  msg: string
  [key: string]: unknown
}

/**
 * When true, Logger instances suppress stderr output.
 * Set during interactive chat sessions to prevent log noise in the terminal.
 */
let stderrSuppressed = false

/**
 * Global fallback log file path. When set, all Logger instances without
 * their own logPath will write to this file. Set once at boot.
 */
let globalLogPath: string | undefined

export function suppressStderr(suppress: boolean): void {
  stderrSuppressed = suppress
}

export function setGlobalLogPath(logDir: string): void {
  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    // Best-effort
  }
  globalLogPath = join(logDir, 'runtime.jsonl')
}

export class Logger {
  constructor(
    private component: string,
    private logPath?: string,
    private toStderr: boolean = true,
  ) {}

  info(msg: string, extra?: Record<string, unknown>): void {
    this.write('info', msg, extra)
  }

  warn(msg: string, extra?: Record<string, unknown>): void {
    this.write('warn', msg, extra)
  }

  error(msg: string, extra?: Record<string, unknown>): void {
    this.write('error', msg, extra)
  }

  debug(msg: string, extra?: Record<string, unknown>): void {
    this.write('debug', msg, extra)
  }

  private write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg,
      ...extra,
    }

    const line = JSON.stringify(entry) + '\n'

    if (this.toStderr && !stderrSuppressed) {
      process.stderr.write(line)
    }

    const targetPath = this.logPath ?? globalLogPath
    if (targetPath) {
      try {
        appendFileSync(targetPath, line, 'utf-8')
      } catch {
        // Best-effort file write
      }
    }
  }
}

/**
 * Create a logger configured for the daemon — writes to logDir/daemon.jsonl.
 */
export function createDaemonLogger(logDir: string): Logger {
  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    // Best-effort
  }
  return new Logger('daemon', join(logDir, 'daemon.jsonl'))
}
