# HughMann

Your personal AI operating system. HughMann is a context-aware AI runtime that manages your life domains, tracks goals, executes autonomous tasks, and learns from every conversation — all from the terminal.

## Features

- **Domain isolation** — Separate contexts for work, business, personal life with configurable privacy boundaries
- **Skill system** — Built-in routines (morning dashboard, weekly review, habit tracking) plus custom skills
- **Autonomous task execution** — Opus-powered agent with file I/O, shell access, web search, and MCP tools
- **Memory & distillation** — Automatic conversation summaries with optional vector search via Supabase
- **Model routing** — Haiku for quick tasks, Sonnet for conversation, Opus for autonomous work
- **MCP server & client** — Expose HughMann as tools for other AI clients; consume external MCP servers
- **Telegram bot** — Full access to skills and chat from your phone
- **Daemon & scheduling** — Background process with cron-like skill scheduling and inbox triggers
- **Sub-agents** — Decompose complex tasks into parallel agents with `/parallel`
- **Cost tracking** — Token usage and cost breakdowns by domain, day, week, and month

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/hughmann.git
cd hughmann
npm install

# 2. Run onboarding
npm run setup

# 3. Start chatting
npm run chat
```

After onboarding you can install globally:

```bash
npm run build
npm link

# Now use from anywhere
hughmann chat
hughmann morning
hughmann status
```

## Requirements

- **Node.js** 20+
- **Claude Max subscription** (for Claude OAuth — $0 per token) or **OpenRouter API key**
- **macOS** recommended (launchd scheduling is macOS-only)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontends                         │
│   CLI  ·  Telegram  ·  MCP Server  ·  Daemon        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                    Runtime                           │
│  Context Loader · System Prompt Builder · Sessions   │
│  Memory Manager · Skill Manager · Usage Tracker      │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                  Model Router                        │
│  Haiku (lightweight) · Sonnet (conversational)       │
│  Opus + tools (autonomous)                           │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                   Adapters                           │
│  Claude OAuth · OpenRouter · Supabase · Embeddings   │
│  MCP Clients · Sub-Agents                            │
└─────────────────────────────────────────────────────┘
```

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, setup, first conversation |
| [Commands](docs/commands.md) | CLI commands and interactive slash commands |
| [Skills](docs/skills.md) | Built-in skills, custom skills, complexity tiers |
| [Domains](docs/domains.md) | Domain isolation and context switching |
| [Integrations](docs/integrations.md) | MCP, Telegram, Supabase, embeddings, sub-agents |
| [Daemon](docs/daemon.md) | Background daemon and scheduling |
| [Configuration](docs/configuration.md) | Directory layout, env vars, config files |

## License

MIT
