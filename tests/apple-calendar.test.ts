import { describe, it, expect } from 'vitest'
import { parseCalendarOutput, buildTomorrowQuery } from '../src/calendar/apple-calendar.js'

describe('apple-calendar', () => {
  describe('parseCalendarOutput', () => {
    it('parses JSON event output into structured events', () => {
      const raw = JSON.stringify([
        {
          title: 'Team Standup',
          startTime: '9:00 AM',
          endTime: '10:00 AM',
          location: 'Conference Room',
          attendees: ['john@omnissa.com', 'jane@omnissa.com'],
          notes: 'Weekly sync',
          calendarName: 'Calendar',
          isAllDay: false,
        },
        {
          title: 'Tarrant College - Horizon POC',
          startTime: '2:00 PM',
          endTime: '3:00 PM',
          location: 'Teams',
          attendees: ['john@tarrant.edu', 'wayne@omnissa.com'],
          notes: 'Review POC progress',
          calendarName: 'Calendar',
          isAllDay: false,
        },
      ])

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
      const raw = JSON.stringify([
        { title: 'Quick Chat', startTime: '1:00 PM', endTime: '2:00 PM', isAllDay: false },
      ])
      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(1)
      expect(events[0].title).toBe('Quick Chat')
      expect(events[0].location).toBe('')
      expect(events[0].attendees).toEqual([])
    })

    it('skips all-day events', () => {
      const raw = JSON.stringify([
        { title: 'Company Holiday', isAllDay: true },
        {
          title: 'Standup',
          startTime: '9:00 AM',
          endTime: '10:00 AM',
          location: 'Room A',
          attendees: ['team@omnissa.com'],
          isAllDay: false,
        },
      ])
      const events = parseCalendarOutput(raw)
      expect(events).toHaveLength(1)
      expect(events[0].title).toBe('Standup')
    })

    it('handles invalid JSON gracefully', () => {
      expect(parseCalendarOutput('not json')).toEqual([])
    })
  })

  describe('buildTomorrowQuery', () => {
    it('generates JXA script targeting Calendar in Exchange', () => {
      const script = buildTomorrowQuery()
      expect(script).toContain('Calendar')
      expect(script).toContain('Exchange')
      expect(script).toContain('startDate')
      expect(script).toContain('JSON.stringify')
    })
  })
})
