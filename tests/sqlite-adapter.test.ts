import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SQLiteAdapter } from '../src/adapters/data/sqlite.js'

describe('SQLiteAdapter', () => {
  let adapter: SQLiteAdapter
  let home: string

  beforeEach(async () => {
    home = join(tmpdir(), `hughmann-sqlite-test-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    adapter = new SQLiteAdapter(home)
    await adapter.init()
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  describe('tasks', () => {
    it('creates and lists tasks', async () => {
      const task = await adapter.createTask({
        title: 'Test task',
        description: 'A test',
        status: 'todo',
        task_type: 'standard',
        priority: 3,
        domain: 'personal',
      })

      expect(task.id).toBeTruthy()
      const tasks = await adapter.listTasks({ status: 'todo' })
      expect(tasks).toHaveLength(1)
      expect(tasks[0].title).toBe('Test task')
    })

    it('updates task status', async () => {
      const task = await adapter.createTask({
        title: 'Update me',
        status: 'todo',
        task_type: 'mit',
        priority: 2,
      })

      await adapter.updateTask(task.id, { status: 'in_progress' })
      const tasks = await adapter.listTasks({ status: 'in_progress' })
      expect(tasks).toHaveLength(1)
    })

    it('completes a task', async () => {
      const task = await adapter.createTask({
        title: 'Complete me',
        status: 'todo',
        task_type: 'must',
        priority: 1,
      })

      await adapter.completeTask(task.id, 'Done!')
      const tasks = await adapter.listTasks({ status: 'done' })
      expect(tasks).toHaveLength(1)
      expect(tasks[0].completion_notes).toBe('Done!')
    })

    it('filters by multiple statuses', async () => {
      await adapter.createTask({ title: 'A', status: 'todo', task_type: 'standard', priority: 3 })
      await adapter.createTask({ title: 'B', status: 'backlog', task_type: 'standard', priority: 3 })
      await adapter.createTask({ title: 'C', status: 'done', task_type: 'standard', priority: 3 })

      const tasks = await adapter.listTasks({ status: ['todo', 'backlog'] })
      expect(tasks).toHaveLength(2)
    })

    it('filters by domain', async () => {
      await adapter.createTask({ title: 'Work', status: 'todo', task_type: 'standard', priority: 3, domain: 'work' })
      await adapter.createTask({ title: 'Personal', status: 'todo', task_type: 'standard', priority: 3, domain: 'personal' })

      const tasks = await adapter.listTasks({ domain: 'work' })
      expect(tasks).toHaveLength(1)
      expect(tasks[0].title).toBe('Work')
    })
  })

  describe('projects', () => {
    it('creates and retrieves by slug', async () => {
      await adapter.createProject({
        name: 'Test Project',
        slug: 'test-project',
        description: 'A test project',
        domain: 'personal',
        status: 'active',
        guardrails: ['Guardrail 1'],
      })

      const project = await adapter.getProjectBySlug('test-project')
      expect(project).toBeTruthy()
      expect(project!.name).toBe('Test Project')
      expect(project!.guardrails).toContain('Guardrail 1')
    })

    it('lists by status', async () => {
      await adapter.createProject({
        name: 'Active',
        slug: 'active',
        status: 'active',
        domain: 'personal',
      })
      await adapter.createProject({
        name: 'Paused',
        slug: 'paused',
        status: 'paused',
        domain: 'personal',
      })

      const active = await adapter.listProjects({ status: ['active'] })
      expect(active).toHaveLength(1)
      expect(active[0].name).toBe('Active')
    })
  })

  describe('KB nodes', () => {
    it('upserts and retrieves by path', async () => {
      const id = await adapter.upsertKbNode({
        vault: 'test-vault',
        filePath: 'notes/test.md',
        title: 'Test Note',
        content: 'Hello world',
        contentHash: 'abc123',
      })

      expect(id).toBeTruthy()

      const node = await adapter.getKbNodeByPath('test-vault', 'notes/test.md')
      expect(node).toBeTruthy()
      expect(node!.contentHash).toBe('abc123')
    })

    it('updates existing node on upsert', async () => {
      await adapter.upsertKbNode({
        vault: 'v',
        filePath: 'f.md',
        title: 'V1',
        content: 'old',
        contentHash: 'hash1',
      })

      await adapter.upsertKbNode({
        vault: 'v',
        filePath: 'f.md',
        title: 'V2',
        content: 'new',
        contentHash: 'hash2',
      })

      const node = await adapter.getKbNodeByPath('v', 'f.md')
      expect(node!.contentHash).toBe('hash2')
    })

    it('deletes a node', async () => {
      await adapter.upsertKbNode({
        vault: 'v',
        filePath: 'f.md',
        title: 'Del',
        content: 'bye',
      })

      await adapter.deleteKbNode('v', 'f.md')
      const node = await adapter.getKbNodeByPath('v', 'f.md')
      expect(node).toBeNull()
    })

    it('searches KB nodes by embedding similarity', async () => {
      await adapter.upsertKbNode({
        vault: 'v',
        filePath: 'a.md',
        title: 'Close',
        content: 'similar content',
        embedding: [1, 0, 0],
      })
      await adapter.upsertKbNode({
        vault: 'v',
        filePath: 'b.md',
        title: 'Far',
        content: 'different content',
        embedding: [0, 1, 0],
      })

      const results = await adapter.searchKbNodes([1, 0, 0], { limit: 5, threshold: 0.5 })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Close')
      expect(results[0].similarity).toBeCloseTo(1)
    })
  })

  describe('memory', () => {
    const sessionId = 'test-session-1'

    beforeEach(async () => {
      // Create a session first to satisfy the FK constraint on memories
      const now = new Date().toISOString()
      await adapter.saveSession({
        id: sessionId,
        title: 'Test Session',
        domain: null,
        messages: [],
        createdAt: now,
        updatedAt: now,
      })
    })

    it('stores and retrieves memories', async () => {
      const today = new Date().toISOString().split('T')[0]
      await adapter.saveMemory({
        sessionId,
        content: 'A memory about work',
        domain: 'work',
        date: today,
      })
      const memories = await adapter.getRecentMemories(5)
      expect(memories).toHaveLength(1)
      expect(memories[0].content).toBe('A memory about work')
    })

    it('stores and searches embeddings', async () => {
      const today = new Date().toISOString().split('T')[0]
      const memoryId = await adapter.saveMemoryWithEmbedding({
        sessionId,
        content: 'Test memory',
        domain: 'personal',
        date: today,
        embedding: [0.5, 0.5, 0],
      })

      expect(memoryId).toBeTruthy()

      const results = await adapter.searchMemories([0.5, 0.5, 0], { limit: 5 })
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].similarity).toBeCloseTo(1)
    })
  })
})
