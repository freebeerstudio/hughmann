/**
 * apple-calendar.ts — Read events from Apple Calendar via EventKit.
 *
 * Runs a Swift script that uses EventKit (Apple's official calendar API)
 * to query tomorrow's events. Previous approaches failed:
 *   - AppleScript: `event` keyword conflict with Calendar.app
 *   - JXA: `whose` filter hangs on large event histories
 *   - icalBuddy: too old for modern macOS permissions
 *
 * The Swift script handles permission prompts, outputs JSON, and is fast.
 *
 * Returns structured event data for the prep-meetings skill.
 */

import { execFile } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))

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
 * Get the path to the compiled Swift calendar helper binary.
 * Built during `npm run build` via swiftc.
 */
function getCalendarBinaryPath(): string {
  return join(__dirname, 'calendar-events')
}

/**
 * Parse JSON output from the Swift script into structured events.
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
    return []
  }
}

/**
 * Fetch tomorrow's events from Apple Calendar via EventKit.
 * On first run, macOS will prompt for Calendar access — click Allow.
 */
export async function getTomorrowEvents(): Promise<CalendarEvent[]> {
  const calName = process.env.CALENDAR_NAME ?? 'Calendar'
  const binaryPath = getCalendarBinaryPath()

  try {
    const { stdout } = await execFileAsync(binaryPath, [calName], {
      timeout: 15_000,
    })
    return parseCalendarOutput(stdout.trim())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Calendar access denied')) {
      throw new Error('Calendar access denied. Grant access in System Settings > Privacy & Security > Calendars.')
    }
    throw err
  }
}
