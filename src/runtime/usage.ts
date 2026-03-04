import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ─── Cost Table (per 1M tokens) ────────────────────────────────────────────
// Source: Anthropic & OpenRouter pricing as of 2025

const COST_TABLE: Record<string, { input: number; output: number }> = {
  // Claude models (per 1M tokens in USD)
  'claude-opus-4-6':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':  { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  // Common OpenRouter models
  'anthropic/claude-haiku': { input: 0.25, output: 1.25 },
  'anthropic/claude-sonnet': { input: 3.00, output: 15.00 },
}

export interface UsageEntry {
  timestamp: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  domain: string | null
  source: string // 'chat' | 'skill' | 'task' | 'distill'
}

export interface UsageSummary {
  today: { tokens: number; costUsd: number; calls: number }
  week: { tokens: number; costUsd: number; calls: number }
  month: { tokens: number; costUsd: number; calls: number }
  byDomain: Record<string, { tokens: number; costUsd: number }>
  bySource: Record<string, { tokens: number; costUsd: number }>
}

export interface UsageLimits {
  dailyUsd: number
  monthlyUsd: number
  warningThreshold: number // 0-1, e.g. 0.8 = warn at 80%
}

const DEFAULT_LIMITS: UsageLimits = {
  dailyUsd: 10,
  monthlyUsd: 100,
  warningThreshold: 0.8,
}

export class UsageTracker {
  private dataDir: string
  private limits: UsageLimits

  constructor(hughmannHome: string) {
    this.dataDir = join(hughmannHome, 'usage')
    mkdirSync(this.dataDir, { recursive: true })
    this.limits = this.loadLimits()
  }

  /**
   * Record a usage event.
   * Returns a warning string if approaching or exceeding limits.
   */
  record(entry: Omit<UsageEntry, 'timestamp' | 'costUsd'> & { costUsd?: number }): string | null {
    const cost = entry.costUsd ?? this.estimateCost(entry.model, entry.inputTokens, entry.outputTokens)

    const fullEntry: UsageEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      costUsd: cost,
    }

