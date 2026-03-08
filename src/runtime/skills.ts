import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Skill {
  id: string
  name: string
  description: string
  prompt: string
  /** If set, auto-switch to this domain before running */
  domain?: string
  /** Whether this is a built-in skill */
  builtin: boolean
  /** Directory path for SKILL.md-based skills (for bundled resources) */
  path?: string
}

// ─── Built-in Skills ────────────────────────────────────────────────────────

const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'morning',
    name: 'Morning Dashboard',
    description: 'Review priorities and set daily focus',
    builtin: true,
    prompt: `Run my morning dashboard routine. Here's what I need:

**First**: Use tools to gather context:
- Call \`list_domain_goals\` to see the top of the pyramid
- Call \`list_tasks\` with status "todo,in_progress" to see what's active
- Call \`list_tasks\` with status "blocked" to see blockers
- Call \`list_projects\` to see active projects and their North Stars
- If no tasks exist yet, suggest creating MUST/MIT tasks aligned with project North Stars

1. **Task Queue** — Show today's active tasks grouped by type (MUST, MIT, BIG_ROCK, STANDARD). Highlight anything in_progress or blocked.

2. **Quick Status** — For each active project, how close are we to the North Star? Any guardrail violations?

3. **This Week's Big Rocks** — What are the 3 major priorities for this week based on active project North Stars and domain goals?

4. **Today's Focus** — Based on priorities, tasks, and any deadlines:
   - **1 MUST** — The single most critical task today
   - **3 MITs** — Most Important Tasks after the MUST

5. **Heads Up** — Anything I should be aware of: upcoming deadlines, stalled projects, blocked tasks, things I committed to in recent conversations.

Keep it punchy. Bullet points. No fluff. Format it like a dashboard I can glance at in 2 minutes.

If you have access to my calendar via MCP, check today's meetings too.`,
  },
  {
    id: 'closeout',
    name: 'Afternoon Closeout',
    description: 'Review progress and plan tomorrow',
    builtin: true,
    prompt: `Run my afternoon closeout. First, use the task tools to review today's work:

- Call \`list_tasks\` with status "done" to see completed tasks
- Call \`list_tasks\` with status "in_progress" to see what's still running
- Call \`list_tasks\` with status "blocked" to see blockers

Then walk me through:

1. **Progress Check** — Based on completed tasks and conversations today, what did I accomplish? What moved forward?

2. **Incomplete Items** — Show in_progress and blocked tasks. Anything I said I'd do today that didn't get done? Be honest.

3. **Tomorrow's Setup** — What should be top of mind tomorrow morning? Any prep I should do tonight?

4. **Wins** — Call out 1-2 things that went well today, even small ones.

Keep it conversational but concise. This should take 2 minutes to read.`,
  },
  {
    id: 'review',
    name: 'Weekly Review',
    description: 'Reflect on the week and plan ahead',
    builtin: true,
    prompt: `Run my weekly review. This is a Friday reflection and planning session.

**First**: Gather context:
- Call \`list_domain_goals\` to see the guiding lights
- Call \`list_projects\` to see all projects with their North Stars
- Call \`list_tasks\` with various statuses to see what happened this week

**Part 1: This Week**
- For each active project: What progressed toward the North Star? What stalled? Any guardrail violations?
- Any decisions made this week worth noting?
- Check recent memories for patterns or recurring themes.

**Part 2: Next Week**
- Suggest 3 Big Rocks for next week based on active project North Stars and what's in flight.
- Any deadlines coming up in the next 2 weeks?
- What's the single most important thing to focus on?

**Part 3: Growth**
- For each domain goal, are projects making real progress? Honest assessment.
- Any course corrections needed?
- Capability gaps surfaced this week?

Use /log for any key decisions.

Be thorough but structured. Use headers and bullets.`,
  },
  {
    id: 'status',
    name: 'Quick Status',
    description: 'Snapshot of all domains and priorities',
    builtin: true,
    prompt: `Give me a quick status across all my domains. For each one:
- **Status**: On track / Needs attention / Stalled
- **Top priority**: One line
- **Next action**: One line

Then: What's the single most important thing I should be working on right now?

Keep the whole thing under 20 lines.`,
  },
  {
    id: 'plan-review',
    name: 'Planning Review',
    description: 'Review domain goals, project North Stars, and guardrails',
    builtin: true,
    prompt: `Review my planning pyramid. Use tools to gather context first:

- Call \`list_domain_goals\` to see the top of the pyramid
- Call \`list_projects\` to see all projects with North Stars and guardrails

Then review each level:

1. **Domain Goals** — Are they still the right guiding lights? These should be permanent aspirations, not quarterly targets.
2. **Project North Stars** — For each active project, is the North Star still vivid and motivating? Does it still describe what success looks and feels like?
3. **Guardrails** — Are the 2-3 constraints per project still helping make prioritization calls? Any that need adjusting?
4. **Gaps** — Any domains without projects? Any projects without a North Star? Any work happening that doesn't trace back to a domain goal?

Propose changes and explain your reasoning.`,
  },
  {
    id: 'plan',
    name: 'Task Planning',
    description: 'Create structured tasks from master plan and goals',
    builtin: true,
    prompt: `Plan my work by creating structured tasks. Here's the process:

1. **Read Context** — Call \`list_domain_goals\` and \`list_projects\` to understand the pyramid. Every task must trace back to a project North Star and ultimately a domain goal.

2. **Check Existing Tasks** — Use \`list_tasks\` to see what's already in the backlog and queue. Don't create duplicates.

3. **Identify Gaps** — Compare project North Stars and guardrails against existing tasks. What work is missing to move projects toward their North Star?

4. **Create Tasks** — Use \`create_task\` to create up to 10 new tasks that fill the gaps. For each task:
   - Set appropriate \`task_type\`: MUST for critical blockers, MIT for daily priorities, BIG_ROCK for weekly goals, STANDARD for everything else
   - Set \`priority\`: 0-1 for urgent, 2 for this week, 3 for normal, 4-5 for someday
   - Set \`domain\` to the relevant domain slug
   - Set \`project\` to the parent project
   - Set \`assignee\` if known (wayne, hugh, or an agent slug)
   - Write a clear \`description\` with enough detail to execute without context

5. **Summary** — List all tasks created with their types, priorities, and which North Star they serve.

Focus on actionable, executable tasks — not vague goals. Each task should be completable in one work session.`,
  },
  {
    id: 'focus',
    name: 'Strategic Planning Session',
    description: '15-minute collaborative planning — break down goals into projects and tasks',
    builtin: true,
    prompt: `You are leading a 15-minute strategic planning session with {{OWNER}}. You drive the conversation — propose, don't wait. Your job is to help {{OWNER}} connect work to the pyramid: domain goals → projects (North Star + guardrails) → tasks.

## Playbook

### 1. Gather Context (call tools first)
- Call \`list_domain_goals\` to see the top of the pyramid
- Call \`get_planning_context\` to load the full briefing (active projects, open tasks, stale projects, last session's open questions)
- Call \`get_current_time\` to know the current date

### 2. Check-in (1 min)
- Surface open questions from the last planning session
- Flag any stale projects (no updates in 14+ days)
- Note domains with no projects — suggest this is a gap worth addressing
- Check: does every active project have a North Star and guardrails? Flag any that don't.
- Briefly summarize what was decided last time

### 3. Strategic Focus (5-7 min)
Ask {{OWNER}} what needs attention. Then:
- **For new initiatives**: Define as a project with a North Star (vivid vision of success) and 2-3 guardrails (constraints for prioritization). Get {{OWNER}}'s approval, then call \`create_project\`.
- **For existing projects**: How close are we to the North Star? Any guardrail violations? What's blocking progress? Break the next step into tasks.
- **For course corrections**: Help {{OWNER}} decide, articulate the decision clearly, and log it.

### 4. Task Breakdown (5 min)
- Propose 3-5 specific, actionable tasks based on the discussion
- Each task should be completable in one work session
- Every task must trace back to a project and its North Star
- Assign appropriate type (MUST/MIT/BIG_ROCK/STANDARD), priority, domain, and assignee
- Get {{OWNER}}'s approval, then call \`create_task\` for each one

### 5. Capture & Close (2 min)
- Summarize what was decided
- Call \`capture_planning_summary\` with everything covered:
  - focus_area, topics_covered, decisions_made
  - tasks_created (IDs from created tasks)
  - projects_touched (IDs from created/updated projects)
  - open_questions (anything left unresolved)
  - next_steps (what to follow up on)

## Key Behaviors
- YOU lead — propose specific projects and tasks, don't just ask "what do you want to do?"
- Think in the pyramid: domain goal → project North Star → guardrails → tasks
- Domain goals are permanent guiding lights, NOT quarterly targets or SMART goals
- North Stars are vivid qualitative visions, NOT metrics
- Guardrails help YOU make autonomous prioritization calls
- Reference previous sessions for continuity
- Always capture decisions — nothing discussed should be lost
- Keep it to 3-4 topics max per session — depth over breadth
- If {{OWNER}} mentions something aspirational, help define it as a project with a North Star
- Be direct, concise, and action-oriented — {{OWNER}} values efficiency`,
  },
  {
    id: 'habits',
    name: 'Habit Check',
    description: 'Review daily habit completion',
    builtin: true,
    prompt: `Check in on my daily habits for today:

{{HABITS}}

Ask me about each one. For any I haven't done yet, give me a quick nudge or suggestion.
After I report, give me a score and one sentence of encouragement or accountability.`,
  },
]

