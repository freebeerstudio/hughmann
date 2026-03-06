/**
 * Skill Registry — discover and install community skills.
 *
 * Skills are hosted as GitHub repos or gists. The registry provides
 * metadata for discovery, and installation downloads the SKILL.md
 * (and optional supporting files) to ~/.hughmann/skills/.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RegistrySkill {
  /** Unique identifier */
  id: string
  /** Display name */
  name: string
  /** Short description */
  description: string
  /** GitHub URL to the skill directory containing SKILL.md */
  url: string
  /** Raw URL to fetch SKILL.md from */
  rawUrl: string
  /** Author name */
  author: string
  /** Keywords for search matching */
  keywords: string[]
  /** Version string */
  version?: string
}

/**
 * Curated registry of community skills.
 * Pull requests to add skills are welcome!
 */
export const SKILL_REGISTRY: RegistrySkill[] = [
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Thorough code review with security, performance, and maintainability analysis',
    url: 'https://github.com/freebeerstudio/hughmann-skills/tree/main/code-review',
    rawUrl: 'https://raw.githubusercontent.com/freebeerstudio/hughmann-skills/main/code-review/SKILL.md',
    author: 'Free Beer Studio',
    keywords: ['code', 'review', 'security', 'quality'],
  },
  {
    id: 'meeting-prep',
    name: 'Meeting Prep',
    description: 'Prepare for meetings with agenda, context, and talking points',
    url: 'https://github.com/freebeerstudio/hughmann-skills/tree/main/meeting-prep',
    rawUrl: 'https://raw.githubusercontent.com/freebeerstudio/hughmann-skills/main/meeting-prep/SKILL.md',
    author: 'Free Beer Studio',
    keywords: ['meeting', 'prep', 'agenda', 'calendar'],
  },
  {
    id: 'email-drafter',
    name: 'Email Drafter',
    description: 'Draft professional emails with appropriate tone and structure',
    url: 'https://github.com/freebeerstudio/hughmann-skills/tree/main/email-drafter',
    rawUrl: 'https://raw.githubusercontent.com/freebeerstudio/hughmann-skills/main/email-drafter/SKILL.md',
    author: 'Free Beer Studio',
    keywords: ['email', 'draft', 'communication', 'write'],
  },
  {
    id: 'research-digest',
    name: 'Research Digest',
    description: 'Research a topic and produce a concise digest with sources',
    url: 'https://github.com/freebeerstudio/hughmann-skills/tree/main/research-digest',
    rawUrl: 'https://raw.githubusercontent.com/freebeerstudio/hughmann-skills/main/research-digest/SKILL.md',
    author: 'Free Beer Studio',
    keywords: ['research', 'digest', 'summary', 'learn'],
  },
  {
    id: 'daily-journal',
    name: 'Daily Journal',
    description: 'Guided journaling with reflection prompts and mood tracking',
    url: 'https://github.com/freebeerstudio/hughmann-skills/tree/main/daily-journal',
    rawUrl: 'https://raw.githubusercontent.com/freebeerstudio/hughmann-skills/main/daily-journal/SKILL.md',
    author: 'Free Beer Studio',
    keywords: ['journal', 'reflection', 'mood', 'daily'],
  },
]

/**
 * Search the registry for skills matching a query.
 */
export function searchSkills(query: string): RegistrySkill[] {
  const lower = query.toLowerCase()
  return SKILL_REGISTRY.filter(skill => {
    if (skill.id.includes(lower)) return true
    if (skill.name.toLowerCase().includes(lower)) return true
    if (skill.description.toLowerCase().includes(lower)) return true
    return skill.keywords.some(k => k.includes(lower))
  })
}

/**
 * Install a skill from the registry or a raw URL.
 * Downloads SKILL.md to ~/.hughmann/skills/<id>/SKILL.md
 */
export async function installSkill(
  skillsDir: string,
  skillIdOrUrl: string,
): Promise<{ success: boolean; id: string; error?: string }> {
  let id: string
  let rawUrl: string

  // Check if it's a registry skill
  const registrySkill = SKILL_REGISTRY.find(s => s.id === skillIdOrUrl)
  if (registrySkill) {
    id = registrySkill.id
    rawUrl = registrySkill.rawUrl
  } else if (skillIdOrUrl.startsWith('http')) {
    // Direct URL — extract ID from URL path
    const parts = skillIdOrUrl.replace(/\/$/, '').split('/')
    id = parts[parts.length - 1].replace(/\.md$/i, '')
    rawUrl = skillIdOrUrl
  } else {
    return { success: false, id: skillIdOrUrl, error: `Skill "${skillIdOrUrl}" not found in registry. Use a URL for custom skills.` }
  }

  const skillDir = join(skillsDir, id)
  if (existsSync(join(skillDir, 'SKILL.md'))) {
    return { success: false, id, error: `Skill "${id}" is already installed.` }
  }

  try {
    const response = await fetch(rawUrl)
    if (!response.ok) {
      return { success: false, id, error: `Failed to fetch skill: ${response.status} ${response.statusText}` }
    }

    const content = await response.text()
    if (!content.includes('---') || content.length < 20) {
      return { success: false, id, error: 'Downloaded content does not look like a valid SKILL.md' }
    }

    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8')

    return { success: true, id }
  } catch (err) {
    return { success: false, id, error: err instanceof Error ? err.message : String(err) }
  }
}
