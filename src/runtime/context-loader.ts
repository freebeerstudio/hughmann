import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ContextDocument, ContextStore, DomainContext, IsolationZone } from '../types/context.js'

function extractTitle(raw: string): string {
  const match = raw.match(/^#\s+(.+)/m)
  return match ? match[1].trim() : 'Untitled'
}

function readDoc(path: string, type: ContextDocument['meta']['type']): ContextDocument {
  const raw = readFileSync(path, 'utf-8')
  return {
    path,
    raw,
    meta: {
      title: extractTitle(raw),
      type,
    },
  }
}

function _classifyFile(filename: string): ContextDocument['meta']['type'] | null {
  const base = filename.replace(/\.md$/, '')
  const map: Record<string, ContextDocument['meta']['type']> = {
    soul: 'soul',
    owner: 'owner',
    'master-plan': 'master-plan',
    capabilities: 'capabilities',
    growth: 'growth',
  }
  return map[base] ?? null
}

interface IsolationMap {
  isolated: Set<string>
  personal: Set<string>
}

/**
 * Parse soul.md to extract domain isolation zones.
 * Looks for "### Isolated Domains" and "### Personal Domains" sections,
 * then extracts bold domain names from bullet points.
 * Also parses "see domains/slug.md" references to capture file-based mapping.
 */
function parseIsolationZones(soulRaw: string): IsolationMap {
  const result: IsolationMap = { isolated: new Set(), personal: new Set() }

  // Split into sections by ### headings
  const sections = soulRaw.split(/^###\s+/m)

  for (const section of sections) {
    const firstLine = section.split('\n')[0].trim().toLowerCase()

    if (firstLine === 'isolated domains') {
      // Extract bold domain names: - **Name** (type) ...
      const nameMatches = section.matchAll(/^\s*-\s+\*\*([^*]+)\*\*/gm)
      for (const m of nameMatches) {
        result.isolated.add(m[1].trim().toLowerCase())
      }
      // Also extract slug references: domains/slug.md
      const slugMatches = section.matchAll(/domains\/([a-z0-9-]+)\.md/g)
      for (const m of slugMatches) {
        result.isolated.add(m[1])
      }
    } else if (firstLine === 'personal domains') {
      // Personal domains can be listed as: - **Name**, **Name2**
      const nameMatches = section.matchAll(/\*\*([^*]+)\*\*/g)
      for (const m of nameMatches) {
        result.personal.add(m[1].trim().toLowerCase())
      }
      const slugMatches = section.matchAll(/domains\/([a-z0-9-]+)\.md/g)
      for (const m of slugMatches) {
        result.personal.add(m[1])
      }
    }
  }

  return result
}

function _slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Determine a domain's isolation zone by cross-referencing with soul.md parsed data.
 * If not found in either set, defaults to 'personal' (safer default for unknown domains).
 */
function resolveIsolation(domainName: string, slug: string, isolation: IsolationMap): IsolationZone {
  const lower = domainName.toLowerCase()

  // Check exact name match or slug match
  if (isolation.isolated.has(lower) || isolation.isolated.has(slug)) return 'isolated'
  if (isolation.personal.has(lower) || isolation.personal.has(slug)) return 'personal'

  // Default: personal (less restrictive, lets info flow between unknowns)
  return 'personal'
}

/**
 * Extract domain type from the domain doc content.
 * Looks for "- **Type**: career" style lines.
 */
function extractDomainType(raw: string): string {
  const match = raw.match(/^\s*-\s+\*\*Type\*\*:\s*(.+)/m)
  return match ? match[1].trim() : 'unknown'
}

export interface LoadContextResult {
  store: ContextStore
  warnings: string[]
}

export function loadContext(contextDir: string): LoadContextResult {
  const warnings: string[] = []
  const domainsDir = join(contextDir, 'domains')

  // Read core documents
  const soulPath = join(contextDir, 'soul.md')
  const ownerPath = join(contextDir, 'owner.md')

  if (!existsSync(soulPath)) {
    throw new Error(`Missing required context document: soul.md\nRun \`hughmann setup\` to generate context documents.`)
  }
  if (!existsSync(ownerPath)) {
    throw new Error(`Missing required context document: owner.md\nRun \`hughmann setup\` to generate context documents.`)
  }

  const soul = readDoc(soulPath, 'soul')
  const owner = readDoc(ownerPath, 'owner')

  // Optional core docs
  const masterPlanPath = join(contextDir, 'master-plan.md')
  const capabilitiesPath = join(contextDir, 'capabilities.md')
  const growthPath = join(contextDir, 'growth.md')

  const masterPlan = existsSync(masterPlanPath) ? readDoc(masterPlanPath, 'master-plan') : null
  const capabilities = existsSync(capabilitiesPath) ? readDoc(capabilitiesPath, 'capabilities') : null
  const growth = existsSync(growthPath) ? readDoc(growthPath, 'growth') : null

  if (!masterPlan) warnings.push('master-plan.md not found (optional)')
  if (!capabilities) warnings.push('capabilities.md not found (optional)')
  if (!growth) warnings.push('growth.md not found (optional)')

  // Parse isolation zones from soul.md
  const isolation = parseIsolationZones(soul.raw)

  // Load domain documents
  const domains = new Map<string, DomainContext>()

  if (existsSync(domainsDir)) {
    const domainFiles = readdirSync(domainsDir).filter(f => f.endsWith('.md'))

    for (const file of domainFiles) {
      const filePath = join(domainsDir, file)
      const doc = readDoc(filePath, 'domain')
      const slug = file.replace(/\.md$/, '')
      const name = doc.meta.title
      const domainType = extractDomainType(doc.raw)
      const zone = resolveIsolation(name, slug, isolation)

      domains.set(slug, {
        name,
        slug,
        domainType,
        isolation: zone,
        document: doc,
      })
    }
  } else {
    warnings.push('No domains/ directory found')
  }

  // Extract config from context docs
  const systemName = soul.meta.title
  const ownerName = owner.meta.title
  const timezoneMatch = owner.raw.match(/\*\*Timezone\*\*:\s*(.+)/m)
  const timezone = timezoneMatch ? timezoneMatch[1].trim() : 'UTC'

  const store: ContextStore = {
    soul,
    owner,
    masterPlan,
    capabilities,
    growth,
    domains,
    config: { systemName, ownerName, timezone },
    loadedAt: new Date(),
  }

  return { store, warnings }
}

export function reloadContext(contextDir: string): LoadContextResult {
  return loadContext(contextDir)
}
