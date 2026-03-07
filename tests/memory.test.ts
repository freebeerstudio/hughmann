import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryManager } from '../src/runtime/memory.js'

describe('MemoryManager', () => {
  let tmpHome: string
  let manager: MemoryManager

  beforeEach(() => {
    tmpHome = join(tmpdir(), `hughmann-memory-test-${Date.now()}`)
    mkdirSync(tmpHome, { recursive: true })
    manager = new MemoryManager(tmpHome)
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  describe('distilled ledger', () => {
    it('reports not distilled for unknown session', () => {
      expect(manager.isDistilled('session-abc')).toBe(false)
    })

    it('marks a session as distilled', () => {
      manager.markDistilled('session-abc')
      expect(manager.isDistilled('session-abc')).toBe(true)
    })

    it('persists across instances', () => {
      manager.markDistilled('session-xyz')
      const manager2 = new MemoryManager(tmpHome)
      expect(manager2.isDistilled('session-xyz')).toBe(true)
    })

    it('caps ledger at 200 entries', () => {
      for (let i = 0; i < 210; i++) {
        manager.markDistilled(`session-${i}`)
      }
      // Oldest entries should be evicted
      expect(manager.isDistilled('session-0')).toBe(false)
      // Recent entries should remain
      expect(manager.isDistilled('session-209')).toBe(true)
    })
  })

  describe('file-based retrieval', () => {
    it('returns empty string for empty memory dir', () => {
      const result = manager.getRecentMemoriesSync(3)
      expect(result).toBe('')
    })

    it('reads today memory file', () => {
      const memDir = join(tmpHome, 'memory')
      const today = new Date().toISOString().split('T')[0]
      writeFileSync(join(memDir, `${today}.md`), '# Memory\n\nSome facts here', 'utf-8')

      const result = manager.getRecentMemoriesSync(3)
      expect(result).toContain('Some facts here')
    })

    it('filters by domain for isolated zones', () => {
      const memDir = join(tmpHome, 'memory')
      const today = new Date().toISOString().split('T')[0]
      const content = `# Memory — ${today}

### 10:30 AM [omnissa] — Meeting
- Met with customer

---

### 11:00 AM [fbs] — Design
- Built website

---
`
      writeFileSync(join(memDir, `${today}.md`), content, 'utf-8')

      const result = manager.getRecentMemoriesSync(3, 'omnissa', 'isolated')
      expect(result).toContain('Met with customer')
      expect(result).not.toContain('Built website')
    })
  })
})
