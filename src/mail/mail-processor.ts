/**
 * mail-processor.ts — Mail processing pipeline for the Elle mailbox.
 *
 * Reads new emails from Apple Mail, classifies them with Haiku,
 * writes structured markdown to the vault _inbox/, and tracks state.
 *
 * Ported from Foundry's process-elle-emails.ts, adapted for HughMann patterns.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../config.js'
import { findElleMailbox, listMessages, readFullMessage } from './mail-reader.js'
import { classifyEmail, sanitizeSlugFallback, type ClassifiedEmail } from './mail-classifier.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DAEMON_DIR = join(HUGHMANN_HOME, 'daemon')
const STATE_FILE = join(DAEMON_DIR, 'mail-state.json')
const INBOX_DIR_NAME = '_inbox'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MailPipelineOptions {
  dryRun?: boolean
  limit?: number
}

export interface MailPipelineResult {
  processed: number
  filesWritten: number
  errors: number
  skippedNoise: number
  typeCounts: Record<string, number>
}

interface ProcessedEntry {
  date: string
  type: string
  file: string
}

interface StateFile {
  version: number
  last_run: string
  processed_ids: Record<string, ProcessedEntry>
  stats: {
    total_processed: number
    last_run_count: number
    last_run_errors: number
  }
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function emptyState(): StateFile {
  return {
    version: 1,
    last_run: new Date().toISOString(),
    processed_ids: {},
    stats: { total_processed: 0, last_run_count: 0, last_run_errors: 0 },
  }
}

function loadState(): StateFile {
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed.version !== 1) throw new Error('Unknown state version')
    return parsed
  } catch {
    return emptyState()
  }
}

function saveState(state: StateFile): void {
  mkdirSync(DAEMON_DIR, { recursive: true })
  const tmpFile = STATE_FILE + '.tmp'
  writeFileSync(tmpFile, JSON.stringify(state, null, 2))
  renameSync(tmpFile, STATE_FILE)
}

// ---------------------------------------------------------------------------
// Public: getMailStatus
// ---------------------------------------------------------------------------

export function getMailStatus(): {
  lastRun: string | null
  totalProcessed: number
  lastRunCount: number
  lastRunErrors: number
} {
  if (!existsSync(STATE_FILE)) {
    return { lastRun: null, totalProcessed: 0, lastRunCount: 0, lastRunErrors: 0 }
  }
  const state = loadState()
  return {
    lastRun: state.last_run,
    totalProcessed: Object.keys(state.processed_ids).length,
    lastRunCount: state.stats.last_run_count,
    lastRunErrors: state.stats.last_run_errors,
  }
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

export function generateMailMarkdown(
  classified: ClassifiedEmail,
  email: { sender: string; subject: string; date: string; recipients: string; body: string },
): string {
  const dateStr = parseDate(email.date)

  // Build frontmatter
  const fm: string[] = [
    '---',
    `type: "${classified.type}"`,
    'source: email',
    `date: ${dateStr}`,
    `from: "${email.sender}"`,
    `subject: "${email.subject.replace(/"/g, '\\"')}"`,
  ]

  if (classified.customer_hint) {
    fm.push(`customer_hint: "${classified.customer_hint}"`)
  }
  if (classified.case_id) {
    fm.push(`case_id: "${classified.case_id}"`)
  } else {
    fm.push('case_id: null')
  }
  if (classified.severity) {
    fm.push(`severity: "${classified.severity}"`)
  }
  if (classified.product_hint) {
    fm.push(`product_hint: "${classified.product_hint}"`)
  }
  fm.push('---')

  // Build body
  const sections: string[] = [
    fm.join('\n'),
    '',
    `# ${email.subject}`,
    '',
    `**From:** ${email.sender}`,
    `**Date:** ${email.date}`,
  ]

  if (email.recipients) {
    sections.push(`**To:** ${email.recipients}`)
  }

  // Summary
  sections.push('', '## Summary', classified.summary)

  // Key Points
  if (classified.key_points.length > 0) {
    sections.push('', '## Key Points')
    for (const point of classified.key_points) {
      sections.push(`- ${point}`)
    }
  }

  // Action Items
  if (classified.action_items.length > 0) {
    sections.push('', '## Action Items')
    for (const item of classified.action_items) {
      sections.push(`- ${item}`)
    }
  }

  // Events
  if (classified.events.length > 0) {
    sections.push('', '## Events')
    for (const event of classified.events) {
      sections.push(`- **${event.title}** — ${event.date}`)
      if (event.registration_url) {
        sections.push(`  - Registration: ${event.registration_url}`)
      }
      if (event.details) {
        sections.push(`  - ${event.details}`)
      }
    }
  }

  // Contacts
  if (classified.contacts.length > 0) {
    sections.push('', '## Contacts')
    for (const c of classified.contacts) {
      const parts = [c.name, c.email, c.role].filter(Boolean)
      sections.push(`- ${parts.join(' — ')}`)
    }
  }

  // Original Content
  const cleanBody = stripSignatures(email.body)
  sections.push('', '## Original Content', cleanBody)

  return sections.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runMailPipeline(
  opts: MailPipelineOptions = {},
  onLog?: (msg: string) => void,
): Promise<MailPipelineResult> {
  const log = onLog ?? console.log.bind(console)
  const result: MailPipelineResult = {
    processed: 0,
    filesWritten: 0,
    errors: 0,
    skippedNoise: 0,
    typeCounts: {},
  }

  // 1. Validate env
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY')
  }

  const vaultPath = resolveVaultInboxPath()
  if (!vaultPath && !opts.dryRun) {
    throw new Error('Missing VAULT_OMNISSA_PATH — cannot determine _inbox/ output path')
  }

  // 2. Find Elle mailbox
  log('Finding Elle mailbox...')
  const mailbox = await findElleMailbox()
  if (!mailbox) {
    throw new Error('Could not find "Elle" mailbox in any account')
  }
  log(`Found Elle in account: ${mailbox.account}`)

  // 3. List messages
  log('Listing messages...')
  const messages = await listMessages(mailbox.ref, 100)
  log(`Found ${messages.length} messages in Elle`)

  // 4. Load state
  const state = loadState()
  log(`State: ${Object.keys(state.processed_ids).length} previously processed`)

  // 5. Filter to unprocessed
  const unprocessed = messages.filter((m) => !state.processed_ids[m.messageId])
  log(`Unprocessed: ${unprocessed.length}`)

  if (unprocessed.length === 0) {
    log('No new emails to process.')
    state.last_run = new Date().toISOString()
    state.stats.last_run_count = 0
    state.stats.last_run_errors = 0
    saveState(state)
    return result
  }

  const toProcess = opts.limit ? unprocessed.slice(0, opts.limit) : unprocessed
  log(`Processing: ${toProcess.length}`)

  // 6. Ensure output directory
  const inboxDir = vaultPath ? join(vaultPath, INBOX_DIR_NAME) : null
  if (inboxDir && !opts.dryRun) {
    mkdirSync(inboxDir, { recursive: true })
  }

  // 7. Process each email
  for (const msg of toProcess) {
    try {
      log(`\n[${msg.index}] ${msg.subject}`)

      // Read full body
      const fullEmail = await readFullMessage(mailbox.ref, msg.index)

      // Classify
      let classified: ClassifiedEmail
      try {
        classified = await classifyEmail(apiKey, fullEmail)
      } catch (classErr) {
        log(`  WARN: Classification failed, falling back to "other": ${classErr instanceof Error ? classErr.message : String(classErr)}`)
        classified = {
          type: 'other',
          subject_slug: sanitizeSlugFallback(msg.subject),
          summary: `Email from ${fullEmail.sender} about: ${fullEmail.subject}`,
          key_points: [],
          contacts: [],
          action_items: [],
          customer_hint: '',
          case_id: null,
          severity: null,
          product_hint: null,
          events: [],
        }
      }

      result.typeCounts[classified.type] = (result.typeCounts[classified.type] || 0) + 1
      log(`  Type: ${classified.type} | Slug: ${classified.subject_slug}`)

      // Skip noise
      if (classified.type === 'noise') {
        log('  Skipping noise email (no file written)')
        result.skippedNoise++
        state.processed_ids[msg.messageId] = {
          date: parseDate(msg.date),
          type: 'noise',
          file: '',
        }
        if (!opts.dryRun) saveState(state)
        result.processed++
        continue
      }

      // Generate markdown
      const dateStr = parseDate(fullEmail.date)
      const filename = `${dateStr}-${classified.type}-${classified.subject_slug}.md`
      const markdown = generateMailMarkdown(classified, fullEmail)

      if (opts.dryRun) {
        log(`  [DRY RUN] Would write: ${filename}`)
        log(`  Summary: ${classified.summary.slice(0, 100)}...`)
      } else if (inboxDir) {
        const filePath = join(inboxDir, filename)
        writeFileSync(filePath, markdown, 'utf-8')
        log(`  Wrote: ${filename}`)
        result.filesWritten++
      }

      // Update state
      state.processed_ids[msg.messageId] = {
        date: dateStr,
        type: classified.type,
        file: opts.dryRun ? '' : filename,
      }
      if (!opts.dryRun) saveState(state)
      result.processed++
    } catch (err) {
      result.errors++
      log(`  ERROR processing [${msg.index}] ${msg.subject}: ${err instanceof Error ? err.message : String(err)}`)
      // Do NOT mark as processed — will retry next run
    }
  }

  // 8. Update final stats
  state.last_run = new Date().toISOString()
  state.stats.total_processed = Object.keys(state.processed_ids).length
  state.stats.last_run_count = toProcess.length
  state.stats.last_run_errors = result.errors
  saveState(state)

  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
    return d.toISOString().slice(0, 10)
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function stripSignatures(body: string): string {
  const sigPatterns = [
    /\n--\s*\n[\s\S]*$/,
    /\nSent from my [\s\S]*$/i,
    /\n_{20,}[\s\S]*$/,
  ]
  let cleaned = body
  for (const pattern of sigPatterns) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned.trim()
}

export function resolveVaultInboxPath(): string | null {
  const vaultPath = process.env.VAULT_OMNISSA_PATH
  if (!vaultPath) return null
  return vaultPath
}
