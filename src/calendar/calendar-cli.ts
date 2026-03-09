/**
 * CLI handler for calendar operations.
 * Used by skills via Bash and by the daemon for calendar sync.
 */

import { getTomorrowEvents, getEventsInRange } from './apple-calendar.js'

export async function handleCalendarTomorrow(): Promise<void> {
  const events = await getTomorrowEvents()
  console.log(JSON.stringify(events, null, 2))
}

/**
 * Sync Apple Calendar events to Supabase calendar_events table.
 * Reads events via EventKit, upserts to the shared table.
 *
 * @param daysAhead Number of days to sync (default 7)
 * @param calendarName Optional calendar name filter
 * @param domain Domain to tag events with (default from CALENDAR_DOMAIN env or 'omnissa')
 * @param dryRun If true, print events but don't write to Supabase
 */
export async function handleCalendarSync(opts: {
  daysAhead?: number
  calendarName?: string
  domain?: string
  dryRun?: boolean
}): Promise<void> {
  const daysAhead = opts.daysAhead ?? 7
  const domain = opts.domain ?? process.env.CALENDAR_DOMAIN ?? 'omnissa'
  const dryRun = opts.dryRun ?? false

  console.log(`[calendar-sync] ${dryRun ? 'DRY RUN — ' : ''}Syncing calendar events`)
  console.log(`[calendar-sync] Range: today + ${daysAhead} days, domain: ${domain}`)

  // Calculate date range
  const today = new Date()
  const end = new Date(today)
  end.setDate(end.getDate() + daysAhead)
  const startStr = today.toISOString().split('T')[0]
  const endStr = end.toISOString().split('T')[0]

  // Fetch from Apple Calendar
  const events = await getEventsInRange(startStr, endStr, opts.calendarName)
  console.log(`[calendar-sync] Found ${events.length} events`)

  if (events.length === 0) {
    console.log('[calendar-sync] Nothing to sync.')
    return
  }

  if (dryRun) {
    console.log('\n--- Events that would be synced ---')
    for (const e of events) {
      console.log(`  ${e.startTime.slice(0, 16)} | ${e.title} | ${e.calendarName}`)
    }
    console.log(`\nTotal: ${events.length} events`)
    return
  }

  // Lazy import boot to get DataAdapter
  const { boot } = await import('../runtime/boot.js')
  const result = await boot()
  if (!result.runtime) {
    console.error('[calendar-sync] Boot failed:', result.errors.join(', '))
    return
  }
  const data = result.runtime.data
  if (!data) {
    console.error('[calendar-sync] No data adapter available')
    return
  }

  let upserted = 0
  let errors = 0

  for (const event of events) {
    try {
      // Create stable external_id from title + start + calendar
      const key = `${event.calendarName}::${event.title}::${event.startTime}`
      let hash = 0
      for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
      }
      const externalId = `eventkit-${Math.abs(hash).toString(36)}`

      await data.upsertCalendarEvent({
        title: event.title,
        start_time: event.startTime,
        end_time: event.endTime,
        location: event.location || undefined,
        attendees: event.attendees,
        calendar_name: event.calendarName,
        domain,
        source: 'elle',
        external_id: externalId,
        notes: event.notes || undefined,
      })
      upserted++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e)
      console.error(`[calendar-sync] Error upserting "${event.title}": ${msg}`)
      errors++
    }
  }

  console.log(`[calendar-sync] Done: ${upserted} upserted, ${errors} errors`)
}
