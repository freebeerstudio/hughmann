# Configuration

## Directory Layout

```
~/.hughmann/
├── .env                          # Environment variables
├── .onboarding-data.json         # Setup wizard answers
│
├── context/                      # Context documents (auto-loaded at boot)
│   ├── soul.md                   # System identity and rules
│   ├── owner.md                  # User identity and domain summaries
│   ├── master-plan.md            # Goals and quarterly focus (optional)
│   ├── capabilities.md           # What the system can do (optional)
│   ├── growth.md                 # Capability expansion (optional)
│   └── domains/                  # One file per domain
│       ├── work-acme-corp.md
│       ├── personal.md
│       └── ...
│
├── sessions/                     # Conversation history
│   └── {uuid}.json               # Session with messages, metadata
│
├── memory/                       # Distilled memories
│   ├── 2025-03-04.md             # One file per day
│   └── ...
│
├── skills/                       # Custom skills
│   └── {skill-id}.md             # Markdown with frontmatter
│
├── mcp.json                      # MCP server configuration (optional)
│
├── daemon/                       # Daemon state
│   ├── daemon.pid                # Process ID
│   ├── heartbeat                 # Last heartbeat timestamp
│   ├── queue.jsonl               # Pending tasks
│   └── schedule.json             # Schedule rules
│
├── inbox/                        # Daemon trigger files
│   └── *.md / *.txt              # Processed and deleted
│
└── logs/                         # Execution logs
    ├── daemon.log                # Daemon activity
    ├── results-YYYY-MM-DD.md     # Daily skill/task results
    ├── {skillId}.log             # launchd stdout
    └── {skillId}.error.log       # launchd stderr
```

The home directory defaults to `~/.hughmann/`. Override with the `HUGHMANN_HOME` environment variable.

## Environment Variables