    this.appendEntry(fullEntry)
    return this.checkLimits()
  }

  /** Estimate cost from model and token counts */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = COST_TABLE[model]
    if (!pricing) return 0

    return (inputTokens / 1_000_000) * pricing.input +
           (outputTokens / 1_000_000) * pricing.output
  }

  /** Get usage summary for today, this week, and this month */
  getSummary(): UsageSummary {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]

    // Get start of week (Monday)
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const weekStartStr = weekStart.toISOString().split('T')[0]

    // Get start of month
    const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    const entries = this.loadMonth(now.getFullYear(), now.getMonth() + 1)

    const summary: UsageSummary = {
      today: { tokens: 0, costUsd: 0, calls: 0 },
      week: { tokens: 0, costUsd: 0, calls: 0 },
      month: { tokens: 0, costUsd: 0, calls: 0 },
      byDomain: {},
      bySource: {},
    }

    for (const e of entries) {
      const dateStr = e.timestamp.split('T')[0]
      const tokens = e.inputTokens + e.outputTokens

      // Month totals
      if (dateStr >= monthStartStr) {
        summary.month.tokens += tokens
        summary.month.costUsd += e.costUsd
        summary.month.calls++
      }

      // Week totals
      if (dateStr >= weekStartStr) {
        summary.week.tokens += tokens
        summary.week.costUsd += e.costUsd
        summary.week.calls++
      }

      // Today totals
      if (dateStr === todayStr) {
        summary.today.tokens += tokens
        summary.today.costUsd += e.costUsd
        summary.today.calls++
      }

      // By domain
      const domain = e.domain ?? 'general'
      if (!summary.byDomain[domain]) {
        summary.byDomain[domain] = { tokens: 0, costUsd: 0 }
      }
      summary.byDomain[domain].tokens += tokens
      summary.byDomain[domain].costUsd += e.costUsd

      // By source
      if (!summary.bySource[e.source]) {
        summary.bySource[e.source] = { tokens: 0, costUsd: 0 }
      }
      summary.bySource[e.source].tokens += tokens
      summary.bySource[e.source].costUsd += e.costUsd
    }

    return summary
  }

  /** Check if current usage is approaching or exceeding limits */
  checkLimits(): string | null {
    const summary = this.getSummary()

    if (summary.today.costUsd >= this.limits.dailyUsd) {
      return `Daily limit exceeded ($${summary.today.costUsd.toFixed(2)} / $${this.limits.dailyUsd})`
    }

    if (summary.month.costUsd >= this.limits.monthlyUsd) {
      return `Monthly limit exceeded ($${summary.month.costUsd.toFixed(2)} / $${this.limits.monthlyUsd})`
    }

    if (summary.today.costUsd >= this.limits.dailyUsd * this.limits.warningThreshold) {
      return `Approaching daily limit ($${summary.today.costUsd.toFixed(2)} / $${this.limits.dailyUsd})`
    }

    if (summary.month.costUsd >= this.limits.monthlyUsd * this.limits.warningThreshold) {
      return `Approaching monthly limit ($${summary.month.costUsd.toFixed(2)} / $${this.limits.monthlyUsd})`
    }

    return null
  }

  /** Check if we're over any hard limit */
  isOverLimit(): boolean {
    const summary = this.getSummary()
    return summary.today.costUsd >= this.limits.dailyUsd ||
           summary.month.costUsd >= this.limits.monthlyUsd
  }

  /** Update spending limits */
  setLimits(limits: Partial<UsageLimits>): void {
    this.limits = { ...this.limits, ...limits }
    this.saveLimits()
  }

  getLimits(): UsageLimits {
    return { ...this.limits }
  }

  /** Format a readable usage report */
  formatReport(): string {
    const s = this.getSummary()
    const lines: string[] = []

    lines.push('## Usage Report')
    lines.push('')
    lines.push(`| Period | Calls | Tokens | Cost |`)
    lines.push(`|--------|-------|--------|------|`)
    lines.push(`| Today  | ${s.today.calls} | ${formatTokens(s.today.tokens)} | $${s.today.costUsd.toFixed(4)} |`)
    lines.push(`| Week   | ${s.week.calls} | ${formatTokens(s.week.tokens)} | $${s.week.costUsd.toFixed(4)} |`)
    lines.push(`| Month  | ${s.month.calls} | ${formatTokens(s.month.tokens)} | $${s.month.costUsd.toFixed(4)} |`)

    const domainEntries = Object.entries(s.byDomain).sort((a, b) => b[1].costUsd - a[1].costUsd)
    if (domainEntries.length > 0) {
      lines.push('')
      lines.push('### By Domain')
      for (const [domain, data] of domainEntries) {
        lines.push(`- ${domain}: ${formatTokens(data.tokens)} tokens, $${data.costUsd.toFixed(4)}`)
      }
    }

    const sourceEntries = Object.entries(s.bySource).sort((a, b) => b[1].costUsd - a[1].costUsd)
    if (sourceEntries.length > 0) {
      lines.push('')
      lines.push('### By Source')
      for (const [source, data] of sourceEntries) {
        lines.push(`- ${source}: ${formatTokens(data.tokens)} tokens, $${data.costUsd.toFixed(4)}`)
      }
    }

    lines.push('')
    lines.push(`Limits: $${this.limits.dailyUsd}/day, $${this.limits.monthlyUsd}/month`)

    return lines.join('\n')
  }

  // ─── Storage ────────────────────────────────────────────────────────────

  private appendEntry(entry: UsageEntry): void {
    const date = new Date(entry.timestamp)
    const filename = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}.jsonl`
    const path = join(this.dataDir, filename)

    const line = JSON.stringify(entry) + '\n'
    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf-8')
      writeFileSync(path, existing + line, 'utf-8')
    } else {
      writeFileSync(path, line, 'utf-8')
    }
  }

  private loadMonth(year: number, month: number): UsageEntry[] {
    const filename = `${year}-${String(month).padStart(2, '0')}.jsonl`
    const path = join(this.dataDir, filename)

    if (!existsSync(path)) return []

    try {
      const content = readFileSync(path, 'utf-8')
      return content.split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as UsageEntry)
    } catch {
      return []
    }
  }

  private loadLimits(): UsageLimits {
    const path = join(this.dataDir, 'limits.json')
    if (!existsSync(path)) return { ...DEFAULT_LIMITS }
    try {
      const raw = readFileSync(path, 'utf-8')
      return { ...DEFAULT_LIMITS, ...JSON.parse(raw) }
    } catch {
      return { ...DEFAULT_LIMITS }
    }
  }

  private saveLimits(): void {
    const path = join(this.dataDir, 'limits.json')
    writeFileSync(path, JSON.stringify(this.limits, null, 2), 'utf-8')
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
