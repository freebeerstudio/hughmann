import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Provides structured write operations to context documents.
 * These are the only ways the runtime should mutate context docs —
 * always append or update specific sections, never overwrite whole files.
 */
export class ContextWriter {
  private contextDir: string

  constructor(contextDir: string) {
    this.contextDir = contextDir
  }

  /**
   * Append a row to the Decision Log table in master-plan.md.
   */
  logDecision(decision: string, reasoning: string, domain: string): boolean {
    const path = join(this.contextDir, 'master-plan.md')
    if (!existsSync(path)) return false

    const content = readFileSync(path, 'utf-8')
    const date = new Date().toISOString().split('T')[0]
    const newRow = `| ${date} | ${decision} | ${reasoning} | ${domain} |`

    // Find the decision log table and append before the last empty row
    const tablePattern = /(\| Date \| Decision \| Reasoning \| Domain \|\n\|[-|]+\|)/
    const match = content.match(tablePattern)

    if (!match) return false

    // Find the end of the table header and existing rows
    const headerEnd = content.indexOf(match[0]) + match[0].length
    const afterHeader = content.slice(headerEnd)

    // Insert the new row right after the table header separator
    const updated = content.slice(0, headerEnd) + '\n' + newRow + afterHeader

    writeFileSync(path, updated, 'utf-8')
    return true
  }

  /**
   * Append a capability gap to the capabilities.md table.
   */
  logCapabilityGap(capability: string, status: string = 'Identified', solution: string = '_Pending_'): boolean {
    const path = join(this.contextDir, 'capabilities.md')
    if (!existsSync(path)) return false

    const content = readFileSync(path, 'utf-8')
    const date = new Date().toISOString().split('T')[0]
    const newRow = `| ${capability} | ${date} | ${status} | ${solution} |`

    const tablePattern = /(\| Capability Needed \| Discovered \| Status \| Solution \|\n\|[-|]+\|)/
    const match = content.match(tablePattern)

    if (!match) return false

    const headerEnd = content.indexOf(match[0]) + match[0].length
    const afterHeader = content.slice(headerEnd)

    const updated = content.slice(0, headerEnd) + '\n' + newRow + afterHeader

    writeFileSync(path, updated, 'utf-8')
    return true
  }

  /**
   * Update the Weekly Focus section in master-plan.md.
   */
  updateWeeklyFocus(bigRocks: string[], dailyMust?: string): boolean {
    const path = join(this.contextDir, 'master-plan.md')
    if (!existsSync(path)) return false

    let content = readFileSync(path, 'utf-8')

    // Replace Big Rocks section
    const rocksBlock = bigRocks.map((r, i) => `${i + 1}. ${r}`).join('\n')
    content = content.replace(
      /### Big Rocks This Week\n\n[\s\S]*?(?=\n### |## )/,
      `### Big Rocks This Week\n\n${rocksBlock}\n\n`
    )

    // Replace Daily MUSTs if provided
    if (dailyMust) {
      content = content.replace(
        /### Daily MUSTs\n\n[\s\S]*?(?=\n## )/,
        `### Daily MUSTs\n\n${dailyMust}\n\n`
      )
    }

    writeFileSync(path, content, 'utf-8')
    return true
  }

  /**
   * Append a note to the Notes section of a domain document.
   */
  appendDomainNote(domainSlug: string, note: string): boolean {
    const path = join(this.contextDir, 'domains', `${domainSlug}.md`)
    if (!existsSync(path)) return false

    let content = readFileSync(path, 'utf-8')
    const date = new Date().toISOString().split('T')[0]
    const entry = `- **${date}**: ${note}`

    // Find the Notes section and append
    const notesIdx = content.indexOf('## Notes')
    if (notesIdx === -1) {
      // Add Notes section at end
      content += `\n## Notes\n\n${entry}\n`
    } else {
      // Find the end of the Notes section (next ## or EOF)
      const afterNotes = content.slice(notesIdx)
      const nextSection = afterNotes.indexOf('\n## ', 4)
      if (nextSection === -1) {
        // Notes is the last section — append at end
        content = content.trimEnd() + '\n' + entry + '\n'
      } else {
        const insertAt = notesIdx + nextSection
        content = content.slice(0, insertAt) + entry + '\n' + content.slice(insertAt)
      }
    }

    writeFileSync(path, content, 'utf-8')
    return true
  }

  /**
   * Read the current content of any context document.
   */
  readDoc(relativePath: string): string | null {
    const path = join(this.contextDir, relativePath)
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf-8')
  }

  /**
   * Append arbitrary text to a section of a context document.
   * Finds the section by heading and appends before the next section.
   */
  appendToSection(relativePath: string, sectionHeading: string, text: string): boolean {
    const path = join(this.contextDir, relativePath)
    if (!existsSync(path)) return false

    let content = readFileSync(path, 'utf-8')
    const headingPattern = new RegExp(`^(#{1,3})\\s+${escapeRegex(sectionHeading)}`, 'm')
    const match = content.match(headingPattern)
    if (!match || match.index === undefined) return false

    const headingLevel = match[1]
    const afterHeading = content.slice(match.index + match[0].length)

    // Find next heading of same or higher level
    const nextHeadingPattern = new RegExp(`^#{1,${headingLevel.length}}\\s+`, 'm')
    const nextMatch = afterHeading.match(nextHeadingPattern)

    if (nextMatch && nextMatch.index !== undefined) {
      const insertAt = match.index + match[0].length + nextMatch.index
      content = content.slice(0, insertAt) + text + '\n\n' + content.slice(insertAt)
    } else {
      // Last section — append at end
      content = content.trimEnd() + '\n\n' + text + '\n'
    }

    writeFileSync(path, content, 'utf-8')
    return true
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