// ─── Skill Manager ──────────────────────────────────────────────────────────

const DEFAULT_HABITS = `1. Exercise
2. Reading
3. Hydration
4. Inbox Zero
5. Learning
6. Sleep Routine
7. Reflection`

export class SkillManager {
  private skills: Map<string, Skill> = new Map()
  private skillsDir: string
  private ownerName: string = 'Owner'
  private habits: string = DEFAULT_HABITS

  constructor(hughmannHome: string) {
    this.skillsDir = join(hughmannHome, 'skills')

    // Load built-ins
    for (const skill of BUILTIN_SKILLS) {
      this.skills.set(skill.id, skill)
    }

    // Load user-defined skills
    this.loadUserSkills()

    // Try to load habits from context
    const habitsPath = join(hughmannHome, 'context', 'habits.md')
    if (existsSync(habitsPath)) {
      const content = readFileSync(habitsPath, 'utf-8').trim()
      if (content) this.habits = content
    }
  }

  /** Set runtime interpolation values (called after context is loaded) */
  setInterpolationContext(ownerName: string): void {
    this.ownerName = ownerName
  }

  get(id: string): Skill | undefined {
    const skill = this.skills.get(id)
    if (!skill) return undefined
    // Lazily interpolate placeholders in built-in skill prompts
    if (skill.builtin && (skill.prompt.includes('{{OWNER}}') || skill.prompt.includes('{{HABITS}}'))) {
      return {
        ...skill,
        prompt: skill.prompt
          .replace(/\{\{OWNER\}\}/g, this.ownerName)
          .replace(/\{\{HABITS\}\}/g, this.habits),
      }
    }
    return skill
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
    for (const [_id, skill] of this.skills) {
      if (!skill.builtin) this.skills.delete(_id)
    }

    // Reload
    const loaded = this.loadUserSkills()
    return { count: loaded.count, warnings: [...loaded.warnings, ...warnings] }
  }

