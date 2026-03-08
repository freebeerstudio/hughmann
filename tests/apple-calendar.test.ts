import { describe, it, expect } from 'vitest'
import { parseCalendarOutput, buildIcalBuddyArgs } from '../src/calendar/apple-calendar.js'

describe('apple-calendar', () => {
  describe('parseCalendarOutput', () => {
    it('parses icalBuddy pipe-separated output into structured events', () => {
      const raw = [
        'Team Standup | 2026-03-08 at 09:00 AM - 10:00 AM | Conference Room | john@omnissa.com, jane@omnissa.com | Weekly sync',
        'Tarrant College - Horizon POC | 2026-03-08 at 02:00 PM - 03:00 PM | Teams | john@tarrant.edu, wayne@omnissa.com | Review POC progress',
      ].join('\n')

      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(2)
      expect(events[0].title).toBe('Team Standup')
      expect(events[0].startTime).toBe('09:00 AM')
      expect(events[0].endTime).toBe('10:00 AM')
      expect(events[0].location).toBe('Conference Room')
      expect(events[0].attendees).toEqual(['john@omnissa.com', 'jane@omnissa.com'])
      expect(events[0].notes).toBe('Weekly sync')
      expect(events[1].title).toBe('Tarrant College - Horizon POC')
    })

    it('handles empty output', () => {
      expect(parseCalendarOutput('')).toEqual([])
    })

    it('handles events with missing fields', () => {
      const raw = 'Quick Chat | 2026-03-08 at 01:00 PM - 02:00 PM'
      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(1)
      expect(events[0].title).toBe('Quick Chat')
      expect(events[0].startTime).toBe('01:00 PM')
      expect(events[0].location).toBe('')
      expect(events[0].attendees).toEqual([])
    })

    it('handles notes containing pipe characters', () => {
      const raw = 'Meeting | 2026-03-08 at 10:00 AM - 11:00 AM | Room A | bob@test.com | Agenda: item 1 | item 2 | item 3'
      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(1)
      expect(events[0].notes).toBe('Agenda: item 1 | item 2 | item 3')
    })

    it('handles cross-day datetime format', () => {
      const raw = 'Long Meeting | 2026-03-08 at 11:00 PM - 2026-03-09 at 01:00 AM | Zoom | |'
      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(1)
      expect(events[0].startTime).toBe('11:00 PM')
      expect(events[0].endTime).toBe('01:00 AM')
    })
  })

  describe('buildIcalBuddyArgs', () => {
    it('generates args targeting the configured calendar', () => {
      const args = buildIcalBuddyArgs()
      expect(args).toContain('-ic')
      const calIdx = args.indexOf('-ic')
      expect(args[calIdx + 1]).toBe('Calendar')
      expect(args).toContain('eventsFrom:tomorrow')
      expect(args).toContain('-ea') // exclude all-day
    })
  })
})
