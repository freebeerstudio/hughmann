/**
 * CLI handler for calendar operations.
 * Used by skills via Bash to read calendar events.
 */

import { getTomorrowEvents } from './apple-calendar.js'

export async function handleCalendarTomorrow(): Promise<void> {
  const events = await getTomorrowEvents()
  console.log(JSON.stringify(events, null, 2))
}
