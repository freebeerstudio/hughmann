# Getting Started

## Prerequisites

- **Node.js 20+** — Check with `node -v`
- **Claude Max subscription** (recommended, $0 per token via Claude OAuth) or an **OpenRouter API key**
- **macOS** recommended for daemon/scheduling features (launchd)

## Quick Start (npx)

```bash
npx create-hughmann
```

This runs the setup wizard — no git clone needed.

## Install from Source

```bash
git clone https://github.com/freebeerstudio/hughmann.git
cd hughmann
npm install
npm run setup
```

## Running Setup

If you've already installed, re-run setup with:

```bash
hughmann setup
```

The setup wizard walks through five phases:

### 1. System Identity

Choose a name and personality for your AI. Pick a communication style (direct, friendly, formal) and set any custom rules.

### 2. User Identity

Enter your name, a short description, timezone, peak work hours, and communication style preferences.

### 3. Life Domains

Define the major areas of your life. For each domain you provide:

- **Name** — e.g., "Work - Acme Corp"
- **Type** — career, business, personal, education, health, creative, community
- **Description** — what this domain covers
- **Primary goal** — the one thing that matters most right now
- **Quarterly goals** — top 2-3 goals for the quarter
- **Active projects** — what you're working on
- **Tools** — systems and platforms you use
- **Biggest challenge** — what's blocking progress

Domains can be marked as **isolated** (no cross-domain information leaks) or **personal** (shared context between personal domains). See [Domains](domains.md) for details.

### 4. Infrastructure

Choose your stack:

- **Data engine** — Supabase (managed Postgres + vector search), SQLite (local, zero config), or Turso (cloud SQLite with edge replication)
- **Execution engine** — Trigger.dev (cloud workflows), local daemon, or hybrid
- **Frontends** — CLI, Telegram, Discord, iOS, web, iMessage
- **Model providers** — Claude Max (free via OAuth), Claude API, OpenRouter, OpenAI

If you select Supabase or Turso, the wizard offers to connect and create tables inline. API keys for selected providers (OpenRouter, Claude API, OpenAI) and frontends (Telegram) are also collected and validated during setup.

### 5. Autonomy Settings

Set how much independence HughMann gets: supervised (asks before acting) or autonomous (acts within guardrails). Configure active hours and communication channels.

## What Setup Creates

After onboarding, `~/.hughmann/` contains:

```
~/.hughmann/
├── .onboarding-data.json     # Your setup answers
├── .env                      # API keys (add manually)
├── context/
│   ├── soul.md               # System identity and rules
│   ├── owner.md              # Your identity and domain summaries
│   ├── master-plan.md        # Goals and quarterly focus
│   ├── capabilities.md       # What the system can do
│   ├── growth.md             # How to expand capabilities
│   ├── habits.md             # Daily habits for /habits skill
│   └── domains/
│       ├── work.md           # One file per domain
│       └── personal.md
├── sessions/                 # Conversation history
├── memory/                   # Distilled memories
├── skills/                   # Custom skills
├── inbox/                    # Daemon trigger files
├── daemon/                   # Daemon state
└── logs/                     # Execution logs
```

## API Keys

Most API keys are collected and validated during `hughmann setup`. If you skip any or need to add them later, edit `~/.hughmann/.env`:

```bash
# Model providers (collected during setup if selected)
OPENROUTER_API_KEY=your-openrouter-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key

# Data engines (collected during setup if selected)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-service-role-key
TURSO_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token

# Embeddings (optional)
EMBEDDING_API_KEY=your-embedding-api-key

# Frontends (collected during setup if selected)
TELEGRAM_BOT_TOKEN=your-bot-token
```

### Claude Max OAuth

Claude Max requires no API key. It uses the Claude Agent SDK's built-in OAuth flow:

1. On first run, a browser window opens asking you to authorize HughMann
2. You sign in with your Anthropic account (the one with the Max/Pro subscription)
3. The SDK stores the OAuth token locally — you won't be prompted again
4. All Claude calls use your subscription (no per-token cost)

If you don't have a Claude subscription, use `OPENROUTER_API_KEY` instead.

A `.env.example` file is included in the repo with all available env vars documented.

## First Conversation

```bash
npm run chat
# or after global install: hughmann chat
```

You'll see a prompt with your name:

```
alice >
```

Type anything to start. HughMann loads your context (identity, domains, goals) into the system prompt automatically.

### Try These First

```
alice > What do you know about me?
alice > What are my priorities this week?
alice > /morning
alice > /status
alice > /help
```

### Session Management

HughMann automatically manages sessions:

- Conversations are saved to `~/.hughmann/sessions/`
- Every ~10 turns, key facts are distilled to `~/.hughmann/memory/`
- Use `/new` to start a fresh session (distills first)
- Use `/sessions` to see past sessions and `/resume <number>` to pick one up

## Global Install

Install globally from npm:

```bash
npm install -g create-hughmann
```

Or build and link from source:

```bash
npm run build
npm link
```

Now you can run from anywhere:

```bash
hughmann              # Start chatting
hughmann morning      # Run morning dashboard
hughmann status       # Quick status check
hughmann -d acme   # Chat in a specific domain
```

## Next Steps

- [Commands](commands.md) — Full command reference
- [Skills](skills.md) — Built-in routines and custom skills
- [Domains](domains.md) — Understanding domain isolation
- [Configuration](configuration.md) — All config files and env vars
