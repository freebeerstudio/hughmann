import type { ContextStore, DomainContext } from '../types/context.js'

export interface PromptOptions {
  activeDomain?: string
  includeMasterPlan?: boolean
  includeGrowth?: boolean
  maxLength?: number
}

/**
 * Assembles the system prompt from context documents with domain isolation enforcement.
 *
 * Layering:
 * 1. Soul (always)
 * 2. Owner (always)
 * 3. Capabilities (always)
 * 4. Domain context (conditionally, based on isolation):
 *    - Isolated domain active → ONLY that domain's doc
 *    - Personal domain active → that domain + all other personal domains
 *    - No domain → no individual domain docs (owner.md has summaries)
 * 5. Master Plan (if includeMasterPlan)
 * 6. Growth (if includeGrowth)
 * 7. Environment block (current date/time, timezone, active domain)
 */
export function buildSystemPrompt(context: ContextStore, options?: PromptOptions): string {
  const {
    activeDomain,
    includeMasterPlan = true,
    includeGrowth = false,
    maxLength,
  } = options ?? {}

  const sections: string[] = []

  // 1. Soul — always included
  sections.push(context.soul.raw)

  // 2. Owner — always included
  sections.push(context.owner.raw)

  // 3. Capabilities — always included
  if (context.capabilities) {
    sections.push(context.capabilities.raw)
  }

  // 4. Domain context — conditionally based on isolation
  if (activeDomain) {
    const domain = context.domains.get(activeDomain)

    if (domain) {
      if (domain.isolation === 'isolated') {
        // Isolated: ONLY this domain's doc, nothing else
        sections.push(buildDomainSection(domain, true))
      } else {
        // Personal: include this domain + all other personal domains
        const personalDomains = Array.from(context.domains.values())
          .filter(d => d.isolation === 'personal')

        for (const d of personalDomains) {
          sections.push(buildDomainSection(d, d.slug === activeDomain))
        }
      }
    }
  }

  // 5. Master Plan — for conversational/autonomous
  if (includeMasterPlan && context.masterPlan) {
    sections.push(context.masterPlan.raw)
  }

  // 6. Growth — for autonomous tasks
  if (includeGrowth && context.growth) {
    sections.push(context.growth.raw)
  }

  // 7. Environment block
  const now = new Date()
  const envLines = [
    '---',
    '## Environment',
    `- **Current time**: ${now.toLocaleString('en-US', { timeZone: context.config.timezone })}`,
    `- **Timezone**: ${context.config.timezone}`,
    `- **Active domain**: ${activeDomain ? (context.domains.get(activeDomain)?.name ?? activeDomain) : 'None (general)'}`,
    `- **Mode**: conversational`,
  ]
  sections.push(envLines.join('\n'))

  let prompt = sections.join('\n\n---\n\n')

  // Truncate if needed
  if (maxLength && prompt.length > maxLength) {
    prompt = prompt.slice(0, maxLength) + '\n\n[System prompt truncated due to length]'
  }

  return prompt
}

function buildDomainSection(domain: DomainContext, isActive: boolean): string {
  const header = isActive
    ? `## Active Domain: ${domain.name} [${domain.isolation.toUpperCase()}]`
    : `## Context: ${domain.name} [${domain.isolation.toUpperCase()}]`

  return `${header}\n\n${domain.document.raw}`
}
