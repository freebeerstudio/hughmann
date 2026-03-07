---
name: discover-email-categories
description: Sample Gmail inbox to discover email categories for classification. Use when setting up the email processing pipeline for the first time, or when you want to re-discover what types of emails are in the inbox.
---

# Discover Email Categories

Sample the Gmail inbox to discover what categories of email actually exist, rather than guessing. This is a one-time setup step before bulk classification.

## Process

### 1. Sample Emails

Use the Google Workspace MCP to fetch a representative spread of recent emails:

```
gmail_search_emails query: "in:inbox" maxResults: 50
```

Then fetch another batch of older/read emails for coverage:

```
gmail_search_emails query: "in:inbox is:read" maxResults: 50
```

### 2. Classify Each Email

For each email, use the CLI classifier in discovery mode. Run via Bash:

```bash
echo '{"sender":"<from>","subject":"<subject>","date":"<date>","snippet":"<snippet>"}' | hughmann gmail discover
```

This returns JSON with `proposed_category`, `reasoning`, and `summary`.

Process emails one at a time. Pause briefly between calls to respect rate limits.

### 3. Aggregate Results

After classifying all samples, aggregate:
- Count emails per proposed category
- Merge near-duplicates (e.g., "billing-notice" and "invoice" → "billing")
- Note the top 3-5 example subjects per category

### 4. Present Summary Table

Show the user a table:

```
Category              Count   Example Subject
billing                 12    "Your March invoice from Vercel"
ai-newsletter            8    "The Batch: New reasoning models..."
personal                 7    "Re: Dinner Saturday?"
saas-notification        6    "Your Figma trial expires in 3 days"
...
```

### 5. Refine with User

Ask the user to:
- Merge categories that are too similar
- Rename any that don't feel right
- Split any that are too broad
- Drop any they don't care about

Remind them that `unwanted` and `unclassified` are always present (built-in).

### 6. Save Config

Once the user approves the final list, write the config file to `~/.hughmann/email/categories.json`:

```json
{
  "categories": [
    { "name": "billing", "description": "Invoices, payment confirmations, subscription charges" },
    { "name": "newsletter", "description": "AI/tech newsletters and digests" },
    { "name": "unwanted", "description": "Junk, spam, marketing noise that passed Gmail filters" },
    { "name": "unclassified", "description": "Model not confident, needs manual review" }
  ]
}
```

Confirm the file was written successfully.
