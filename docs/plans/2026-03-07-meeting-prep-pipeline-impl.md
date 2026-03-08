# Meeting Prep Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a daily 4pm skill that reads tomorrow's Apple Calendar events, matches customer meetings against Supabase KB, writes prep docs to Obsidian, and outputs a formatted briefing.

**Architecture:** AppleScript reads Calendar.app events via a CLI wrapper (`hughmann calendar tomorrow`). A skill prompt orchestrates the pipeline — Claude calls the CLI, identifies customer vs internal meetings, queries KB, writes prep docs, and outputs the briefing. Scheduled via launchd at 4pm daily.

**Tech Stack:** TypeScript/ESM, AppleScript (Calendar.app), Supabase KB, Obsidian vault, launchd

---

### Task 1: Apple Calendar Module

**Files:**
- Create: `src/calendar/apple-calendar.ts`
- Create: `tests/apple-calendar.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/apple-calendar.test.ts
import { describe, it, expect } from 'vitest'
import { parseCalendarOutput, buildTomorrowQuery, type CalendarEvent } from '../src/calendar/apple-calendar.js'

describe('apple-calendar', () => {
  describe('parseCalendarOutput', () => {
    it('parses delimited event output into structured events', () => {
      const raw = [
        '9:00 AM|||10:00 AM|||Team Standup|||Conference Room|||false|||john@omnissa.com, jane@omnissa.com|||Weekly sync',
        '2:00 PM|||3:00 PM|||Tarrant College - Horizon POC|||Teams|||false|||john@tarrant.edu, wayne@omnissa.com|||Review POC progress',
      ].join('\n')

      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(2)
      expect(events[0].title).toBe('Team Standup')
      expect(events[0].startTime).toBe('9:00 AM')
      expect(events[0].attendees).toEqual(['john@omnissa.com', 'jane@omnissa.com'])
      expect(events[1].title).toBe('Tarrant College - Horizon POC')
      expect(events[1].notes).toBe('Review POC progress')
    })

    it('handles empty output', () => {
      expect(parseCalendarOutput('')).toEqual([])
    })

    it('handles events with missing fields', () => {
      const raw = '1:00 PM|||2:00 PM|||Quick Chat||||||false||||||'
      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(1)
      expect(events[0].title).toBe('Quick Chat')
      expect(events[0].location).toBe('')
      expect(events[0].attendees).toEqual([])
    })

    it('skips all-day events', () => {
      const raw = [
        '|||||||Company Holiday||||||true||||||',
        '9:00 AM|||10:00 AM|||Standup|||Room A|||false|||team@omnissa.com|||',
      ].join('\n')
      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(1)
      expect(events[0].title).toBe('Standup')
    })
  })

  describe('buildTomorrowQuery', () => {
    it('generates AppleScript targeting Calendar in Exchange', () => {
      const script = buildTomorrowQuery()
      expect(script).toContain('Calendar')
      expect(script).toContain('Exchange')
      expect(script).toContain('start date')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/apple-calendar.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/calendar/apple-calendar.ts
/**
 * apple-calendar.ts — Read events from Apple Calendar via AppleScript.
 *
 * Queries Calendar.app for tomorrow's events from the Exchange "Calendar"
 * calendar. Returns structured event data for the prep-meetings skill.
 */

import { runAppleScript } from '../mail/applescript.js'

const FIELD_DELIMITER = '|||'

export interface CalendarEvent {
  title: string
  startTime: string
  endTime: string
  location: string
  attendees: string[]
  notes: string
  calendarName: string
  isAllDay: boolean
}

/**
 * Build the AppleScript to query tomorrow's events from the Exchange calendar.
 * Configurable via env vars:
 *   CALENDAR_ACCOUNT — account name (default: "Exchange")
 *   CALENDAR_NAME — calendar name (default: "Calendar")
 */
export function buildTomorrowQuery(): string {
  const account = process.env.CALENDAR_ACCOUNT ?? 'Exchange'
  const calName = process.env.CALENDAR_NAME ?? 'Calendar'

  return `
