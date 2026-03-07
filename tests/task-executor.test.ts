import { describe, it, expect } from 'vitest'
import { selectBestTask, buildTaskPrompt } from '../src/runtime/task-executor.js'
import type { Task } from '../src/types/tasks.js'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-id',
    title: 'Test task',
    description: null,
    status: 'todo',
    task_type: 'STANDARD',
    domain: null,
    project: null,
    project_id: null,
    priority: 3,
    due_date: null,
    cwd: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    completed_at: null,
    completion_notes: null,
    metadata: {},
    ...overrides,
  }
}

describe('selectBestTask', () => {
  it('returns null for empty list', () => {
    expect(selectBestTask([])).toBeNull()
  })

  it('picks highest priority (lowest number)', () => {
    const tasks = [
      makeTask({ id: 'low', priority: 5 }),
      makeTask({ id: 'high', priority: 1 }),
      makeTask({ id: 'mid', priority: 3 }),
    ]
    expect(selectBestTask(tasks)!.id).toBe('high')
  })

  it('breaks priority tie by task type weight', () => {
    const tasks = [
      makeTask({ id: 'standard', priority: 2, task_type: 'STANDARD' }),
      makeTask({ id: 'must', priority: 2, task_type: 'MUST' }),
    ]
    expect(selectBestTask(tasks)!.id).toBe('must')
  })

  it('breaks full tie by creation time', () => {
    const tasks = [
      makeTask({ id: 'newer', priority: 2, task_type: 'STANDARD', created_at: '2025-06-01T00:00:00Z' }),
      makeTask({ id: 'older', priority: 2, task_type: 'STANDARD', created_at: '2025-01-01T00:00:00Z' }),
    ]
    expect(selectBestTask(tasks)!.id).toBe('older')
  })
})

describe('buildTaskPrompt', () => {
  it('includes title and description', async () => {
    const task = makeTask({ title: 'Deploy app', description: 'Push to prod' })
    const prompt = await buildTaskPrompt(task)
    expect(prompt).toContain('Deploy app')
    expect(prompt).toContain('Push to prod')
  })

  it('includes project and domain when present', async () => {
    const task = makeTask({ project: 'HughMann', domain: 'personal' })
    const prompt = await buildTaskPrompt(task)
    expect(prompt).toContain('HughMann')
    expect(prompt).toContain('personal')
  })

  it('includes due date', async () => {
    const task = makeTask({ due_date: '2025-12-31' })
    const prompt = await buildTaskPrompt(task)
    expect(prompt).toContain('2025-12-31')
  })

  it('includes completion instructions', async () => {
    const task = makeTask()
    const prompt = await buildTaskPrompt(task)
    expect(prompt).toContain('Complete this task')
  })
})