Add to `~/.hughmann/.env`. Loaded automatically at boot (won't override existing env vars).

### Core

| Variable | Description | Default |
|----------|-------------|---------|
| `HUGHMANN_HOME` | Override home directory | `~/.hughmann` |

### Model Providers

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENROUTER_API_KEY` | OpenRouter API key | If using OpenRouter |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) API key | If using Claude API |
| `OPENAI_API_KEY` | OpenAI API key | If using OpenAI |

Claude Max (via Claude Max subscription) is the preferred provider and requires no API key — it authenticates via the Claude agent SDK. API keys for selected providers are collected and validated during `hughmann setup`.

### Data Engines

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | For Supabase engine |
| `SUPABASE_KEY` | Supabase service role key | For Supabase engine |
| `TURSO_URL` | Turso database URL (`libsql://` or `https://`) | For Turso engine |
| `TURSO_AUTH_TOKEN` | Turso auth token | For Turso engine |

SQLite requires no configuration — data is stored locally at `~/.hughmann/data/hughmann.db`. Supabase and Turso credentials are collected during `hughmann setup` or via `hughmann migrate --apply`.

### Embeddings

| Variable | Description | Default |
|----------|-------------|---------|
| `EMBEDDING_API_KEY` | Embedding API key | Falls back to `OPENAI_API_KEY` |
| `EMBEDDING_API_URL` | Embedding endpoint | `https://api.openai.com/v1/embeddings` |
| `EMBEDDING_MODEL` | Model name | `text-embedding-3-small` |
| `OPENAI_API_KEY` | OpenAI key (backup for embeddings) | — |

### Communication

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather | For `hughmann telegram` |

### Example .env

```bash
# Model providers (if not using Claude Max)
OPENROUTER_API_KEY=your-openrouter-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key

# Data engine — Supabase
SUPABASE_URL=https://myproject.supabase.co
SUPABASE_KEY=your-supabase-service-role-key

# Data engine — Turso (alternative to Supabase)
TURSO_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token

# Embeddings
EMBEDDING_API_KEY=your-embedding-api-key

# Telegram
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
```

## mcp.json

Defines external MCP servers that HughMann can use during autonomous tasks. File: `~/.hughmann/mcp.json`.

```json
{
  "servers": {
    "google-workspace": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/google-workspace-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "$GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET": "${GOOGLE_CLIENT_SECRET}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/filesystem-mcp", "/Users/you/Documents"]
    },
    "remote": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

### Server Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Executable to run (stdio transport) |
| `args` | string[] | CLI arguments |
| `env` | object | Environment variables for the server process |
| `url` | string | SSE endpoint (for remote HTTP servers) |

- Environment variables in `args` and `env` values are expanded (`$VAR` or `${VAR}`)
- Transport type is inferred: `url` present → SSE, otherwise stdio
- Servers are started on-demand when autonomous tasks need tools

## daemon/schedule.json

Defines when skills run automatically. File: `~/.hughmann/daemon/schedule.json`.

```json
[
  { "skillId": "morning", "hour": 7, "minute": 0 },
  { "skillId": "closeout", "hour": 16, "minute": 0 },
  { "skillId": "review", "hour": 9, "minute": 0, "weekday": 5 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `skillId` | string | Skill ID to run |
| `hour` | 0-23 | Hour of execution |
| `minute` | 0-59 | Minute of execution |
| `weekday` | 0-6 | Optional. 0 = Sunday, 5 = Friday. Omit for daily. |

Auto-created with defaults if missing. Used by both the daemon polling loop and launchd schedule installation.

## Context Document Types

Markdown files in `~/.hughmann/context/` are classified by filename:

| Filename | Type | Always Loaded | Description |
|----------|------|---------------|-------------|
| `soul.md` | soul | Yes | System identity, personality, communication rules |
| `owner.md` | owner | Yes | User identity, working style, domain summaries |
| `master-plan.md` | master-plan | Autonomous only | Strategic goals, quarterly focus, Big Rocks |
| `capabilities.md` | capabilities | Autonomous only | Available tools, skills, and resources |
| `growth.md` | growth | Autonomous only | Learning goals, capability expansion |
| `domains/*.md` | domain | Conditional | Per-domain context (see [Domains](domains.md)) |

### Document Format

All context docs are plain markdown. They must start with an H1 title:

```markdown
# System Identity: HughMann

Core personality and rules here...
```

### Isolation Markers in soul.md

Domain isolation is configured via section headers in `soul.md`:

```markdown
### Isolated Domains

- **Work - Acme Corp** (career)
  - See domains/work-acme-corp.md

### Personal Domains

- **Personal**, **Health** - shared context
  - See domains/personal.md, domains/health.md
```

See [Domains](domains.md) for full details.

## Custom Skill File Format

Markdown files with YAML-style frontmatter. File: `~/.hughmann/skills/<skill-id>.md`.

```markdown
---
name: Code Review
description: Review code changes and suggest improvements
complexity: autonomous
domain: acme
maxTurns: 10
---
Your skill prompt goes here. Everything after the frontmatter
becomes the instruction sent to the model.

Supports full markdown.
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name |
| `description` | string | Yes | Brief description |
| `complexity` | enum | Yes | `lightweight`, `conversational`, or `autonomous` |
| `domain` | string | No | Auto-switch to this domain before running |
| `maxTurns` | integer | No | Max agent turns for autonomous (default: 25) |

### Naming

- Filename (minus `.md`) = skill ID
- Invoke as `/<skill-id>` or `hughmann run <skill-id>`
- Files starting with `_` are ignored
- Cannot override built-in skill IDs

## Onboarding Data

Stored at `~/.hughmann/.onboarding-data.json`. Generated by `hughmann setup`. Contains:

- **system** — AI name, personality, communication rules
- **user** — your name, timezone, working style
- **domains** — life domains with goals and context
- **infrastructure** — model providers, storage, frontends
- **autonomy** — independence level, active hours

This file drives context document generation. Re-run `hughmann setup` to regenerate.

## Source Directory

For development:

```
src/
├── cli.ts                    # CLI entry point
├── config.ts                 # Config loading, HUGHMANN_HOME
├── index.ts                  # Setup entry point
├── mcp-server.ts             # MCP server
├── banner.ts                 # CLI banner
├── types/                    # TypeScript interfaces
├── runtime/                  # Core runtime (boot, session, memory, skills, etc.)
├── adapters/
│   ├── model/                # Claude OAuth, OpenRouter
│   ├── embeddings/           # Vector embeddings
│   ├── data/                 # Supabase, SQLite, Turso
│   └── frontend/             # CLI, Telegram
├── daemon/                   # Background daemon
├── scheduler/                # launchd integration
├── onboarding/               # Setup wizard phases
├── generators/               # Context document generation
└── util/                     # Markdown rendering
```

### NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `tsx src/cli.ts` | Run in dev mode |
| `chat` | `tsx src/cli.ts chat` | Interactive chat (dev) |
| `setup` | `tsx src/cli.ts setup` | Onboarding wizard (dev) |
| `build` | `tsc` | Compile TypeScript |
| `start` | `node dist/cli.js` | Run compiled |
| `typecheck` | `tsc --noEmit` | Type check only |