tell application "Calendar"
  set tomorrow to (current date) + 1 * days
  set tStart to tomorrow
  set time of tStart to 0
  set tEnd to tStart + 1 * days

  set cal to calendar "${calName}" of account "${account}"
  set evts to (every event of cal whose start date >= tStart and start date < tEnd)

  set outputLines to {}
  repeat with e in evts
    set eTitle to summary of e
    set eStart to start date of e
    set eEnd to end date of e
    set eLoc to ""
    try
      set eLoc to location of e
    end try
    set eAllDay to allday event of e
    set eNotes to ""
    try
      set eNotes to description of e
    end try

    -- Format times
    set startStr to ""
    set endStr to ""
    if not eAllDay then
      set startStr to time string of eStart
      set endStr to time string of eEnd
    end if

    -- Get attendees
    set attendeeList to ""
    try
      set atts to attendees of e
      repeat with a in atts
        set attendeeList to attendeeList & (email of a) & ", "
      end repeat
      if (count of attendeeList) > 2 then
        set attendeeList to text 1 thru -3 of attendeeList
      end if
    end try

    set allDayStr to "false"
    if eAllDay then set allDayStr to "true"

    set end of outputLines to startStr & "${FIELD_DELIMITER}" & endStr & "${FIELD_DELIMITER}" & eTitle & "${FIELD_DELIMITER}" & eLoc & "${FIELD_DELIMITER}" & allDayStr & "${FIELD_DELIMITER}" & attendeeList & "${FIELD_DELIMITER}" & eNotes
  end repeat

  set AppleScript's text item delimiters to linefeed
  return outputLines as text
end tell`
}

/**
 * Parse the delimited output from the AppleScript into structured events.
 * Skips all-day events (holidays, OOO, etc.)
 */
export function parseCalendarOutput(raw: string): CalendarEvent[] {
  if (!raw.trim()) return []

  const events: CalendarEvent[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split(FIELD_DELIMITER)
    if (parts.length < 7) continue

    const isAllDay = (parts[4] ?? '').trim() === 'true'
    if (isAllDay) continue

    const attendeeStr = (parts[5] ?? '').trim()
    const attendees = attendeeStr
      ? attendeeStr.split(',').map(a => a.trim()).filter(Boolean)
      : []

    events.push({
      startTime: (parts[0] ?? '').trim(),
      endTime: (parts[1] ?? '').trim(),
      title: (parts[2] ?? '').trim(),
      location: (parts[3] ?? '').trim(),
      isAllDay,
      attendees,
      notes: (parts[6] ?? '').trim(),
      calendarName: process.env.CALENDAR_NAME ?? 'Calendar',
    })
  }

  return events
}

/**
 * Fetch tomorrow's events from Apple Calendar.
 * Requires Calendar.app and Exchange account to be configured.
 */
export async function getTomorrowEvents(): Promise<CalendarEvent[]> {
  const script = buildTomorrowQuery()
  const raw = await runAppleScript(script, { timeout: 30_000 })
  return parseCalendarOutput(raw)
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/apple-calendar.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/calendar/apple-calendar.ts tests/apple-calendar.test.ts
git commit -m "feat: add Apple Calendar module with AppleScript reader"
```

---

### Task 2: Calendar CLI Wrapper

**Files:**
- Create: `src/calendar/calendar-cli.ts`
- Modify: `src/cli.ts`

**Step 1: Create the CLI handler**

```typescript
// src/calendar/calendar-cli.ts
/**
 * CLI handler for calendar operations.
 * Used by skills via Bash to read calendar events.
 */

import { getTomorrowEvents } from './apple-calendar.js'

export async function handleCalendarTomorrow(): Promise<void> {
  const events = await getTomorrowEvents()
  console.log(JSON.stringify(events, null, 2))
}
```

**Step 2: Add `calendar` case to `src/cli.ts`**

Find the switch statement with cases like `case 'gmail':`. Add a new case right next to it:

```typescript
case 'calendar': {
  const sub = flags.args[0]
  if (sub === 'tomorrow') {
    const { handleCalendarTomorrow } = await import('./calendar/calendar-cli.js')
    await handleCalendarTomorrow()
  } else {
    console.log('Usage: hughmann calendar [tomorrow]')
    console.log('  tomorrow  Show tomorrow\'s calendar events as JSON')
  }
  break
}
```

