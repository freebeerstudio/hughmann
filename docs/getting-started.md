# Getting Started

## Prerequisites

- **Node.js 20+** — Check with `node -v`
- **Claude Max subscription** (recommended, $0 per token via Claude OAuth) or an **OpenRouter API key**
- **macOS** recommended for daemon/scheduling features (launchd)

## Installation

```bash
git clone https://github.com/your-org/hughmann.git
cd hughmann
npm install
```

## Running Setup

```bash
npm run setup
# or: npx tsx src/cli.ts setup
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

- **Model providers** — Claude OAuth (free with Max subscription) and/or OpenRouter
- **Data engine** — Supabase for persistent storage + vector memory, or local-only
- **Frontends** — CLI, Telegram, or both
- **Execution engine** — local execution

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

## Add API Keys

Edit `~/.hughmann/.env`:

```bash
# Required if not using Claude OAuth
OPENROUTER_API_KEY=sk-or-...

# Optional: persistent storage + vector memory
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key

# Optional: vector memory search
EMBEDDING_API_KEY=sk-...

# Optional: Telegram bot
TELEGRAM_BOT_TOKEN=your-bot-token
```

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

Build and link for system-wide access:

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
