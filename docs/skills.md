# Skills

Skills are reusable AI prompts packaged as directories. HughMann ships with eight built-in skills and supports custom skills via the standard SKILL.md format.

## Built-In Skills

| ID | Name | Description |
|----|------|-------------|
| `morning` | Morning Dashboard | Review priorities, set daily MUST + 3 MITs |
| `closeout` | Afternoon Closeout | Review progress, plan tomorrow, call out wins |
| `review` | Weekly Review | Reflect on week, suggest next week's Big Rocks |
| `status` | Quick Status | One-line status per domain + top priority |
| `plan-review` | Master Plan Review | Review and update quarterly goals and master plan |
| `plan` | Task Planning | Create structured tasks from master plan and goals |
| `focus` | Strategic Planning | 15-min collaborative planning session |
| `habits` | Habit Check | Check in on 7 core daily habits |

All skills run with full capabilities (Opus model + tools). The model decides whether to use tools based on the task.

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
wayne > /morning
wayne > /status
wayne > /habits
wayne > /skills          # List all available skills
```

### Via MCP

External MCP clients can call `run_skill` with a `skill_id` parameter.

## Creating Custom Skills

Create a directory in `~/.hughmann/skills/` containing a `SKILL.md` file.

### Directory Structure

```
~/.hughmann/skills/
  code-review/
    SKILL.md            # Required: frontmatter + prompt
    references/         # Optional: reference documents
    scripts/            # Optional: helper scripts
    assets/             # Optional: images, data files
```

### SKILL.md Format

```markdown
---
name: Code Review
description: Review code changes and suggest improvements
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
| `domain` | string | No | Auto-switch to this domain before running (Hugh extension) |

### Example: Domain-Specific Skill

```markdown
---
name: Customer Prep
description: Prepare for a customer meeting
domain: acme
---
Prepare a meeting brief for my next customer meeting. Include:

- Customer context and recent interactions
- Open support requests or feature requests
- Talking points based on their current environment
- Any product updates relevant to their stack
```

### Naming Rules

- Directory name becomes the skill ID: `code-review/` → `/code-review`
- Directories starting with `_` are ignored (use for templates)
- Custom skills cannot override built-in skill IDs
- Use lowercase and hyphens for directory names

### Hot Reload

Custom skills are loaded at startup. Use `/reload` in chat to pick up new or edited skills without restarting.

## Migration from Legacy Format

Previously, skills used flat `.md` files with `complexity` and `maxTurns` frontmatter:

```markdown
---
name: My Skill
description: What it does
complexity: autonomous
maxTurns: 15
---
Prompt here...
```

These flat `.md` files still load but produce a deprecation warning. To migrate:

1. Create a directory with the skill name: `~/.hughmann/skills/my-skill/`
2. Move your `.md` file into it as `SKILL.md`
3. Remove `complexity` and `maxTurns` from the frontmatter (they're ignored now)
4. Delete the original flat `.md` file

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

### plan-review

Reviews and updates `master-plan.md`:
- Quarterly goal assessment
- Big Rock alignment
- Decision log summary
- Gap identification
- Makes edits directly to the file

### plan

Creates structured tasks from master plan and goals. Uses internal tools to create tasks in the database.

### focus

Interactive 15-minute strategic planning session. Hugh leads, proposes projects and tasks, captures decisions. Uses planning tools to create projects and tasks. Now also surfaces auto-detected self-improvement gaps for review — any gaps worth promoting to active work or dismissing.

### habits

Interactive check-in on 7 daily habits: walk, workout, meditation, inbox zero, reading, calorie deficit, system updates. Gives a score (X/7) and accountability nudge.
