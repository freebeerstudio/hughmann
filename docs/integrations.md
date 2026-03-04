# Integrations

## MCP Server

HughMann exposes itself as an MCP (Model Context Protocol) server, allowing external AI clients to use HughMann's capabilities as tools.

### Starting the Server

```bash
hughmann serve
```

Runs on stdio transport — designed to be launched by MCP clients.

### Configuring Clients

Add HughMann to any MCP-compatible client. Example for Claude Code (`~/.claude/mcp.json`):

```json
{
  "servers": {
    "hughmann": {
      "command": "hughmann",
      "args": ["serve"]
    }
  }
}
```

Or using the development binary:

```json
{
  "servers": {
    "hughmann": {
      "command": "npx",
      "args": ["tsx", "/path/to/hughmann/src/mcp-server.ts"]
    }
  }
}
```

### Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `chat` | Send a message and get a response | `message` |
| `run_skill` | Execute a skill | `skill_id`, `extra_context?` |
| `list_skills` | List all skills with complexity tiers | — |
| `list_domains` | List configured domains | — |
| `set_domain` | Switch active domain | `domain` ("none" to clear) |
| `get_status` | Current session info and system name | — |
| `search_memory` | Semantic search or recent memories | `query?`, `count?`, `domain?` |
| `distill` | Extract key facts from current session | — |
| `do_task` | Autonomous task with tools | `task`, `max_turns?` |
| `get_usage` | Token counts and costs | — |
| `run_parallel` | Decompose task into parallel sub-agents | `task` |
| `reload_context` | Reload context docs from disk | — |

---

## MCP Clients

HughMann consumes external MCP servers defined in `~/.hughmann/mcp.json`. These tools become available to autonomous skills and `/do` tasks.

### Configuration

```json
{
  "servers": {
    "google-workspace": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/google-workspace-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-secret"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/filesystem-mcp", "/Users/you/Documents"]
    },
    "remote-server": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

### Server Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Executable to run (for stdio transport) |
| `args` | string[] | CLI arguments (supports `$VAR` and `${VAR}` expansion) |
| `env` | object | Environment variables (supports variable expansion) |
| `url` | string | SSE endpoint URL (for remote HTTP servers) |

Transport type is inferred: `url` → SSE, otherwise stdio.

### Viewing Configured Servers

```
alice > /mcp
```

Lists all configured MCP servers and their status.

---

## Telegram

Run HughMann as a Telegram bot for mobile access.

### Setup

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the bot token
4. Add to `~/.hughmann/.env`:
   ```
   TELEGRAM_BOT_TOKEN=your-bot-token-here
   ```
5. Start the bot:
   ```bash
   hughmann telegram
   ```

### Available Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and command list |
| `/skills` | List all available skills |
| `/domains` | List domains with isolation status |
| `/domain <name>` | Switch domain (empty to clear) |
| `/do <task>` | Execute an autonomous task |
| `/morning` | Morning dashboard |
| `/closeout` | Afternoon closeout |
| `/status` | Quick status |
| `/habits` | Habit check-in |
| `/review` | Weekly review |

Custom skills are also registered as commands automatically.

### Features

- Typing indicators while processing
- Long messages auto-split at paragraph boundaries (4096 char Telegram limit)
- Markdown formatting with plain text fallback
- Tool action log display for autonomous tasks (last 10 actions)
- Regular text messages are treated as chat

---

## Supabase

Supabase provides persistent storage with vector search for semantic memory.

### Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Add credentials to `~/.hughmann/.env`:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-anon-key
   ```
3. Get the migration SQL:
   ```bash
   hughmann migrate
   ```
4. Run the output in your Supabase SQL editor

### What Gets Synced

| Data | When | Direction |
|------|------|-----------|
| Sessions | After each turn | Write (fire-and-forget) |
| Memories | After distillation (~10 turns) | Write |
| Memory embeddings | After distillation (if embeddings configured) | Write |
| Decisions | On `/log` command | Write |
| Domain notes | On `/note` command | Write |

### Tables

| Table | Purpose |
|-------|---------|
| `sessions` | Chat sessions with messages (JSONB) |
| `memories` | Distilled session summaries |
| `decisions` | Decision log with reasoning |
| `domain_notes` | Per-domain context notes |
| `memory_embeddings` | Vector embeddings for semantic search |

### Migration

The migration creates all tables, the pgvector extension, an HNSW index for fast cosine similarity search, and a `search_memories()` RPC function.

Supabase is optional. Without it, everything works locally with file-based sessions and memory.

---

## Embeddings

Vector embeddings enable semantic memory search — finding relevant past conversations by meaning rather than keywords.

### Provider Configuration

Uses any OpenAI-compatible embedding API. Add to `~/.hughmann/.env`:

```
# Required (or use OPENAI_API_KEY)
EMBEDDING_API_KEY=sk-...

# Optional: custom endpoint (default: OpenAI)
EMBEDDING_API_URL=https://api.openai.com/v1/embeddings

# Optional: model (default: text-embedding-3-small)
EMBEDDING_MODEL=text-embedding-3-small
```

Works with OpenAI, OpenRouter, Ollama, or any compatible API.

### How Vector Memory Works

1. **Distillation** — Every ~10 turns, HughMann extracts key facts from the conversation
2. **Embedding** — The distilled text is converted to a 1536-dimension vector
3. **Storage** — Vector stored in Supabase `memory_embeddings` table
4. **Search** — User queries are embedded and compared via cosine similarity
5. **Results** — Most similar memories returned with similarity scores

### Requirements

Both Supabase **and** embedding credentials must be configured for vector memory. Without either, HughMann falls back to file-based recent memory (last 3 days).

### MCP Integration

The `search_memory` tool:
- With a query: performs semantic vector search
- Without a query: returns recent file-based memories
- Supports domain filtering

---

## Sub-Agents

The `/parallel` command decomposes complex tasks into independent sub-agents that run simultaneously.

### Usage

```
alice > /parallel Analyze my progress across all three domains and suggest next steps
```

### How It Works

1. **Decomposition** — A lightweight model analyzes the task and splits it into 2-5 independent sub-tasks
2. **Assignment** — Each sub-task gets a complexity tier (lightweight, conversational, or autonomous)
3. **Execution** — All sub-agents run in parallel via `Promise.all()`
4. **Synthesis** — Results are collected and formatted as a combined markdown output

### Sub-Agent Structure

Each sub-agent gets:
- Its own task description
- A complexity tier (determines model + tool access)
- Optional domain context
- MCP server access (for autonomous agents)
- A max turn limit (default: 15)

### When to Use

- Tasks that can be split into independent parts
- Multi-domain analysis
- Research across multiple topics
- Any task where parallelism speeds things up

If decomposition would produce only one agent, HughMann runs it as a single task instead.

### Via MCP

External clients use the `run_parallel` tool:

```json
{ "tool": "run_parallel", "arguments": { "task": "Analyze all domains" } }
```
