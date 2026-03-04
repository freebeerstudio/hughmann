# Skills

Skills are reusable AI prompts with configurable complexity. HughMann ships with six built-in skills and supports custom skills via markdown files.

## Built-In Skills

| ID | Name | Complexity | Max Turns | Description |
|----|------|------------|-----------|-------------|
| `morning` | Morning Dashboard | autonomous | 15 | Review priorities, set daily MUST + 3 MITs |
| `closeout` | Afternoon Closeout | conversational | — | Review progress, plan tomorrow, call out wins |
| `review` | Weekly Review | autonomous | 20 | Reflect on week, suggest next week's Big Rocks |
| `status` | Quick Status | conversational | — | One-line status per domain + top priority |
| `plan` | Master Plan Review | autonomous | 15 | Review and update quarterly goals and master plan |
| `habits` | Habit Check | conversational | — | Check in on 7 core daily habits |

## Running Skills

### From the CLI

```bash
# Full form
hughmann run morning

# Shorthand (built-in skills only)
hughmann morning

# With domain context
hughmann run morning -d acme

# Quiet mode (scripts/cron)
hughmann morning -q
```

### From Interactive Chat

```
alice > /morning
alice > /status
alice > /habits
alice > /skills          # List all available skills
```

### Via MCP

External MCP clients can call `run_skill` with a `skill_id` parameter.

## Complexity Tiers

Each skill declares a complexity tier that determines the model and capabilities:

| Tier | Model | Tools | Best For |
|------|-------|-------|----------|
| `lightweight` | Haiku | None | Quick answers, classifications, simple lookups |
| `conversational` | Sonnet | None | Discussion, analysis, most daily interactions |
| `autonomous` | Opus | File I/O, shell, web, MCP | Multi-step tasks, file edits, research |

Autonomous skills have a configurable `maxTurns` (default: 25) that limits the number of agent turns before stopping.

With a Claude Max subscription, all tiers are $0 per token.

## Creating Custom Skills

Add a `.md` file to `~/.hughmann/skills/`. The filename (minus `.md`) becomes the skill ID.

### Format

```markdown
---
name: Code Review
description: Review code changes and suggest improvements
complexity: autonomous
maxTurns: 10
---
Review the latest code changes in my current project. For each file:

1. Check for bugs or logic errors
2. Suggest simplifications
3. Flag any security concerns

Be specific — reference line numbers and provide fixed code.
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name |
| `description` | string | Yes | Shown in skill listings |
| `complexity` | enum | Yes | `lightweight`, `conversational`, or `autonomous` |
| `domain` | string | No | Auto-switch to this domain before running |
| `maxTurns` | integer | No | Max agent turns for autonomous skills (default: 25) |

### Example: Lightweight Skill

```markdown
---
name: Quick Summary
description: Summarize the current conversation
complexity: lightweight
---
Summarize our conversation so far in 3 bullet points. Focus on decisions made and action items.
```

### Example: Domain-Specific Skill

```markdown
---
name: Customer Prep
description: Prepare for a customer meeting
complexity: autonomous
domain: acme
maxTurns: 12
---
Prepare a meeting brief for my next customer meeting. Include:

- Customer context and recent interactions
- Open support requests or feature requests
- Talking points based on their current environment
- Any product updates relevant to their stack
```

### Naming Rules

- Filename becomes the skill ID: `code-review.md` → `/code-review`
- Files starting with `_` are ignored (use for templates)
- Custom skills cannot override built-in skill IDs
- Use lowercase and hyphens for filenames

### Hot Reload

Custom skills are loaded at startup. Use `/reload` in chat to pick up new or edited skills without restarting.

## Built-In Skill Details

### morning

Runs your morning dashboard routine:
- Quick status per domain
- This week's Big Rocks from master plan
- Today's focus: 1 MUST + 3 MITs
- Heads up on deadlines and commitments
- Calendar check (if MCP configured)

### closeout

Afternoon reflection:
- Progress check on today's work
- Incomplete items called out
- Tomorrow's setup and prep
- 1-2 wins from the day

### review

Friday weekly review:
- Per-domain progress review
- Big Rocks assessment
- Decisions worth noting
- Next week's suggested Big Rocks
- Quarterly goal progress check
- Course corrections if needed
- Can update `master-plan.md` directly

### status

Quick snapshot — one status line per domain plus the single most important thing to focus on right now. Designed to be under 20 lines.

### plan

Reviews and updates `master-plan.md`:
- Quarterly goal assessment
- Big Rock alignment
- Decision log summary
- Gap identification
- Makes edits directly to the file

### habits

Interactive check-in on 7 daily habits: walk, workout, meditation, inbox zero, reading, calorie deficit, system updates. Gives a score (X/7) and accountability nudge.