Also add to the help text section, near the `gmail` line:

```typescript
console.log(`    ${pc.cyan('calendar')}          Apple Calendar events ${pc.dim('(tomorrow)')}`)
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/calendar/calendar-cli.ts src/cli.ts
git commit -m "feat: add hughmann calendar CLI for skill-driven calendar access"
```

---

### Task 3: Prep Meetings Skill

**Files:**
- Create: `src/skills/prep-meetings/SKILL.md`

**Step 1: Write the skill**

```markdown
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
```

**Step 2: Verify skill loads**

Run: `npm run build && hughmann skills`
Expected: `prep-meetings` appears in the list

**Step 3: Commit**

```bash
git add src/skills/prep-meetings/SKILL.md
git commit -m "feat: add prep-meetings skill for daily meeting preparation"
```

---

### Task 4: Scheduler & Auto-Install Integration

**Files:**
- Modify: `src/scheduler/launchd.ts`
- Modify: `src/runtime/skills.ts`

**Step 1: Add prep-meetings to scheduler defaults**

In `src/scheduler/launchd.ts`, find `getDefaultSchedules()`. Add to both the config-based array and the fallback array:

```typescript
{ skillId: 'prep-meetings', hour: 16, minute: 0, description: 'Meeting prep at 4:00 PM' },
```

**Step 2: Add prep-meetings to auto-install**

In `src/runtime/skills.ts`, find the `installBundledSkill` calls. Add:

```typescript
this.installBundledSkill('prep-meetings')
```

**Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/scheduler/launchd.ts src/runtime/skills.ts
git commit -m "feat: add prep-meetings to scheduler defaults and skill auto-install"
```

---

### Task 5: Full Verification & Push

**Step 1: Build and verify**

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

All must pass.

**Step 2: Verify skill is visible**

```bash
hughmann skills
```

Should list `prep-meetings`.

**Step 3: Verify CLI subcommand**

```bash
hughmann calendar tomorrow
```

On Hugh's Mac this will fail (no Exchange calendar) — that's expected. The important thing is the command is recognized and doesn't crash with a module error.

**Step 4: Push to GitHub**

```bash
git push
```

---

### Task 6: Elle Setup Instructions

This task is documentation only — instructions for the user to run on Elle's Mac.

After pushing, provide these steps:

**On Elle's Mac:**

```bash
# 1. Pull latest code
cd ~/HughMann   # (or wherever the repo is cloned)
git pull

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Re-link if needed
npm link

# 5. Set required env vars (add to ~/.zshrc or ~/.hughmann/.env)
export VAULT_OMNISSA_PATH="/path/to/omnissa/vault"
export CALENDAR_ACCOUNT="Exchange"    # default, change if your account has a different name
export CALENDAR_NAME="Calendar"       # default, change if needed

# 6. Test calendar access
hughmann calendar tomorrow
# Should output JSON array of tomorrow's events

# 7. Install the schedule
hughmann schedule install prep-meetings
# Installs launchd job for 4pm daily

# 8. Verify schedule
hughmann schedule list
# Should show prep-meetings at 16:00

# 9. Grant Calendar access
# If macOS prompts for Calendar access when running, click Allow.
# If it doesn't prompt, you may need to add Terminal/iTerm to
# System Settings > Privacy & Security > Calendars
```

**Test it manually first:**
```bash
hughmann run prep-meetings
```

This runs the full pipeline — reads tomorrow's calendar, queries KB, writes prep docs, outputs the briefing. Verify it works before relying on the 4pm schedule.

---

## File Summary

| Path | Action | Purpose |
|------|--------|---------|
| `src/calendar/apple-calendar.ts` | Create | AppleScript calendar reader |
| `src/calendar/calendar-cli.ts` | Create | CLI wrapper for calendar commands |
| `src/skills/prep-meetings/SKILL.md` | Create | Meeting prep skill |
| `src/cli.ts` | Modify | Add `calendar` subcommand |
| `src/scheduler/launchd.ts` | Modify | Add prep-meetings at 4pm |
| `src/runtime/skills.ts` | Modify | Auto-install prep-meetings |
| `tests/apple-calendar.test.ts` | Create | Calendar parser tests |
