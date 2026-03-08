/**
 * apple-calendar.ts — Read events from Apple Calendar via JXA.
 *
 * Queries Calendar.app for tomorrow's events from the Exchange "Calendar"
 * calendar using JavaScript for Automation (JXA). AppleScript cannot be used
 * with Calendar.app on modern macOS because `event` is both a class name and
 * a reserved keyword. JXA has no such conflict.
 *
 * Returns structured event data for the prep-meetings skill.
 */

import { runAppleScript } from '../mail/applescript.js'

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
 * Build a JXA script to query tomorrow's events from the Exchange calendar.
 * Configurable via env vars:
 *   CALENDAR_ACCOUNT — account name (default: "Exchange")
 *   CALENDAR_NAME — calendar name (default: "Calendar")
 */
export function buildTomorrowQuery(): string {
  const account = process.env.CALENDAR_ACCOUNT ?? 'Exchange'
  const calName = process.env.CALENDAR_NAME ?? 'Calendar'

  return `
var app = Application("Calendar");

var targetAcct = ${JSON.stringify(account)};
var targetCal = ${JSON.stringify(calName)};

// Calculate tomorrow's date range
var now = new Date();
var tStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
var tEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);

// Find the target calendar
var cal = null;
var calendars = app.calendars();
for (var i = 0; i < calendars.length; i++) {
  var c = calendars[i];
  try {
    if (c.name() === targetCal) {
      cal = c;
      break;
    }
  } catch (e) {}
}

if (!cal) {
  JSON.stringify([]);
} else {
  var evts = cal.events.whose({
    _and: [
      { startDate: { _greaterThanEquals: tStart } },
      { startDate: { _lessThan: tEnd } }
    ]
  })();

  var results = [];
  for (var i = 0; i < evts.length; i++) {
    var e = evts[i];
    var title = "";
    try { title = e.summary(); } catch (err) {}
    var startDate = null;
    try { startDate = e.startDate(); } catch (err) {}
    var endDate = null;
    try { endDate = e.endDate(); } catch (err) {}
    var location = "";
    try { location = e.location() || ""; } catch (err) {}
    var isAllDay = false;
    try { isAllDay = e.alldayEvent(); } catch (err) {}
    var notes = "";
    try { notes = e.description() || ""; } catch (err) {}

    var attendeeEmails = [];
    try {
      var atts = e.attendees();
      for (var j = 0; j < atts.length; j++) {
        try {
          var email = atts[j].email();
          if (email) attendeeEmails.push(email);
        } catch (err) {}
      }
    } catch (err) {}

    var startTime = "";
    var endTime = "";
    if (!isAllDay && startDate) {
      startTime = startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    if (!isAllDay && endDate) {
      endTime = endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }

    results.push({
      title: title,
      startTime: startTime,
      endTime: endTime,
      location: location,
      attendees: attendeeEmails,
      notes: notes,
      calendarName: targetCal,
      isAllDay: isAllDay
    });
  }

  JSON.stringify(results);
}
`
}

/**
 * Parse JSON output from the JXA script into structured events.
 * Skips all-day events (holidays, OOO, etc.)
 */
export function parseCalendarOutput(raw: string): CalendarEvent[] {
  if (!raw.trim()) return []

  try {
    const parsed = JSON.parse(raw) as Array<{
      title?: string
      startTime?: string
      endTime?: string
      location?: string
      attendees?: string[]
      notes?: string
      calendarName?: string
      isAllDay?: boolean
    }>

    return parsed
      .filter(e => !e.isAllDay)
      .map(e => ({
        title: e.title ?? '',
        startTime: e.startTime ?? '',
        endTime: e.endTime ?? '',
        location: e.location ?? '',
        attendees: e.attendees ?? [],
        notes: e.notes ?? '',
        calendarName: e.calendarName ?? (process.env.CALENDAR_NAME ?? 'Calendar'),
        isAllDay: e.isAllDay ?? false,
      }))
  } catch {
    // Fallback: if not valid JSON, return empty
    return []
  }
}

/**
 * Fetch tomorrow's events from Apple Calendar.
 * Requires Calendar.app and Exchange account to be configured.
 */
export async function getTomorrowEvents(): Promise<CalendarEvent[]> {
  const script = buildTomorrowQuery()
  const raw = await runAppleScript(script, { timeout: 30_000, language: 'JavaScript' })
  return parseCalendarOutput(raw)
}
