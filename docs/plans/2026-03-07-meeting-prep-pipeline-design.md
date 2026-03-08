# Meeting Prep Pipeline — Design

## Overview

A daily meeting preparation pipeline that reads tomorrow's calendar, identifies customer meetings, pulls intelligence from Supabase KB, writes prep docs to the Obsidian vault, and outputs a formatted briefing. Runs at 4pm daily on Elle's Mac via launchd.

Hugh gets a parallel capability using Google Calendar via the existing Google Workspace MCP for FBS meetings.

## Goals

- Surface tomorrow's meetings at 4pm so Wayne can prepare the evening before
- Distinguish customer meetings from internal ones automatically
- Pull customer intelligence (summary, action items, look-fors) from Supabase KB
- Write a prep doc per customer meeting to the Obsidian vault for in-meeting reference
- Link prep docs back to the customer's `_dashboard.md` in Obsidian
- Create a meeting record that can hold post-meeting notes and flow back into KB via vault sync

## Architecture

```
Apple Calendar (Exchange account, "Calendar" calendar)
  | AppleScript via runAppleScript()
  v
hughmann calendar tomorrow  (CLI — outputs JSON)
  |
  v
prep-meetings skill (Claude)
  |--- For each event:
  |      Attendees all @omnissa.com? → Internal (skip prep doc)
  |      External attendees? → Customer meeting
  |        |--- search_knowledge_base(customer name)
  |        |--- Build prep doc markdown
  |        |--- Write to <vault>/meetings/YYYY-MM-DD Meeting with Customer - Topic.md
  |
  v
Terminal briefing (time, customer, topic, agenda, prep doc links)
```

## Apple Calendar Module

New module: `src/calendar/apple-calendar.ts`

Reuses the existing `runAppleScript` helper from `src/mail/applescript.ts`.

### `getTomorrowEvents()`

Queries Calendar.app for all events on tomorrow's date from the "Calendar" calendar in the Exchange account.

Returns:
```typescript
interface CalendarEvent {
  title: string
  startTime: string       // ISO or "HH:MM"
  endTime: string
  location: string
  attendees: string[]     // email addresses
  notes: string           // invite body/agenda
  calendarName: string
  isAllDay: boolean
}
```

Filters to the Exchange "Calendar" calendar only — no personal, holidays, or other calendars.

### CLI Wrapper

`hughmann calendar tomorrow` — calls `getTomorrowEvents()`, outputs JSON array to stdout. The skill invokes this via Bash.

## Customer Matching

The skill (Claude) handles matching logic — no separate TypeScript module:

1. **Internal detection:** If all attendee emails are `@omnissa.com`, mark as "Internal"
2. **Customer name extraction:** Check event title first (most invites include the customer name), then reverse-lookup external email domains against KB
3. **KB query:** `search_knowledge_base` with customer name → recent activity, open cases, contacts, action items, look-fors
4. **No match:** Still create prep doc, note "No customer intelligence found — new account?"

## Prep Doc Format

Written to `<VAULT_OMNISSA_PATH>/meetings/` for customer meetings only:

```markdown
---
type: meeting-prep
date: 2026-03-08
customer: "Tarrant College"
source: auto-generated
---

# 2026-03-08 Meeting with Tarrant College - Horizon POC

**Time:** 9:00 AM - 10:00 AM
**Attendees:** john.smith@tarrant.edu, jane.doe@omnissa.com
**Location:** Teams
**Agenda:** Review POC progress, discuss enrollment timeline

## Customer Summary
- Active Horizon POC since January 2026
- 500 VDI seats, targeting Fall 2026 rollout
- Key contact: John Smith, Director of IT

## Look-Fors & Action Items
- Follow up on SAML integration issue (CASE-12345)
- License quote expires March 15

## Customer Dashboard
[Open in Obsidian](obsidian://open?vault=omnissa&file=tarrant-college/_dashboard)

## Meeting Notes
<!-- add your notes during/after the meeting -->
```

These files flow back into KB via Elle's existing vault sync pipeline, creating a searchable record of meeting prep and notes.

## Terminal Briefing Format

```
Tomorrow's Meetings — March 8, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9:00 AM   Tarrant College — Horizon POC
          Agenda: Review POC progress, discuss enrollment
          Prep: obsidian://open?vault=omnissa&file=meetings/2026-03-08...

11:00 AM  Internal — Team Standup
          No prep needed

2:00 PM   Lake Worth ISD — WS1 Discovery
          Agenda: Initial requirements gathering
          Prep: obsidian://open?vault=omnissa&file=meetings/2026-03-08...

3 meetings tomorrow (2 customer, 1 internal)
2 prep docs written to vault/meetings/
```

## Hugh's Google Calendar Integration

Hugh already has Google Calendar access via Google Workspace MCP. A lightweight companion skill (`prep-meetings-gcal`) can use `google_calendar_list_events` to check tomorrow's FBS meetings. Same briefing format, but no Obsidian vault writes (FBS doesn't use Obsidian). This is a simpler version — just the briefing output.

## Scheduling

4:00 PM daily via launchd on Elle's Mac:

```bash
hughmann schedule install prep-meetings
```

Schedule config addition:
```typescript
{ skillId: 'prep-meetings', hour: 16, minute: 0, description: 'Meeting prep at 4:00 PM' }
```

## Environment Requirements (Elle)

- `VAULT_OMNISSA_PATH` — path to Omnissa Obsidian vault
- Supabase connection — for KB queries
- Apple Calendar — Exchange account synced, calendar named "Calendar"
- Calendar.app accessibility permissions for osascript

## Files to Create

| Path | Purpose |
|------|---------|
| `src/calendar/apple-calendar.ts` | AppleScript calendar reader |
| `src/calendar/calendar-cli.ts` | CLI wrapper (`hughmann calendar tomorrow`) |
| `src/skills/prep-meetings/SKILL.md` | Meeting prep skill (Apple Calendar + KB) |

## Files to Modify

| Path | Change |
|------|--------|
| `src/cli.ts` | Add `calendar` subcommand |
| `src/scheduler/launchd.ts` | Add prep-meetings at 4pm |
| `src/runtime/skills.ts` | Auto-install prep-meetings skill |

## Constraints

- AppleScript calendar access requires Calendar.app to be running (or at least the calendar database to be synced)
- Exchange calendar sync must be active on Elle's Mac
- KB queries depend on Supabase connection and populated customer data
- Prep doc writes require `VAULT_OMNISSA_PATH` to be set
