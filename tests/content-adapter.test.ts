import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SQLiteAdapter } from '../src/adapters/data/sqlite.js'

describe('Content Adapter', () => {
  let adapter: SQLiteAdapter
  let home: string

  beforeEach(async () => {
    home = join(tmpdir(), `hughmann-content-test-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    adapter = new SQLiteAdapter(home)
    await adapter.init()
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  // ─── Content ─────────────────────────────────────────────────────────

  describe('content', () => {
    it('listContent returns empty array initially', async () => {
      const items = await adapter.listContent()
      expect(items).toEqual([])
    })

    it('createContent creates and returns a ContentPiece with correct fields', async () => {
      const piece = await adapter.createContent({
        domain: 'fbs',
        title: 'My First Post',
        status: 'drafting',
        platform: 'linkedin',
        body: 'Some draft body',
        created_by: 'wayne',
      })

      expect(piece.id).toBeTruthy()
      expect(piece.domain).toBe('fbs')
      expect(piece.title).toBe('My First Post')
      expect(piece.status).toBe('drafting')
      expect(piece.platform).toBe('linkedin')
      expect(piece.body).toBe('Some draft body')
      expect(piece.created_by).toBe('wayne')
      expect(piece.topic_id).toBeNull()
      expect(piece.project_id).toBeNull()
      expect(piece.scheduled_at).toBeNull()
      expect(piece.published_at).toBeNull()
      expect(piece.published_url).toBeNull()
      expect(piece.source_material).toEqual([])
      expect(piece.created_at).toBeTruthy()
      expect(piece.updated_at).toBeTruthy()
    })

    it('createContent applies defaults: status=idea, platform=blog, created_by=hughmann', async () => {
      const piece = await adapter.createContent({
        domain: 'personal',
        title: 'Default Test',
      })

      expect(piece.status).toBe('idea')
      expect(piece.platform).toBe('blog')
      expect(piece.created_by).toBe('hughmann')
    })

    it('listContent with status filter returns matching items', async () => {
      await adapter.createContent({ domain: 'fbs', title: 'Idea', status: 'idea' })
      await adapter.createContent({ domain: 'fbs', title: 'Draft', status: 'drafting' })
      await adapter.createContent({ domain: 'fbs', title: 'Published', status: 'published' })

      const ideas = await adapter.listContent({ status: 'idea' })
      expect(ideas).toHaveLength(1)
      expect(ideas[0].title).toBe('Idea')

      const multi = await adapter.listContent({ status: ['idea', 'drafting'] })
      expect(multi).toHaveLength(2)
    })

    it('listContent with domain filter works', async () => {
      await adapter.createContent({ domain: 'fbs', title: 'FBS Post' })
      await adapter.createContent({ domain: 'personal', title: 'Personal Post' })

      const fbs = await adapter.listContent({ domain: 'fbs' })
      expect(fbs).toHaveLength(1)
      expect(fbs[0].title).toBe('FBS Post')
    })

    it('updateContent changes status and returns updated piece', async () => {
      const piece = await adapter.createContent({
        domain: 'fbs',
        title: 'Update Me',
        status: 'idea',
      })

      const updated = await adapter.updateContent(piece.id, { status: 'drafting' })
      expect(updated).not.toBeNull()
      expect(updated!.status).toBe('drafting')
      expect(updated!.title).toBe('Update Me')
    })

    it('getContent returns single item by id', async () => {
      const piece = await adapter.createContent({
        domain: 'fbs',
        title: 'Get Me',
      })

      const fetched = await adapter.getContent(piece.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(piece.id)
      expect(fetched!.title).toBe('Get Me')
    })

    it('getContent returns null for non-existent id', async () => {
      const result = await adapter.getContent('non-existent-id')
      expect(result).toBeNull()
    })

    it('source_material round-trips correctly (stored as JSON, returned as array)', async () => {
      const sources = [
        { url: 'https://example.com/a', title: 'Source A', summary: 'Summary A' },
        { url: 'https://example.com/b', title: 'Source B', summary: 'Summary B' },
      ]

      const piece = await adapter.createContent({
        domain: 'fbs',
        title: 'With Sources',
        source_material: sources,
      })

      expect(piece.source_material).toEqual(sources)

      // Verify it persists through getContent (read from DB)
      const fetched = await adapter.getContent(piece.id)
      expect(fetched!.source_material).toEqual(sources)
      expect(Array.isArray(fetched!.source_material)).toBe(true)
    })
  })

  // ─── Topics ──────────────────────────────────────────────────────────

  describe('topics', () => {
    it('listTopics returns empty initially', async () => {
      const topics = await adapter.listTopics()
      expect(topics).toEqual([])
    })

    it('createTopic creates and returns a Topic', async () => {
      const topic = await adapter.createTopic({
        domain: 'fbs',
        name: 'Web Design',
        description: 'Posts about web design',
      })

      expect(topic.id).toBeTruthy()
      expect(topic.domain).toBe('fbs')
      expect(topic.name).toBe('Web Design')
      expect(topic.description).toBe('Posts about web design')
      expect(topic.active).toBe(true)
      expect(topic.created_at).toBeTruthy()
    })

    it('listTopics with active filter works', async () => {
      await adapter.createTopic({ domain: 'fbs', name: 'Active Topic' })
      const t2 = await adapter.createTopic({ domain: 'fbs', name: 'Soon Inactive' })

      await adapter.updateTopic(t2.id, { active: false })

      const active = await adapter.listTopics({ active: true })
      expect(active).toHaveLength(1)
      expect(active[0].name).toBe('Active Topic')

      const inactive = await adapter.listTopics({ active: false })
      expect(inactive).toHaveLength(1)
      expect(inactive[0].name).toBe('Soon Inactive')
    })

    it('updateTopic changes name and active status', async () => {
      const topic = await adapter.createTopic({ domain: 'fbs', name: 'Original' })

      const updated = await adapter.updateTopic(topic.id, { name: 'Renamed', active: false })
      expect(updated).not.toBeNull()
      expect(updated!.name).toBe('Renamed')
      expect(updated!.active).toBe(false)
    })
  })

  // ─── Content Sources ─────────────────────────────────────────────────

  describe('content sources', () => {
    it('listContentSources returns empty initially', async () => {
      const sources = await adapter.listContentSources()
      expect(sources).toEqual([])
    })

    it('createContentSource creates and returns a ContentSource', async () => {
      const source = await adapter.createContentSource({
        domain: 'fbs',
        name: 'Tech Blog RSS',
        type: 'rss',
        url: 'https://example.com/feed.xml',
      })

      expect(source.id).toBeTruthy()
      expect(source.domain).toBe('fbs')
      expect(source.name).toBe('Tech Blog RSS')
      expect(source.type).toBe('rss')
      expect(source.url).toBe('https://example.com/feed.xml')
      expect(source.active).toBe(true)
      expect(source.created_at).toBeTruthy()
    })

    it('updateContentSource toggles active', async () => {
      const source = await adapter.createContentSource({
        domain: 'fbs',
        name: 'Newsletter',
        type: 'newsletter',
      })

      expect(source.active).toBe(true)

      const updated = await adapter.updateContentSource(source.id, { active: false })
      expect(updated).not.toBeNull()
      expect(updated!.active).toBe(false)

      const reactivated = await adapter.updateContentSource(source.id, { active: true })
      expect(reactivated).not.toBeNull()
      expect(reactivated!.active).toBe(true)
    })

    it('listContentSources with type filter', async () => {
      await adapter.createContentSource({ domain: 'fbs', name: 'RSS Feed', type: 'rss' })
      await adapter.createContentSource({ domain: 'fbs', name: 'YouTube Channel', type: 'youtube' })
      await adapter.createContentSource({ domain: 'fbs', name: 'Manual Entry', type: 'manual' })

      const rss = await adapter.listContentSources({ type: 'rss' })
      expect(rss).toHaveLength(1)
      expect(rss[0].name).toBe('RSS Feed')

      const youtube = await adapter.listContentSources({ type: 'youtube' })
      expect(youtube).toHaveLength(1)
      expect(youtube[0].name).toBe('YouTube Channel')
    })
  })
})
