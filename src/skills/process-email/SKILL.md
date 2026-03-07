---
name: process-email
description: Classify and label new Gmail emails that haven't been processed yet. Runs as a scheduled skill 3x daily (7am, noon, 6pm) to keep the inbox organized. Can also be run manually.
---

# Process Email

Find and classify new unprocessed Gmail emails. This is the incremental processor that runs after the initial bulk classification is complete.

## Prerequisites

- Category config at `~/.hughmann/email/categories.json`
- Google Workspace MCP loaded
- OPENROUTER_API_KEY set

## Process

### 1. Find Unprocessed Emails

Search for inbox emails without any hugh- labels:

```
gmail_search_emails query: "in:inbox -label:hugh-billing -label:hugh-newsletter -label:hugh-personal -label:hugh-unwanted -label:hugh-unclassified ..." maxResults: 25
```

Build the exclusion query from all categories in `~/.hughmann/email/categories.json`.

If no results, report "No new emails to process" and exit.

### 2. Classify and Label

For each unprocessed email:

**a) Get email content:**
```
gmail_get_email id: "<message_id>"
```

**b) Classify:**
```bash
echo '{"sender":"<from>","subject":"<subject>","date":"<date>","snippet":"<snippet>"}' | hughmann gmail classify
```

**c) Apply label:**
```
gmail_modify_labels id: "<message_id>" addLabelNames: ["hugh-<category>"]
```

### 3. Report

Show a brief summary:

```
Processed 7 new emails:
  2 billing, 1 newsletter, 3 personal, 1 unwanted
```

### 4. Quiet Mode

When run with `-q` flag (scheduled/daemon mode), minimize output. Only report errors and the final count.

## Idempotency

Gmail labels are the cursor. If an email has a `hugh-*` label, it's been processed. No state file needed. Safe to run multiple times — already-labeled emails are naturally excluded by the search query.

## Scheduling

This skill is designed to run 3x daily via launchd:
- 7:00 AM CST
- 12:00 PM CST
- 6:00 PM CST

Install with: `hughmann schedule install process-email`
