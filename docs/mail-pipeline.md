# Mail Pipeline

The mail pipeline reads emails from Apple Mail's **Elle** mailbox, classifies each one with Haiku, and writes structured markdown to your Omnissa vault's `_inbox/` folder. Existing vault sync handles vectorization into Supabase.

## How It Works

1. **Find mailbox** — Searches your Exchange account for the "Elle" subfolder (handles nested paths like `Inbox/Elle`)
2. **List messages** — Pulls message IDs, subjects, senders, and dates
3. **Filter** — Skips emails already processed (tracked in a local state file)
4. **Read + Classify** — Reads each email's full body, sends it to Haiku via OpenRouter for structured classification
5. **Write markdown** — Generates a frontmatter-rich `.md` file in `_inbox/`
6. **Update state** — Marks each email as processed so it's skipped next run

## Setup

### Prerequisites

These should already be in `~/.hughmann/.env`:

```
OPENROUTER_API_KEY=your-key
VAULT_OMNISSA_PATH=/Users/wbridges/Vault_Omnissa/Vault_Omnissa
```

The pipeline also reads (with sensible defaults):

```
MAIL_ACCOUNT=Exchange    # Apple Mail account name
MAIL_MAILBOX=Elle        # Mailbox/subfolder to read from
```

### Apple Mail

The "Elle" folder must exist in your Exchange account in Apple Mail and contain at least one message. It can be a top-level mailbox or nested under Inbox — the pipeline searches both.

## CLI Usage

### Process emails

```bash
# Process all new emails in Elle
hughmann mail process

# Classify only — no files written, no state changes
hughmann mail process --dry-run

# Process at most 10 emails
hughmann mail process --limit 10

# Combine flags
hughmann mail process --dry-run --limit 5
```

### Check status

```bash
hughmann mail status
```

Shows last run time, total emails processed, and error count from the last run.

## Batch Workflow

Elle is a curated folder — you move emails there manually (or via Mail rules), then process in batches:

1. Move a batch of emails into the Elle folder in Apple Mail
2. Run `hughmann mail process`
3. Check output: `ls /Users/wbridges/Vault_Omnissa/Vault_Omnissa/_inbox/`
4. Move the next batch into Elle
5. Run again — only new (unprocessed) emails are picked up

The pipeline tracks every email by its RFC message ID in `~/.hughmann/daemon/mail-state.json`, so re-running is always safe.

## Email Classification

Each email is classified into one of these types:

| Type | Description |
|------|-------------|
| `support` | SEV/severity mentions, CASE numbers, escalations, troubleshooting |
| `customer` | Customer correspondence, questions, POC updates |
| `product-release` | Release notes, EOL notices, version announcements |
| `meeting` | Calendar invites, agendas, minutes, follow-ups |
| `internal` | Team updates, win wires, forecasts, org news |
| `newsletter` | Digests, curated content roundups |
| `noise` | OOO replies, read receipts, zero-content notifications |
| `other` | Anything that doesn't fit above (still processed fully) |

Emails classified as **noise** are tracked in state but no file is written.

## Output Format

Each processed email becomes a file like:

```
_inbox/2026-03-04-customer-acme-corp-poc-status.md
```

Filename pattern: `{date}-{type}-{subject-slug}.md`

### File structure

```markdown
---
type: "customer"
source: email
date: 2026-03-04
from: "John Smith <john@example.com>"
subject: "Re: Workspace ONE POC Status"
customer_hint: "Acme Corp"
case_id: null
product_hint: "Workspace ONE UEM"
---

# Re: Workspace ONE POC Status

**From:** John Smith <john@example.com>
**Date:** Tuesday, March 4, 2026

## Summary
Brief 2-3 sentence summary of the email.

## Key Points
- Important detail one
- Important detail two

## Action Items
- Follow up on X by Friday

## Contacts
- John Smith — john@example.com — IT Director

## Original Content
The cleaned email body (signatures stripped).
```

## Daemon Integration

When the daemon is running, it automatically checks for new Elle emails:

- **Frequency:** Every 30 minutes
- **Hours:** 7am–6pm only (business hours)
- **Post-processing:** After writing new `.md` files, triggers a vault sync targeting `_inbox/` so new emails are vectorized into Supabase

You don't need to run `hughmann mail process` manually if the daemon is active — but you can at any time to process a fresh batch immediately.

## State File

Located at `~/.hughmann/daemon/mail-state.json`:

```json
{
  "version": 1,
  "last_run": "2026-03-04T14:30:00.000Z",
  "processed_ids": {
    "<rfc-message-id>": {
      "date": "2026-03-04",
      "type": "customer",
      "file": "2026-03-04-customer-acme-corp-poc-status.md"
    }
  },
  "stats": {
    "total_processed": 47,
    "last_run_count": 5,
    "last_run_errors": 0
  }
}
```

To reprocess all emails, delete this file and run `hughmann mail process` again.

## Troubleshooting

### "Could not find Elle mailbox"

- Make sure Apple Mail is open and the Exchange account is connected
- Verify the Elle folder exists and has at least one message
- Check `MAIL_ACCOUNT` and `MAIL_MAILBOX` in `~/.hughmann/.env`

### "Missing OPENROUTER_API_KEY"

Add your key to `~/.hughmann/.env`:

```
OPENROUTER_API_KEY=sk-or-...
```

### "Missing VAULT_OMNISSA_PATH"

The pipeline needs to know where to write `.md` files:

```
VAULT_OMNISSA_PATH=/Users/wbridges/Vault_Omnissa/Vault_Omnissa
```

### Classification errors

If Haiku can't classify an email, it falls back to type `other` with a basic summary. The email is still processed and written — check the file for accuracy.

### Reprocessing

Delete the state file to start fresh:

```bash
rm ~/.hughmann/daemon/mail-state.json
hughmann mail process
```
