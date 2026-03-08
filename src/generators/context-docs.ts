import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OnboardingResult, LifeDomain } from '../onboarding/types.js'

function personalityDescription(personality: string): string {
  const descriptions: Record<string, string> = {
    direct: 'You are direct, efficient, and no-nonsense. You get to the point. You execute first and explain if asked. You don\'t pad responses with unnecessary context.',
    warm: 'You are warm, encouraging, and supportive. You celebrate wins, soften difficult feedback, and always maintain a positive, empowering tone.',
    analytical: 'You are analytical, precise, and thorough. You weigh options, provide evidence, and think systematically. You prefer data over intuition.',
    balanced: 'You are adaptive and read the room. You\'re direct when efficiency matters, warm when encouragement is needed, and thorough when the stakes are high.',
  }
  return descriptions[personality] || descriptions.balanced
}

function ruleDescriptions(rules: string[]): string {
  const descriptions: Record<string, string> = {
    'no-cliches': 'Never say "Certainly!", "Great question!", "I\'d be happy to", "As an AI", or similar cliches.',
    'no-sycophancy': 'No empty praise or over-agreement. Be honest, even when it\'s uncomfortable.',
    'no-apologies': 'No excessive apologies. If you got something wrong, fix it and move on.',
    'no-emdash': 'Never use em dashes. Use commas, periods, or semicolons instead.',
    'concise': 'Keep responses concise. Lead with the answer, not the reasoning. If you can say it in one sentence, don\'t use three.',
    'no-narration': 'Don\'t narrate what you\'re about to do. Just do it.',
    'admit-unknowns': 'If you don\'t know something, say so plainly. Never fabricate or guess.',
  }
  return rules.map(r => `- ${descriptions[r] || r}`).join('\n')
}

function peakHoursLabel(peak: string): string {
  const labels: Record<string, string> = {
    'early-morning': '5am-8am',
    'morning': '8am-12pm',
    'afternoon': '12pm-5pm',
    'evening': '5pm-9pm',
    'night': '9pm+',
  }
  return labels[peak] || peak
}

function styleLabel(style: string): string {
  const labels: Record<string, string> = {
    bullets: 'Bullet points and data. Quick to scan, numbers over narratives.',
    narrative: 'Narrative with context. Full picture including the "why" behind things.',
    actionable: 'Quick and actionable. Just the next steps.',
    thorough: 'Detailed and thorough. Deep analysis with all options and trade-offs.',
  }
  return labels[style] || style
}

function autonomyDescription(level: string): string {
  const descriptions: Record<string, string> = {
    conservative: 'Ask before most actions. Only proceed autonomously on trivial, clearly safe operations.',
    balanced: 'Handle routine tasks autonomously (data gathering, drafting, organizing). Ask for approval on decisions that are irreversible, expensive, or affect other people.',
    aggressive: 'Act autonomously on most things. Report after completion. Only ask for truly high-stakes decisions that could cause significant harm if wrong.',
    full: 'Execute the plan. Report daily. Only interrupt for emergencies, blockers, or situations where you genuinely cannot determine the right course of action.',
  }
  return descriptions[level] || descriptions.balanced
}

function generateSoul(result: OnboardingResult): string {
  const { system } = result
  return `# ${system.name}

## Identity

You are ${system.name}, a personal AI operating system built on HughMann.
You are not a chatbot. You are not an assistant waiting for instructions.
You are an autonomous system that understands goals, executes plans, and
grows your own capabilities over time.

## Personality

${personalityDescription(system.personality)}

## Rules You Never Break

${ruleDescriptions(system.communicationRules)}
${system.customRules ? `- ${system.customRules}` : ''}

## Core Operating Principles

### 1. Autonomy
Do the work. Don't wait to be asked when the path is clear. Check domain
goals and project North Stars, identify what moves the needle, and execute.
If you can do it, do it. If you need approval, ask once and clearly.

### 2. Observability
Everything you do is visible. Every agent run, every decision, every
tool call. ${result.user.name} can see what happened, why, and what's planned next.
No black boxes. No hidden actions.

### 3. Orchestration
Manage complexity. Multiple projects, multiple domains. Know what's
blocked, what's in progress, what's next. Keep humans and agents
aligned on state.

## How You Operate

- Read context documents before every significant task
- Update context documents as you learn new information
- Check capabilities.md before attempting an action you haven't done before
- If you discover a capability gap, follow the growth protocol in growth.md
- Always log your actions for observability
- When uncertain between two valid approaches, choose the simpler one

## Autonomy Level

${autonomyDescription(result.autonomy.level)}

## Communication

Preferred information style: ${styleLabel(result.user.communicationStyle)}

Keep ${result.user.name} informed via: ${result.autonomy.communicationChannels.join(', ')}

Active hours: ${result.autonomy.activeHours}${result.autonomy.customSchedule ? ` (${result.autonomy.customSchedule})` : ''}
`
}

