---
name: prep-meetings
description: Prepare for tomorrow's meetings by reading the calendar, pulling customer intelligence from KB, and writing prep docs to Obsidian. Runs daily at 4pm. Use when you want to see what meetings are coming up tomorrow and prepare for customer meetings.
domain: omnissa
---

# Prep Meetings

Read tomorrow's calendar, identify customer meetings, pull intelligence from KB, write prep docs to Obsidian, and output a formatted briefing.

## Process

### 1. Get Tomorrow's Events

Run via Bash to get calendar events:

```bash
hughmann calendar tomorrow
```

This returns a JSON array of events with `title`, `startTime`, `endTime`, `location`, `attendees`, `notes`, `isAllDay`.

If the array is empty, report "No meetings tomorrow" and exit.

### 2. Classify Each Event

For each event, determine if it's a customer meeting or internal:

- **Internal:** All attendees have `@omnissa.com` email addresses, OR the title contains common internal keywords (standup, 1:1, team sync, all-hands, forecast, pipeline)
- **Customer:** Any attendee has a non-`@omnissa.com` email address

### 3. For Customer Meetings — Pull KB Context

For each customer meeting:

**a) Extract customer name** from the event title. Most calendar invites include the customer name (e.g., "Tarrant College - Horizon POC"). If unclear, use the external attendee's email domain to search.

**b) Search KB:**
Use the `search_knowledge_base` tool with the customer name. Look for:
- Account overview and key contacts
- Recent activity and open support cases
- Action items and look-fors
- Product interests and POC status

**c) Find Obsidian dashboard:**
The customer dashboard convention is `<customer-slug>/_dashboard.md` in the Omnissa vault. Build the Obsidian URI:
```
obsidian://open?vault=omnissa&file=<customer-slug>/_dashboard
```

### 4. Write Prep Docs

For each customer meeting, write a prep doc to the Obsidian vault. Use `VAULT_OMNISSA_PATH` env var for the vault path.

**File path:** `<VAULT_OMNISSA_PATH>/meetings/YYYY-MM-DD Meeting with <Customer> - <Topic>.md`

**Template:**

```markdown
---
type: meeting-prep
date: YYYY-MM-DD
customer: "<Customer Name>"
source: auto-generated
---

# YYYY-MM-DD Meeting with <Customer> - <Topic>

**Time:** <start> - <end>
**Attendees:** <attendee list>
**Location:** <location>
**Agenda:** <notes from invite>

## Customer Summary
<KB summary — key points about the account>

## Look-Fors & Action Items
<Action items and things to watch for from KB>

## Customer Dashboard
[Open in Obsidian](<obsidian URI>)

## Meeting Notes
<!-- add your notes during/after the meeting -->
```

Write the file using the Write tool or via Bash. Create the `meetings/` directory if it doesn't exist.

### 5. Output Briefing

Format the final briefing:

```
Tomorrow's Meetings — <Date>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<time>   <Customer> — <Topic>
         Agenda: <agenda summary>
         Prep: obsidian://open?vault=omnissa&file=meetings/<filename>

<time>   Internal — <Title>
         No prep needed

<count> meetings tomorrow (<customer count> customer, <internal count> internal)
<docs count> prep docs written to vault/meetings/
```

### 6. Quiet Mode

When run with `-q` (scheduled mode), only output the briefing summary — no verbose logging.

## Scheduling

Runs daily at 4:00 PM CST via launchd:

```bash
hughmann schedule install prep-meetings
```
