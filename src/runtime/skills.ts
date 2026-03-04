import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskComplexity } from '../types/model.js'

export interface Skill {
  id: string
  name: string
  description: string
  prompt: string
  complexity: TaskComplexity
  /** If set, auto-switch to this domain before running */
  domain?: string
  maxTurns?: number
  /** Whether this is a built-in skill */
  builtin: boolean
}

// ─── Built-in Skills ────────────────────────────────────────────────────────

const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'morning',
    name: 'Morning Dashboard',
    description: 'Review priorities and set daily focus',
    complexity: 'autonomous',
    maxTurns: 15,
    builtin: true,
    prompt: `Run my morning dashboard routine. Here's what I need:

1. **Quick Status** — For each of my active domains, what's the current top priority? Pull this from my context docs and recent memory.

2. **This Week's Big Rocks** — Check my master plan. What are the 3 major priorities for this week? If they're marked TBD, suggest what they should be based on my quarterly goals.

3. **Today's Focus** — Based on priorities and any deadlines:
   - **1 MUST** — The single most critical task today
   - **3 MITs** — Most Important Tasks after the MUST

4. **Heads Up** — Anything I should be aware of: upcoming deadlines, stalled projects, things I committed to in recent conversations.

Keep it punchy. Bullet points. No fluff. Format it like a dashboard I can glance at in 2 minutes.

If you have access to my calendar via MCP, check today's meetings too.`,
  },
  {
    id: 'closeout',
    name: 'Afternoon Closeout',
    description: 'Review progress and plan tomorrow',
    complexity: 'conversational',
    builtin: true,
    prompt: `Run my afternoon closeout. Walk me through:

1. **Progress Check** — Based on our conversations today, what did I accomplish? What moved forward?

2. **Incomplete Items** — Anything I said I'd do today that didn't get done? Be honest.

3. **Tomorrow's Setup** — What should be top of mind tomorrow morning? Any prep I should do tonight?

4. **Wins** — Call out 1-2 things that went well today, even small ones.

Keep it conversational but concise. This should take 2 minutes to read.`,
  },
  {
    id: 'review',
    name: 'Weekly Review',
    description: 'Reflect on the week and plan ahead',
    complexity: 'autonomous',
    maxTurns: 20,
    builtin: true,
    prompt: `Run my weekly review. This is a Friday reflection and planning session.

**Part 1: This Week**
- For each domain: What happened this week? What progressed? What stalled?
- Review my master plan — did I hit my Big Rocks?
- Any decisions made this week worth noting?
- Check recent memories for patterns or recurring themes.

**Part 2: Next Week**
- Suggest 3 Big Rocks for next week based on quarterly goals and what's in flight.
- Any deadlines coming up in the next 2 weeks?
- What's the single most important thing to focus on?

**Part 3: Growth**
- Am I making progress on my quarterly goals? Honest assessment.
- Any course corrections needed?
- Capability gaps surfaced this week?

If you can update my master-plan.md with the new weekly focus, do it. Use /log for any key decisions.

Be thorough but structured. Use headers and bullets.`,
  },
  {
    id: 'status',
    name: 'Quick Status',
    description: 'Snapshot of all domains and priorities',
    complexity: 'conversational',
    builtin: true,
    prompt: `Give me a quick status across all my domains. For each one:
- **Status**: On track / Needs attention / Stalled
- **Top priority**: One line
- **Next action**: One line

Then: What's the single most important thing I should be working on right now?

Keep the whole thing under 20 lines.`,
  },
  {
    id: 'plan',
    name: 'Master Plan Review',
    description: 'Review and update the master plan',
    complexity: 'autonomous',
    maxTurns: 15,
    builtin: true,
    prompt: `Review my master plan document. For each section:

1. **Quarterly Goals** — Are they still the right goals? Any that should be adjusted?
2. **Big Rocks** — Are the current weekly Big Rocks aligned with quarterly goals?
3. **Decision Log** — Summarize recent decisions and their impact.
4. **Gaps** — What's missing? What should I be tracking that I'm not?

If anything needs updating in master-plan.md, go ahead and make the edits.
Explain what you changed and why.`,
  },
  {
    id: 'habits',
    name: 'Habit Check',
    description: 'Review daily habit completion',
    complexity: 'conversational',
    builtin: true,
    prompt: `Check in on my 7 core habits for today:
1. Walk
2. Workout
3. Meditation
4. Inbox Zero
5. Reading
6. Calorie Deficit
7. System Updates

Ask me about each one. For any I haven't done yet, give me a quick nudge or suggestion.
After I report, give me a score (X/7) and one sentence of encouragement or accountability.`,
  },
]

