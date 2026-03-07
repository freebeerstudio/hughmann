---
name: bulk-classify-email
description: Process the Gmail inbox backlog by classifying and labeling all unprocessed emails. Use after running discover-email-categories to apply the finalized category list to existing emails.
---

# Bulk Classify Email

Process the Gmail inbox backlog using the finalized category list. Classifies each email, applies a Gmail label, and stores a summary.

## Prerequisites

- Category config must exist at `~/.hughmann/email/categories.json` (run discover-email-categories first)
- Google Workspace MCP must be loaded
- OPENROUTER_API_KEY must be set

## Process

### 1. Load Categories

Read `~/.hughmann/email/categories.json` to get the category list. If it doesn't exist, stop and tell the user to run discover-email-categories first.

### 2. Fetch Unprocessed Emails

Search for emails that don't have any Hugh labels yet. Build a query that excludes all known category labels:

```
gmail_search_emails query: "in:inbox -label:hugh-billing -label:hugh-newsletter ..." maxResults: 50
```

Use the prefix `hugh-` for all labels to avoid conflicts with existing Gmail labels.

### 3. Process Each Email

For each email in the batch:

**a) Get full email content:**
```
gmail_get_email id: "<message_id>"
```

**b) Classify via CLI:**
```bash
echo '{"sender":"<from>","subject":"<subject>","date":"<date>","body":"<body>"}' | hughmann gmail classify
```

**c) Apply Gmail label:**
```
gmail_modify_labels id: "<message_id>" addLabelNames: ["hugh-<category>"]
```

Create the label first if it doesn't exist.

**d) Log progress:**
Report every 10 emails: "Processed 10/50 — 4 billing, 3 newsletter, 2 personal, 1 unwanted"

### 4. Rate Limiting

Process 1-2 emails per second. After each email, wait briefly to stay within Gmail and OpenRouter rate limits.

### 5. Batch Continuation

After processing a batch of 50, check if there are more unprocessed emails. If so, fetch the next batch and continue. Keep processing until all emails are labeled.

### 6. Summary Report

When done, show a summary:

```
Bulk Classification Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total processed: 2,147
Categories:
  billing:           234 (10.9%)
  newsletter:        456 (21.2%)
  personal:          189 (8.8%)
  saas-notification: 312 (14.5%)
  unwanted:          567 (26.4%)
  unclassified:       89 (4.1%)
  ...
Errors: 3
```

### 7. Error Handling

- If classification fails for an email, log the error and skip it (don't apply a label). It will be picked up on the next run.
- If Gmail label application fails, log and continue.
- Track the last successfully processed message ID so the skill can resume if interrupted.
