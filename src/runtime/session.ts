import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ModelMessage } from '../types/model.js'

export interface Session {
  id: string
  title: string
  domain: string | null
  messages: ModelMessage[]
  createdAt: string
  updatedAt: string
}

export interface SessionSummary {
  id: string
  title: string
  domain: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

const MAX_CONTEXT_MESSAGES = 50

export class SessionManager {
  private sessionsDir: string
  private current: Session | null = null

  constructor(hughmannHome: string) {
    this.sessionsDir = join(hughmannHome, 'sessions')
    mkdirSync(this.sessionsDir, { recursive: true })
  }

  /** Create a new session */
  create(domain: string | null): Session {
    const now = new Date().toISOString()
    this.current = {
      id: randomUUID(),
      title: 'New conversation',
      domain,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    this.save()
    return this.current
  }

  /** Get the active session, creating one if none exists */
  getOrCreate(domain: string | null): Session {
    if (this.current) return this.current
    return this.create(domain)
  }

  /** Load a session by ID */
  load(id: string): Session | null {
    const path = join(this.sessionsDir, `${id}.json`)
    if (!existsSync(path)) return null
    try {
      const raw = readFileSync(path, 'utf-8')
      this.current = JSON.parse(raw) as Session
      return this.current
    } catch {
      return null
    }
  }

  /** Load the most recent session */
  loadLatest(): Session | null {
    const sessions = this.list()
    if (sessions.length === 0) return null
    return this.load(sessions[0].id)
  }

  /** Add a message pair (user + assistant) and auto-save */
  addTurn(userMessage: string, assistantMessage: string): void {
    const session = this.current
    if (!session) return

    session.messages.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantMessage },
    )

    // Auto-title from first user message
    if (session.title === 'New conversation' && session.messages.length === 2) {
      session.title = userMessage.length > 60
        ? userMessage.slice(0, 57) + '...'
        : userMessage
    }

    session.updatedAt = new Date().toISOString()
    this.save()
  }

  /** Get messages for the model, trimmed to context window */
  getContextMessages(): ModelMessage[] {
    if (!this.current) return []
    const msgs = this.current.messages
    if (msgs.length <= MAX_CONTEXT_MESSAGES) return [...msgs]
    // Keep the most recent messages, always starting on a user message
    const start = msgs.length - MAX_CONTEXT_MESSAGES
    const adjusted = start % 2 === 0 ? start : start + 1
    return msgs.slice(adjusted)
  }

  /** Update the domain on the current session */
  setDomain(domain: string | null): void {
    if (!this.current) return
    this.current.domain = domain
    this.save()
  }

  /** List all sessions, most recent first */
  list(): SessionSummary[] {
    if (!existsSync(this.sessionsDir)) return []

    const files = readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'))
    const summaries: SessionSummary[] = []

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.sessionsDir, file), 'utf-8')
        const session = JSON.parse(raw) as Session
        summaries.push({
          id: session.id,
          title: session.title,
          domain: session.domain,
          messageCount: session.messages.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })
      } catch {
        // Skip corrupt session files
      }
    }

    // Sort by most recently updated
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return summaries
  }

  /** Get the current session */
  getCurrent(): Session | null {
    return this.current
  }

  /** Start a fresh session (keeps the old one on disk) */
  newSession(domain: string | null): Session {
    return this.create(domain)
  }

  private save(): void {
    if (!this.current) return
    const path = join(this.sessionsDir, `${this.current.id}.json`)
    writeFileSync(path, JSON.stringify(this.current, null, 2), 'utf-8')
  }
}