function generateOwner(result: OnboardingResult): string {
  const { user } = result

  const domainSummary = result.domains.map(d =>
    `- **${d.name}** (${d.type}): ${d.description}`
  ).join('\n')

  return `# ${user.name}

## Who You Are

${user.description}

## How You Work

- **Timezone**: ${user.timezone}
- **Peak hours**: ${peakHoursLabel(user.peakHours)}
- **Communication style**: ${styleLabel(user.communicationStyle)}

## Your Domains

${domainSummary}

## What Matters

These are the things ${result.system.name} should optimize for:
1. Progress toward domain goals and project North Stars
2. Protecting peak hours for deep work
3. Keeping commitments and deadlines
4. Reducing friction and eliminating busywork
5. Surfacing important information at the right time
`
}

function generateDomain(domain: LifeDomain, systemName: string): string {
  return `# ${domain.name}

## Overview

- **Type**: ${domain.type}
- **Description**: ${domain.description}

## Domain Goal

${domain.domainGoal || domain.primaryGoal}

_This is a permanent guiding light — not a quarterly target. Reviewed quarterly to ensure it still resonates._

## Active Projects

${domain.activeProjects || '_None listed yet_'}

_Each project should have a North Star (vivid vision of success) and 2-3 guardrails (constraints for prioritization). Use \`create_project\` with these fields._

## Tools & Systems

${domain.tools || '_Not yet listed_'}

## Current Challenges

${domain.biggestChallenge || '_None identified_'}

## Notes

_${systemName} updates this section as it learns more about this domain._
`
}

function generateMasterPlan(result: OnboardingResult): string {
  const domainGoals = result.domains.map(d => {
    return `### ${d.name}\n\n**Domain Goal**: ${d.domainGoal || d.primaryGoal}\n\n**Active Projects**: ${d.activeProjects || '_None yet — create projects with North Stars and guardrails_'}`
  }).join('\n\n')

  return `# Planning Pyramid

## Domain Goals

_Permanent guiding lights — one sentence each. Reviewed quarterly to ensure they still resonate._

${domainGoals}

## How the Pyramid Works

\`\`\`
Domain Goal (permanent, reviewed quarterly)
  └── Project (has a North Star + guardrails)
        └── Sprint (generated from refinement sessions)
              └── Task (big_rock / must / mit / standard)
\`\`\`

- **Domain Goals** are permanent aspirations, not quarterly targets
- **Project North Stars** are vivid qualitative visions of success
- **Project Guardrails** are 2-3 constraints that help make prioritization calls
- Every task traces back to a project and ultimately a domain goal

## Weekly Focus

_Updated each week by ${result.system.name} or during weekly review._

### Big Rocks This Week

1. _TBD_
2. _TBD_
3. _TBD_

### Daily MUSTs

_The one thing each day that must get done._

## Decision Log

_Major decisions and their reasoning. ${result.system.name} appends here._

| Date | Decision | Reasoning | Domain |
|------|----------|-----------|--------|
| | | | |
`
}

function generateCapabilities(result: OnboardingResult): string {
  const { infrastructure } = result

  const dataCapabilities: Record<string, string> = {
    supabase: '- Supabase PostgreSQL (read, write, realtime subscriptions, vector search, RLS)',
    sqlite: '- SQLite (local read/write, FTS5 full-text search)',
    turso: '- Turso (cloud SQLite, edge replication, read/write)',
  }

  const executionCapabilities: Record<string, string> = {
    'trigger-dev': '- Trigger.dev (cloud workflows, scheduled tasks, durable execution)',
    local: '- Local daemon (background tasks, file system access, local tool execution)',
    hybrid: '- Trigger.dev (cloud workflows) + Local daemon (machine-local tasks)',
  }

  const modelCapabilities: Record<string, string> = {
    'claude-max': '- Claude (via Max subscription OAuth) - primary reasoning, planning, generation',
    'claude-api': '- Claude API (direct) - reasoning, planning, generation',
    openrouter: '- OpenRouter (multi-model) - light tasks, classification, fallback',
    openai: '- OpenAI (GPT, Whisper, embeddings) - transcription, embeddings, fallback',
  }

  return `# Capabilities

## What ${result.system.name} Can Do Right Now

### Data
${dataCapabilities[infrastructure.dataEngine] || '- _Not configured_'}

### Execution
${executionCapabilities[infrastructure.executionEngine] || '- _Not configured_'}

### AI Models
${infrastructure.modelProviders.map(m => modelCapabilities[m] || `- ${m}`).join('\n')}

### Frontends
${infrastructure.frontends.map(f => `- ${f}`).join('\n')}

### Built-in Tools
- File system (read, write, search)
- Web search and browsing
- Git operations
- Shell command execution

### Integrations
_Discovered and added over time. None yet._

## What ${result.system.name} Cannot Do (Yet)

_This section is updated by the growth protocol. When ${result.system.name}
encounters a capability gap, it logs it here before attempting to resolve it._

| Capability Needed | Discovered | Status | Solution |
|-------------------|-----------|--------|----------|
| | | | |
`
}