// ─── Skill Manager ──────────────────────────────────────────────────────────

export class SkillManager {
  private skills: Map<string, Skill> = new Map()
  private skillsDir: string

  constructor(hughmannHome: string) {
    this.skillsDir = join(hughmannHome, 'skills')

    // Load built-ins
    for (const skill of BUILTIN_SKILLS) {
      this.skills.set(skill.id, skill)
    }

    // Load user-defined skills
    this.loadUserSkills()
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id)
  }

  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  listBuiltin(): Skill[] {
    return Array.from(this.skills.values()).filter(s => s.builtin)
  }

  listCustom(): Skill[] {
    return Array.from(this.skills.values()).filter(s => !s.builtin)
  }

  has(id: string): boolean {
    return this.skills.has(id)
  }

  /** Reload user skills from disk */
  reload(): { count: number; warnings: string[] } {
    const warnings: string[] = []

    // Clear custom skills
    for (const [id, skill] of this.skills) {
      if (!skill.builtin) this.skills.delete(id)
    }

    // Reload
    const loaded = this.loadUserSkills()
    return { count: loaded.count, warnings: [...loaded.warnings, ...warnings] }
  }

  /** Create the skills directory and a sample skill file */
  initSkillsDir(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true })
    }

    const samplePath = join(this.skillsDir, '_example.md')
    if (!existsSync(samplePath)) {
      writeFileSync(samplePath, SAMPLE_SKILL, 'utf-8')
    }
  }

  private loadUserSkills(): { count: number; warnings: string[] } {
    const warnings: string[] = []

    if (!existsSync(this.skillsDir)) {
      return { count: 0, warnings }
    }

    const files = readdirSync(this.skillsDir).filter(f =>
      f.endsWith('.md') && !f.startsWith('_')
    )

    let count = 0
    for (const file of files) {
      try {
        const content = readFileSync(join(this.skillsDir, file), 'utf-8')
        const skill = parseSkillFile(file, content)
        if (skill) {
          // Don't let user skills override built-ins
          if (this.skills.has(skill.id) && this.skills.get(skill.id)!.builtin) {
            warnings.push(`Skill "${skill.id}" conflicts with built-in skill, skipping`)
            continue
          }
          this.skills.set(skill.id, skill)
          count++
        }
      } catch (err) {
        warnings.push(`Failed to parse skill ${file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { count, warnings }
  }
}

// ─── Skill File Parser ──────────────────────────────────────────────────────

/**
 * Parse a skill markdown file.
 * Format:
 * ---
 * name: My Skill
 * description: What it does
 * complexity: conversational | autonomous | lightweight
 * domain: optional-domain-slug
 * maxTurns: 15
 * ---
 * The prompt goes here. Everything after the frontmatter.
 */
function parseSkillFile(filename: string, content: string): Skill | null {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!frontmatterMatch) return null

  const [, frontmatter, body] = frontmatterMatch
  const prompt = body.trim()
  if (!prompt) return null

  const meta: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    meta[key] = value
  }

  const id = filename.replace(/\.md$/, '')
  const name = meta.name || id
  const description = meta.description || ''
  const complexity = (['lightweight', 'conversational', 'autonomous'].includes(meta.complexity)
    ? meta.complexity
    : 'conversational') as TaskComplexity
  const domain = meta.domain || undefined
  const maxTurns = meta.maxTurns ? parseInt(meta.maxTurns, 10) : undefined

  return { id, name, description, prompt, complexity, domain, maxTurns, builtin: false }
}

// ─── Sample Skill ───────────────────────────────────────────────────────────

const SAMPLE_SKILL = `---
name: Example Skill
description: A template for creating custom skills
complexity: conversational
---
This is an example skill. Create your own by adding .md files to this directory.

Each skill needs:
- A frontmatter block (between --- markers) with name, description, and complexity
- A prompt (everything after the frontmatter)

Complexity levels:
- lightweight: Quick answers using Haiku (fastest, cheapest)
- conversational: Discussion using Sonnet (default, good for most things)
- autonomous: Tasks with tools using Opus (can read/write files, run commands, search web)

Optional frontmatter fields:
- domain: auto-switch to this domain before running (e.g., "omnissa")
- maxTurns: max agent turns for autonomous skills (default: 25)

Skills are run with: /<filename> (without .md extension)
Files starting with _ are ignored (like this example).
`
