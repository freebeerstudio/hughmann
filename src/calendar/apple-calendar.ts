/**
 * apple-calendar.ts — Read events from Apple Calendar via icalBuddy.
 *
 * Uses icalBuddy CLI to query Calendar.app events efficiently.
 * Previous approaches (AppleScript, JXA) failed or were too slow —
 * AppleScript can't handle Calendar.app's `event` keyword conflict,
 * and JXA's `whose` filter hangs on calendars with large event history.
 *
 * icalBuddy reads from the calendar store directly and is fast.
 * Install: `brew install ical-buddy`
 *
 * Returns structured event data for the prep-meetings skill.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
 * Build icalBuddy args to query tomorrow's events.
 * Configurable via env var:
 *   CALENDAR_NAME — calendar name filter (default: "Calendar")
 */
export function buildIcalBuddyArgs(): string[] {
  const calName = process.env.CALENDAR_NAME ?? 'Calendar'

  return [
    // Formatting
    '-nc',          // no calendar names in section headers
    '-nrd',         // no relative date descriptions
    '-b', '',       // no bullet prefix
    '-iep', 'title,datetime,location,attendees,notes',  // include these properties
    '-po', 'title,datetime,location,attendees,notes',   // property order
    '-ps', '| |',   // property separator (pipe with spaces)
    '-df', '%Y-%m-%d',  // date format
    '-tf', '%I:%M %p',  // time format (12-hour with AM/PM)
    '-ic', calName,     // include only this calendar
    '-ea',              // exclude all-day events
    'eventsFrom:tomorrow', 'to:tomorrow',
  ]
}

/**
 * Parse icalBuddy output into structured events.
 * Each event is a single line with pipe-separated fields:
 *   title | datetime | location | attendees | notes
 */
export function parseCalendarOutput(raw: string): CalendarEvent[] {
  if (!raw.trim()) return []

  const calName = process.env.CALENDAR_NAME ?? 'Calendar'
  const events: CalendarEvent[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue

    const parts = line.split(' | ')
    if (parts.length < 2) continue

    const title = (parts[0] ?? '').trim()
    const datetime = (parts[1] ?? '').trim()
    const location = (parts[2] ?? '').trim()
    const attendeeStr = (parts[3] ?? '').trim()
    const notes = parts.slice(4).join(' | ').trim() // notes might contain pipes

    // Parse datetime: "2026-03-08 at 09:00 AM - 10:00 AM" or "2026-03-08 at 09:00 AM - 2026-03-08 at 10:00 AM"
    let startTime = ''
    let endTime = ''
    const timeMatch = datetime.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(?:\d{4}-\d{2}-\d{2}\s+at\s+)?(\d{1,2}:\d{2}\s*[AP]M)/)
    if (timeMatch) {
      startTime = timeMatch[1]
      endTime = timeMatch[2]
    }

    const attendees = attendeeStr
      ? attendeeStr.split(',').map(a => a.trim()).filter(Boolean)
      : []

    events.push({
      title,
      startTime,
      endTime,
      location,
      attendees,
      notes,
      calendarName: calName,
      isAllDay: false, // -ea flag already excludes all-day events
    })
  }

  return events
}

/**
 * Fetch tomorrow's events from Apple Calendar via icalBuddy.
 * Requires icalBuddy to be installed: `brew install ical-buddy`
 */
export async function getTomorrowEvents(): Promise<CalendarEvent[]> {
  const args = buildIcalBuddyArgs()
  try {
    const { stdout } = await execFileAsync('icalBuddy', args, {
      timeout: 15_000,
    })
    return parseCalendarOutput(stdout.trim())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT')) {
      throw new Error('icalBuddy not found. Install with: brew install ical-buddy')
    }
    if (msg.includes('No calendars')) {
      return [] // No matching calendar — return empty
    }
    throw err
  }
}
