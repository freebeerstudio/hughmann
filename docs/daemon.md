# Daemon & Scheduling

The HughMann daemon is a background process that runs scheduled skills, processes inbox trigger files, and handles queued tasks.

## Starting and Stopping

```bash
# Start the daemon
hughmann daemon start

# Check status (PID, uptime, heartbeat)
hughmann daemon status

# Stop the daemon
hughmann daemon stop
```

The daemon writes its PID to `~/.hughmann/daemon/daemon.pid` and updates a heartbeat file every 30 seconds. If the heartbeat is older than 2 minutes, status reports it as "may be stale."

## Scheduled Skills

The daemon checks schedules every 60 seconds and runs matching skills automatically.

### Default Schedules

| Skill | Time | Frequency |
|-------|------|-----------|
| `morning` | 7:00 AM | Daily |
| `closeout` | 4:00 PM | Daily |
| `review` | 9:00 AM | Fridays only |

### Schedule Configuration

Schedules are defined in `~/.hughmann/daemon/schedule.json`:

```json
[
  { "skillId": "morning", "hour": 7, "minute": 0 },
  { "skillId": "closeout", "hour": 16, "minute": 0 },
  { "skillId": "review", "hour": 9, "minute": 0, "weekday": 5 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `skillId` | string | Skill to run |
| `hour` | 0-23 | Hour of execution |
| `minute` | 0-59 | Minute of execution |
| `weekday` | 0-6 | Optional. 0 = Sunday, 5 = Friday. Omit for daily. |

The file is auto-created with defaults if missing. Edit to customize times or add custom skill schedules.

### Duplicate Prevention

The daemon tracks which skills have already executed today and won't re-run them. The tracker resets at midnight. Schedule matching has a ±1 minute tolerance.

## launchd Integration

For macOS, HughMann can install launchd agents to run skills on a schedule — even without the daemon running.

### Install Schedules

```bash
# Install all default schedules
hughmann schedule install

# Install one specific schedule
hughmann schedule install morning
```

This creates plist files at `~/Library/LaunchAgents/com.hughmann.skill.<skillId>.plist` and loads them with `launchctl`.

### List Installed Schedules

```bash
hughmann schedule list
```

Shows each skill, its scheduled time, frequency (daily/weekly), and whether it's currently active in launchd.

### Remove Schedules

```bash
# Remove all schedules
hughmann schedule remove

# Remove one
hughmann schedule remove morning
```

Unloads from launchd and deletes the plist file.

### Logs

launchd captures output to:
- `~/.hughmann/logs/<skillId>.log` — stdout
- `~/.hughmann/logs/<skillId>.error.log` — stderr

## Inbox Trigger Files

Drop a `.md` or `.txt` file into `~/.hughmann/inbox/` and the daemon will process it as an autonomous task.

### How It Works

1. Daemon polls `~/.hughmann/inbox/` every 60 seconds
2. Picks up any `.md` or `.txt` files
3. Reads file content as the task description
4. Executes via `doTaskStream()` (up to 15 agent turns)
5. Logs results to `~/.hughmann/logs/results-YYYY-MM-DD.md`
6. **Deletes the file** after processing

### Example

```bash
echo "Summarize my progress on the Acme Corp POC" > ~/.hughmann/inbox/acme-update.md
```

The daemon picks it up, runs the task, logs the result, and deletes the file.

## Task Queue

Queue tasks for the daemon to process without entering chat.

### Queuing Tasks

```bash
hughmann daemon queue "Generate a weekly summary for all domains"
```

Tasks are appended to `~/.hughmann/daemon/queue.jsonl` (one JSON object per line).

### Task Format

```json
{
  "type": "task",
  "content": "Generate weekly summary",
  "domain": "acme",
  "source": "queue",
  "createdAt": "2025-03-04T14:30:00.000Z"
}
```

| Field | Values | Description |
|-------|--------|-------------|
| `type` | `skill`, `task`, `chat` | How to process the item |
| `content` | string | Skill ID (for `skill`) or task/message text |
| `domain` | string | Optional domain to switch into |
| `source` | `schedule`, `inbox`, `queue`, `api` | Where the task came from |

### Processing

The daemon reads and clears the queue file every 60 seconds, then processes each task:

- **`skill`** — Looks up and runs the skill by ID
- **`task`** — Runs as an autonomous task (up to 15 turns)
- **`chat`** — Simple conversational response

## Logs and Results

### Log Files

| File | Location | Content |
|------|----------|---------|
| `daemon.log` | `~/.hughmann/logs/` | Daemon activity (startup, polling, errors) |
| `results-YYYY-MM-DD.md` | `~/.hughmann/logs/` | Daily task/skill output |
| `<skillId>.log` | `~/.hughmann/logs/` | launchd stdout |
| `<skillId>.error.log` | `~/.hughmann/logs/` | launchd stderr |

### Viewing Logs

```bash
# Daemon activity
tail -f ~/.hughmann/logs/daemon.log

# Today's results
cat ~/.hughmann/logs/results-2025-03-04.md

# Morning dashboard output (from launchd)
cat ~/.hughmann/logs/morning.log
```

### Results Format

Each result in the daily file:

```markdown
## morning — 07:00:15

<skill output>

---

## inbox: acme-update.md — 14:30:22

<task output>

---
```

## Daemon State Files

All stored in `~/.hughmann/daemon/`:

| File | Purpose |
|------|---------|
| `daemon.pid` | Process ID (plain text) |
| `heartbeat` | Last heartbeat ISO timestamp |
| `queue.jsonl` | Pending tasks (JSON Lines) |
| `schedule.json` | Schedule rules (JSON array) |

## Debugging

```bash
# Is the daemon running?
hughmann daemon status

# Check launchd schedules
launchctl list | grep hughmann

# Manually trigger a launchd schedule
launchctl start com.hughmann.skill.morning

# View a schedule plist
cat ~/Library/LaunchAgents/com.hughmann.skill.morning.plist
```