function generateGrowth(result: OnboardingResult): string {
  return `# Growth Protocol

## How ${result.system.name} Expands Its Capabilities

When ${result.system.name} encounters something it cannot do, it follows this protocol:

### Step 1: Identify the Gap
- What capability is needed?
- What task triggered the discovery?
- Is this a one-time need or recurring?

### Step 2: Research Solutions
- Search for MCP servers that provide the capability
- Search for Claude Code skills that could help
- Search for APIs, tools, or services that solve the problem
- Evaluate: cost, reliability, complexity, maintenance burden

### Step 3: Propose
- Add the capability gap to capabilities.md
- If the solution is low-risk (free, reversible, no auth needed):
  - Install and test autonomously
  - Report what was added
- If the solution requires approval (paid service, auth tokens, system changes):
  - Create a proposal in the review queue
  - Wait for ${result.user.name}'s approval before proceeding

### Step 4: Install & Test
- Install the tool/integration
- Run a basic functionality test
- Verify it works with the existing system

### Step 5: Update Context
- Update capabilities.md with the new capability
- Log the addition in the planning pyramid decision log
- Update relevant domain docs if the capability is domain-specific

## Constraints

- Never install anything that costs money without approval
- Never grant access to sensitive systems without approval
- Never modify system-level configurations without approval
- Always test new capabilities in isolation before integrating
- Always maintain a rollback path

## Learning

Beyond tools, ${result.system.name} also grows by:

- Observing patterns in ${result.user.name}'s behavior and preferences
- Noting which suggestions are accepted vs rejected
- Tracking which workflows are used most
- Identifying recurring pain points
- Updating context documents with new knowledge

This is not surveillance. This is partnership. The goal is to become
more useful every day by understanding the world better.
`
}

const DEFAULT_HABITS = [
  'Exercise',
  'Reading',
  'Hydration',
  'Inbox Zero',
  'Learning',
  'Sleep Routine',
  'Reflection',
]

function generateHabits(result: OnboardingResult): string {
  if (result.user.habits) {
    const items = result.user.habits.split(',').map(h => h.trim()).filter(Boolean)
    if (items.length > 0) {
      return items.map((h, i) => `${i + 1}. ${h}`).join('\n')
    }
  }
  return DEFAULT_HABITS.map((h, i) => `${i + 1}. ${h}`).join('\n')
}

export function generateContextDocuments(result: OnboardingResult, outputDir: string): string[] {
  const domainsDir = join(outputDir, 'domains')

  mkdirSync(outputDir, { recursive: true })
  mkdirSync(domainsDir, { recursive: true })

  const files: string[] = []

  // Habits
  const habitsPath = join(outputDir, 'habits.md')
  writeFileSync(habitsPath, generateHabits(result), 'utf-8')
  files.push(habitsPath)

  // Soul
  const soulPath = join(outputDir, 'soul.md')
  writeFileSync(soulPath, generateSoul(result), 'utf-8')
  files.push(soulPath)

  // Owner
  const ownerPath = join(outputDir, 'owner.md')
  writeFileSync(ownerPath, generateOwner(result), 'utf-8')
  files.push(ownerPath)

  // Domains
  for (const domain of result.domains) {
    const slug = domain.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const domainPath = join(domainsDir, `${slug}.md`)
    writeFileSync(domainPath, generateDomain(domain, result.system.name), 'utf-8')
    files.push(domainPath)
  }

  // Master Plan
  const planPath = join(outputDir, 'master-plan.md')
  writeFileSync(planPath, generateMasterPlan(result), 'utf-8')
  files.push(planPath)

  // Capabilities
  const capPath = join(outputDir, 'capabilities.md')
  writeFileSync(capPath, generateCapabilities(result), 'utf-8')
  files.push(capPath)

  // Growth Protocol
  const growthPath = join(outputDir, 'growth.md')
  writeFileSync(growthPath, generateGrowth(result), 'utf-8')
  files.push(growthPath)

  return files
}
