import { describe, it, expect } from 'vitest'
import { isDuplicate } from '../src/runtime/gap-analyzer.js'
import type { Task } from '../src/types/tasks.js'

function makeTask(title: string): Task {
  return {
    id: '1',
    title,
    description: '',
    status: 'backlog',
    task_type: 'standard',
    priority: 3,
    domain: 'personal',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

describe('isDuplicate', () => {
  it('detects exact substring match', () => {
    expect(isDuplicate('Cannot access Google Calendar', [makeTask('Cannot access Google Calendar')])).toBe(true)
  })

  it('detects when existing title contains new title', () => {
    expect(isDuplicate('Calendar', [makeTask('Cannot access Google Calendar')])).toBe(true)
  })

  it('detects when new title contains existing title', () => {
    expect(isDuplicate('Investigate failure: Cannot access Calendar', [makeTask('Cannot access Calendar')])).toBe(true)
  })

  it('detects word overlap above 60%', () => {
    expect(isDuplicate(
      'Missing Google Calendar integration capability',
      [makeTask('Google Calendar integration missing')],
    )).toBe(true)
  })

  it('returns false for unrelated titles', () => {
    expect(isDuplicate('Install Slack integration', [makeTask('Fix email pipeline')])).toBe(false)
  })

  it('returns false for empty existing list', () => {
    expect(isDuplicate('Something new', [])).toBe(false)
  })

  it('prevents recursive failure loops', () => {
    const existing = makeTask('Investigate failure: Send daily report')
    expect(isDuplicate('Investigate failure: Send daily report', [existing])).toBe(true)
  })

  it('handles short titles gracefully', () => {
    // Words <= 3 chars are filtered, so very short titles should not crash
    expect(isDuplicate('Fix it', [makeTask('Do it')])).toBe(false)
  })
})
