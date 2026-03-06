# HughMann

Your personal AI operating system. HughMann is a context-aware AI runtime that manages your life domains, tracks goals, executes autonomous tasks, and learns from every conversation — all from the terminal.

## Built to Act, Not Ask

Most AI tools ask permission before every action. HughMann doesn't.

When you talk to HughMann, he can read your files, write code, run commands, search the web, manage tasks, and update his own context — all in a normal conversation. No "may I read this file?" prompts. No approval dialogs. No friction between thinking and doing.

This is intentional. HughMann is a **personal AI operating system**, not a shared tool. He runs on your machine, on your files, under your account. The trust model is simple: he's your agent, acting on your behalf. You set the goals; he executes.

**Safety comes from architecture, not permission prompts:**
- **Guardrails** — Max tasks per day, max turns per task, cooldown after failures, business hours enforcement
- **Context rules** — His soul document defines hard boundaries (never spend money, never grant access to sensitive systems without explicit approval)
- **Auditability** — Every session, memory, decision, and action is logged to disk
- **Growth protocol** — When he discovers a capability gap, he logs it and proposes solutions rather than improvising

You choose your autonomy level during onboarding — from conservative (asks before most actions) to full autonomy (executes the plan, reports daily). But even at the lowest setting, HughMann has the *ability* to act. The difference is whether he checks in first.

## Features

- **Full tool access in every conversation** — Read, write, shell, web search, MCP tools — no permission barriers between you and getting things done
- **Domain isolation** — Separate contexts for work, business, personal life with configurable privacy boundaries
- **Skill system** — Built-in routines (morning dashboard, weekly review, habit tracking) plus custom skills
- **Autonomous task execution** — Opus-powered agent with file I/O, shell access, web search, and MCP tools
- **Memory & distillation** — Automatic conversation summaries with optional vector search via Supabase
- **Self-improvement** — Automatic gap detection from conversation distillation and daemon failures, with a permanent self-improvement project that surfaces gaps during planning sessions
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
│  Claude Opus 4.6 + tools (all tasks)                  │
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
| [Skills](docs/skills.md) | Built-in skills and custom skills |
| [Domains](docs/domains.md) | Domain isolation and context switching |
| [Integrations](docs/integrations.md) | MCP, Telegram, Supabase, embeddings, sub-agents |
| [Daemon](docs/daemon.md) | Background daemon and scheduling |
| [Configuration](docs/configuration.md) | Directory layout, env vars, config files |

## License

MIT
