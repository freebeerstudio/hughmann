import { describe, it, expect } from 'vitest'
import { parseCalendarOutput, buildTomorrowQuery } from '../src/calendar/apple-calendar.js'

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
