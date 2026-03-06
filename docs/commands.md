# Commands

## CLI Commands

Run from your terminal. The default command is `chat`.

| Command | Description | Example |
|---------|-------------|---------|
| `hughmann` | Start interactive chat (default) | `hughmann` |
| `hughmann chat` | Start interactive chat | `hughmann chat -d acme` |
| `hughmann setup` | Run onboarding wizard | `hughmann setup` |
| `hughmann run <skill>` | Run a skill non-interactively | `hughmann run morning` |
| `hughmann <skill>` | Shorthand for `run <skill>` | `hughmann morning` |
| `hughmann skills` | List all available skills | `hughmann skills` |
| `hughmann domains` | List configured domains | `hughmann domains` |
| `hughmann status` | Quick status snapshot | `hughmann status` |
| `hughmann morning` | Morning dashboard | `hughmann morning -q` |
| `hughmann schedule` | Manage launchd schedules | `hughmann schedule install` |
| `hughmann mail` | Process Elle mailbox emails | `hughmann mail process` |
| `hughmann daemon` | Manage background daemon | `hughmann daemon start` |
| `hughmann telegram` | Start Telegram bot | `hughmann telegram` |
| `hughmann serve` | Start as MCP server (stdio) | `hughmann serve` |
| `hughmann vault` | Sync Obsidian vaults to database | `hughmann vault sync` |
| `hughmann migrate` | Print migration SQL (auto-detects Supabase/Turso) | `hughmann migrate` |
| `hughmann migrate --apply` | Connect and create tables (auto-detects engine) | `hughmann migrate --apply` |

### Global Flags

| Flag | Long | Description |
|------|------|-------------|
| `-c` | `--continue` | Resume the most recent session |
| `-n` | `--new` | Start a fresh session (no history) |
| `-d` | `--domain` | Set active domain (e.g., `-d acme`) |
| `-q` | `--quiet` | Minimal output (for scripts/cron) |
| `-h` | `--help` | Show help |

### Schedule Subcommands

```bash
hughmann schedule install           # Install all default schedules
hughmann schedule install morning   # Install one schedule
hughmann schedule list              # Show installed schedules
hughmann schedule remove            # Remove all schedules
hughmann schedule remove morning    # Remove one schedule
```

### Mail Subcommands

```bash
hughmann mail process               # Process new emails from Elle
hughmann mail process --dry-run     # Classify only, no files written
hughmann mail process --limit 10    # Process at most 10 emails
hughmann mail status                # Show last run time + processed count
```

### Vault Subcommands

```bash
hughmann vault sync                 # Sync all configured vaults to database
hughmann vault sync --vault omnissa # Sync a specific vault
```

### Daemon Subcommands

```bash
hughmann daemon start               # Start background daemon
hughmann daemon stop                # Stop daemon
hughmann daemon status              # Check daemon status and uptime
hughmann daemon queue "do this"     # Queue a task for processing
```

## Interactive Slash Commands

Available during `hughmann chat` sessions. Type `/help` to see them all.

### Conversation

| Command | Description | Example |
|---------|-------------|---------|
| `/new` | Distill current session and start fresh | `/new` |
| `/clear` | Start fresh without distilling | `/clear` |
| `/sessions` | List past sessions (1-10) | `/sessions` |
| `/resume <n>` | Resume a session by number or ID | `/resume 1` |
| `/exit` | Distill session and exit | `/exit` |

### Tasks & Skills

| Command | Description | Example |
|---------|-------------|---------|
| `/do <task>` | Execute an autonomous task (Opus + tools) | `/do Write a sales email for Acme` |
| `/parallel <task>` | Decompose into sub-agents and run in parallel | `/parallel Analyze all 3 domains` |
| `/skills` | List all available skills | `/skills` |
| `/mcp` | Show configured MCP servers | `/mcp` |
| `/<skill-id>` | Run any skill by ID | `/morning` |

### Memory & Analytics

| Command | Description | Example |
|---------|-------------|---------|
| `/distill` | Extract and save learnings from this session | `/distill` |
| `/memory` | Show recent memories (last 3 days) | `/memory` |
| `/usage` | Display token usage, costs, and limits | `/usage` |

### Domains

| Command | Description | Example |
|---------|-------------|---------|
| `/domain <name>` | Switch to a domain | `/domain acme` |
| `/domain` | Clear active domain | `/domain` |
| `/domains` | List all domains with isolation status | `/domains` |

### Context Updates

| Command | Description | Example |
|---------|-------------|---------|
| `/log` | Log a decision with reasoning | `/log Chose React \| Faster dev speed \| Side Project` |
| `/note` | Add a note to the active domain doc | `/note Follow up with customer on POC` |
| `/gap` | Log a capability gap | `/gap Send emails via Gmail API` |

### System

| Command | Description | Example |
|---------|-------------|---------|
| `/context` | Show loaded context info | `/context` |
| `/reload` | Reload context documents from disk | `/reload` |
| `/help` | Show all slash commands | `/help` |

## Examples

### Daily Workflow

```bash
# Morning — review priorities
hughmann morning

# During the day — chat in a domain
hughmann chat -d acme
> What's my top priority for Acme Corp?
> /do Draft a follow-up email for the POC meeting
> /log Moved POC to phase 2 | Customer requested more time | Acme
> /exit

# Afternoon — close out the day
hughmann closeout
```

### Quick Actions

```bash
# Check status without entering chat
hughmann status -q

# Run a skill with quiet output (for scripts)
hughmann morning -q

# Queue a task for the daemon
hughmann daemon queue "Summarize this week's customer interactions"
```

### Session Management

```
alice > /sessions
  1. Morning planning session (2025-03-04)
  2. Acme Corp follow-up (2025-03-03)
  3. Side project website review (2025-03-03)

alice > /resume 2
Resumed: Acme Corp follow-up

alice [Acme] > Where did we leave off?
```
