/**
 * Trigger.dev task: Sync local context docs to Supabase context_docs table.
 * This enables cloud tasks to access the same context as local runtime.
 *
 * Run locally via: hughmann trigger sync
 * Automatically runs on boot when Trigger.dev is configured.
 */

import { task } from '@trigger.dev/sdk/v3'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { getSupabaseClient } from './utils.js'

interface ContextDoc {
  id: string
  doc_type: string
  title: string
  content: string
  domain_slug: string | null
  isolation_zone: string | null
  content_hash: string
}

export const syncContextDocs = task({
  id: 'sync-context-docs',
  run: async (payload: { contextDir: string }) => {
    const client = getSupabaseClient()
    const contextDir = payload.contextDir

    if (!existsSync(contextDir)) {
      return { success: false, error: 'Context directory not found' }
    }

    const docs: ContextDoc[] = []

    // Read core context files (soul.md, owner.md, master-plan.md, etc.)
    const coreFiles = readdirSync(contextDir).filter(f => f.endsWith('.md'))
    for (const file of coreFiles) {
      const filePath = join(contextDir, file)
      const content = readFileSync(filePath, 'utf-8')
      const name = basename(file, extname(file))
      const contentHash = createHash('sha256').update(content).digest('hex')
      const doc = parseCoreFile(name, content, contentHash)
      if (doc) docs.push(doc)
    }

    // Read domain context files (domains/*.md)
    const domainsDir = join(contextDir, 'domains')
    if (existsSync(domainsDir)) {
      const domainFiles = readdirSync(domainsDir).filter(f => f.endsWith('.md'))
      for (const file of domainFiles) {
        const filePath = join(domainsDir, file)
        const content = readFileSync(filePath, 'utf-8')
        const slug = basename(file, extname(file))
        const contentHash = createHash('sha256').update(content).digest('hex')
        const doc = parseDomainFile(slug, content, contentHash)
        docs.push(doc)
      }
    }

    // Upsert all docs
    let synced = 0
    let skipped = 0

    for (const doc of docs) {
      // Check if unchanged
      const { data: existing } = await client
        .from('context_docs')
        .select('content_hash')
        .eq('id', doc.id)
        .single()

      if (existing?.content_hash === doc.content_hash) {
        skipped++
        continue
      }

      await client.from('context_docs').upsert({
        id: doc.id,
        doc_type: doc.doc_type,
        title: doc.title,
        content: doc.content,
        domain_slug: doc.domain_slug,
        isolation_zone: doc.isolation_zone,
        content_hash: doc.content_hash,
        updated_at: new Date().toISOString(),
      })
      synced++
    }

    return { success: true, total: docs.length, synced, skipped }
  },
})

function parseCoreFile(name: string, content: string, hash: string): ContextDoc | null {
  const titleMatch = content.match(/^#\s+(.+)/m)
  const title = titleMatch?.[1] ?? name

  const typeMap: Record<string, string> = {
    soul: 'soul',
    owner: 'owner',
    'master-plan': 'master-plan',
    capabilities: 'capabilities',
    growth: 'growth',
    habits: 'habits',
  }

  const docType = typeMap[name.toLowerCase()]
  if (!docType) {
    // Generic document
    return { id: name, doc_type: 'other', title, content, domain_slug: null, isolation_zone: null, content_hash: hash }
  }

  return { id: docType, doc_type: docType, title, content, domain_slug: null, isolation_zone: null, content_hash: hash }
}

function parseDomainFile(slug: string, content: string, hash: string): ContextDoc {
  const titleMatch = content.match(/^#\s+(.+)/m)
  const title = titleMatch?.[1] ?? slug

  // Extract isolation zone from content
  const isoMatch = content.match(/isolation[:\s]+(isolated|personal)/i)
  const isolation = isoMatch?.[1]?.toLowerCase() ?? 'personal'

  return {
    id: `domain-${slug}`,
    doc_type: 'domain',
    title,
    content,
    domain_slug: slug,
    isolation_zone: isolation,
    content_hash: hash,
  }
}
