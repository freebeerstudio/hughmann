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

    if (this.toStderr) {
      process.stderr.write(line)
    }

    if (this.logPath) {
      try {
        appendFileSync(this.logPath, line, 'utf-8')
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
