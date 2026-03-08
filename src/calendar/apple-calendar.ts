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
