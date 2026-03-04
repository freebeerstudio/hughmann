# Domains

Domains are life categories that HughMann manages. Each domain gets its own context document, goals, and can be isolated from other domains for privacy.

## What Domains Are

A domain represents a major area of focus. Common types:

- **Career** — your day job (e.g., "Work - Acme Corp")
- **Business** — a side business or venture
- **Personal** — lifestyle, family, personal goals
- **Education** — learning and skill development
- **Health** — fitness, nutrition, wellness
- **Creative** — side projects, hobbies
- **Community** — social, volunteer, networking

Domains are created during `hughmann setup` and stored as individual markdown files in `~/.hughmann/context/domains/`.

## Isolation Zones

Each domain belongs to one of two isolation zones:

### Personal (default)

- Context is **shared** between all personal domains
- When a personal domain is active, HughMann sees that domain's doc **plus** all other personal domains
- Information flows freely — HughMann can connect dots across domains
- Use for interconnected life areas

### Isolated

- Context is **completely separate**
- When an isolated domain is active, HughMann sees **only** that domain's document
- No cross-domain information leaks
- Use for confidential work, client projects, or anything that should stay compartmentalized

### How Isolation Is Configured

Isolation zones are defined in `~/.hughmann/context/soul.md` under these sections:

```markdown
### Isolated Domains

- **Work - Acme Corp** (career) - Day job context
  - See domains/work-acme-corp.md for details

### Personal Domains

- **Personal**, **Health**, **Creative** - Shared personal context
  - See domains/personal.md, domains/health.md, domains/creative.md
```

The system parses bold domain names and `domains/*.md` file references from each section.

## Switching Domains

### CLI Flag

```bash
hughmann chat -d acme          # Start chat in a domain
hughmann run morning -d acme   # Run skill in a domain context
```

### Slash Command

```
alice > /domain acme           # Switch to domain
alice [Acme] > ...             # Prompt shows active domain
alice [Acme] > /domain         # Clear domain (return to general)
alice > /domains                  # List all domains with isolation
```

### Via MCP

External clients use the `set_domain` tool:

```json
{ "tool": "set_domain", "arguments": { "domain": "acme" } }
```

Pass `"none"` to clear the active domain.

### Session Persistence

When you resume a session, its domain is automatically restored. No need to re-set it.

## How Domain Context Appears in Prompts

The system prompt is assembled in layers, and domain context is included conditionally:

1. **Soul** — system identity (always included)
2. **Owner** — user identity and domain summaries (always included)
3. **Capabilities** — what the system can do (always included)
4. **Domain context** — depends on isolation:
   - **Isolated domain active**: only that domain's document
   - **Personal domain active**: that domain + all other personal domains
   - **No domain active**: no individual domain docs (owner.md has summaries)
5. **Master plan** — goals and quarterly focus (included for autonomous skills)
6. **Growth** — capability expansion (included for autonomous skills)
7. **Environment** — current time, timezone, active domain, mode

### Prompt Format

When a domain is active, its content appears like:

```markdown
## Active Domain: Work - Acme Corp [ISOLATED]

<contents of domains/work-acme-corp.md>
```

For personal domains, other personal domain context is also included:

```markdown
## Active Domain: Personal [PERSONAL]

<contents of domains/personal.md>

## Context: Health [PERSONAL]

<contents of domains/health.md>
```

## Editing Domain Documents

Domain docs are plain markdown files at `~/.hughmann/context/domains/<slug>.md`. Edit them directly or use:

### /note Command

```
alice [Acme] > /note Customer wants POC by end of month
```

Appends a note to the active domain's document.

### /log Command

```
alice [Acme] > /log Moved to phase 2 | Customer requested delay | Acme
```

Logs a decision with reasoning to `master-plan.md`.

### Autonomous Skills

Skills with `autonomous` complexity can edit domain documents directly. The `review` and `plan` skills update `master-plan.md` as part of their routine.

### Manual Editing

Open the file directly:

```bash
$EDITOR ~/.hughmann/context/domains/acme.md
```

Then reload in chat:

```
alice > /reload
```

## Skill Domain Targeting

Custom skills can specify a domain to auto-switch into:

```markdown
---
name: Customer Prep
description: Prepare for customer meeting
complexity: autonomous
domain: acme
---
```

When this skill runs, it automatically switches to the `acme` domain context, then switches back when done.

## Domain Display

### CLI Prompt

The active domain shows in your prompt:

```
alice >                   # No domain
alice [Acme] >         # Domain active
```

### Domain List

```
/domains
  Work - Acme Corp (career) [isolated] ← active
  Personal (personal) [personal]
  Health (health) [personal]
  Side Project (business) [isolated]
```