  /** Create the skills directory, sample skill, and auto-install bundled skills */
  initSkillsDir(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true })
    }

    // Create example SKILL.md directory
    const exampleDir = join(this.skillsDir, '_example')
    if (!existsSync(exampleDir)) {
      mkdirSync(exampleDir, { recursive: true })
      writeFileSync(join(exampleDir, 'SKILL.md'), SAMPLE_SKILL, 'utf-8')
    }

    // Auto-install bundled skill-creator if not already present
    this.installBundledSkill('skill-creator')
    this.installBundledSkill('discover-email-categories')
    this.installBundledSkill('bulk-classify-email')
    this.installBundledSkill('process-email')
    this.installBundledSkill('prep-meetings')
    this.installBundledSkill('agent-hugh')
    this.installBundledSkill('agent-celine')
    this.installBundledSkill('agent-mark')
    this.installBundledSkill('agent-support')
  }

  /** Copy a bundled skill from src/skills/ to user's skills dir if not present */
  private installBundledSkill(skillId: string): void {
    const destDir = join(this.skillsDir, skillId)
    if (existsSync(destDir)) return

    try {
      const thisFile = fileURLToPath(import.meta.url)
      const srcRoot = dirname(dirname(thisFile))
      const bundledDir = join(srcRoot, 'skills', skillId)

      if (!existsSync(bundledDir)) return

      cpSync(bundledDir, destDir, { recursive: true })
    } catch {
      // Best-effort — don't block boot
    }
  }

  private loadUserSkills(): { count: number; warnings: string[] } {
    const warnings: string[] = []

    if (!existsSync(this.skillsDir)) {
      return { count: 0, warnings }
    }

    let count = 0
    const entries = readdirSync(this.skillsDir)

    for (const entry of entries) {
      if (entry.startsWith('_')) continue

      const fullPath = join(this.skillsDir, entry)
      const stat = statSync(fullPath)

      try {
        let skill: Skill | null = null

        if (stat.isDirectory()) {
          // SKILL.md directory format (standard)
          skill = parseSkillDir(fullPath, entry)
        } else if (entry.endsWith('.md')) {
          // Legacy flat .md file — parse with deprecation warning
          const content = readFileSync(fullPath, 'utf-8')
          skill = parseLegacySkillFile(entry, content)
          if (skill) {
            warnings.push(`Skill "${skill.id}" uses legacy flat .md format. Migrate to SKILL.md directory format.`)
          }
        }

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
        warnings.push(`Failed to parse skill ${entry}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { count, warnings }
  }
}

// ─── SKILL.md Directory Parser ──────────────────────────────────────────────

/**
 * Parse a standard SKILL.md directory.
 * Directory must contain a SKILL.md file with name/description frontmatter.
 * Optional Hugh extension: `domain` in frontmatter.
 */
function parseSkillDir(dirPath: string, dirName: string): Skill | null {
  const skillMdPath = join(dirPath, 'SKILL.md')
  if (!existsSync(skillMdPath)) return null

  const content = readFileSync(skillMdPath, 'utf-8')
  const { meta, body } = parseFrontmatter(content)

  const prompt = body.trim()
  if (!prompt) return null

  return {
    id: dirName,
    name: meta.name || dirName,
    description: meta.description || '',
    prompt,
    domain: meta.domain || undefined,
    builtin: false,
    path: dirPath,
  }
}

// ─── Legacy Flat .md Parser (deprecated) ────────────────────────────────────

/**
 * Parse a legacy flat .md skill file.
 * Supports old frontmatter fields (complexity, maxTurns) but ignores them.
 */
function parseLegacySkillFile(filename: string, content: string): Skill | null {
  const { meta, body } = parseFrontmatter(content)

  const prompt = body.trim()
  if (!prompt) return null

  const id = filename.replace(/\.md$/, '')

  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    prompt,
    domain: meta.domain || undefined,
    builtin: false,
  }
}

// ─── Shared Frontmatter Parser ──────────────────────────────────────────────

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }

  const [, frontmatter, body] = match
  const meta: Record<string, string> = {}

  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    meta[key] = value
  }

  return { meta, body }
}

// ─── Sample SKILL.md ────────────────────────────────────────────────────────

const SAMPLE_SKILL = `---
name: Example Skill
description: A template for creating custom skills
---
This is an example skill. Create your own by adding a directory with a SKILL.md file.

## Directory Structure

\`\`\`
my-skill/
  SKILL.md        # Required: frontmatter + prompt
  references/     # Optional: reference documents
  scripts/        # Optional: helper scripts
  assets/         # Optional: images, data files
\`\`\`

## SKILL.md Format

\`\`\`markdown
---
name: My Skill
description: What it does and when to trigger it
domain: optional-domain-slug
---
Your prompt instructions here...
\`\`\`

## Frontmatter Fields

- \`name\` (required): Display name
- \`description\` (required): Shown in skill listings
- \`domain\` (optional): Auto-switch to this domain before running

## Notes

- Directory name becomes the skill ID: \`my-skill/\` → \`/my-skill\`
- Directories starting with \`_\` are ignored (like this example)
- Custom skills cannot override built-in skill IDs
- Legacy flat \`.md\` files still work but are deprecated
- Skills are loaded at startup; use \`/reload\` to pick up changes
`
