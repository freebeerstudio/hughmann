import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ContextWriter } from '../src/runtime/context-writer.js'

describe('ContextWriter', () => {
  let contextDir: string
  let writer: ContextWriter

  beforeEach(() => {
    contextDir = join(tmpdir(), `hughmann-ctx-test-${Date.now()}`)
    mkdirSync(contextDir, { recursive: true })
    mkdirSync(join(contextDir, 'domains'), { recursive: true })
    writer = new ContextWriter(contextDir)
  })

  afterEach(() => {
    rmSync(contextDir, { recursive: true, force: true })
  })

  describe('logDecision', () => {
    it('returns false when master-plan.md is missing', () => {
      expect(writer.logDecision('test', 'because', 'personal')).toBe(false)
    })

    it('appends a decision row to the table', () => {
      const content = `# Master Plan

## Decision Log

| Date | Decision | Reasoning | Domain |
|------|----------|-----------|--------|
`
      writeFileSync(join(contextDir, 'master-plan.md'), content, 'utf-8')

      const result = writer.logDecision('Use SQLite', 'Simpler setup', 'personal')
      expect(result).toBe(true)

      const updated = readFileSync(join(contextDir, 'master-plan.md'), 'utf-8')
      expect(updated).toContain('Use SQLite')
      expect(updated).toContain('Simpler setup')
    })
  })

  describe('updateSection', () => {
    it('replaces section content and preserves adjacent sections', () => {
      const content = `# Doc

## Section A

Old content A

## Section B

Old content B

## Section C

Old content C
`
      writeFileSync(join(contextDir, 'test.md'), content, 'utf-8')

      const result = writer.updateSection('test.md', 'Section B', 'New content B')
      expect(result).toBe(true)

      const updated = readFileSync(join(contextDir, 'test.md'), 'utf-8')
      expect(updated).toContain('New content B')
      expect(updated).toContain('Old content A')
      expect(updated).toContain('Old content C')
      expect(updated).not.toContain('Old content B')
    })
  })

  describe('appendDomainNote', () => {
    it('appends to existing Notes section', () => {
      writeFileSync(join(contextDir, 'domains', 'omnissa.md'), `# Omnissa

## Notes

- Existing note
`, 'utf-8')

      const result = writer.appendDomainNote('omnissa', 'New insight')
      expect(result).toBe(true)

      const updated = readFileSync(join(contextDir, 'domains', 'omnissa.md'), 'utf-8')
      expect(updated).toContain('Existing note')
      expect(updated).toContain('New insight')
    })

    it('creates Notes section if missing', () => {
      writeFileSync(join(contextDir, 'domains', 'fbs.md'), `# FBS

## Overview

Some info
`, 'utf-8')

      const result = writer.appendDomainNote('fbs', 'First note')
      expect(result).toBe(true)

      const updated = readFileSync(join(contextDir, 'domains', 'fbs.md'), 'utf-8')
      expect(updated).toContain('## Notes')
      expect(updated).toContain('First note')
    })
  })

  describe('updateWeeklyFocus', () => {
    it('replaces big rocks', () => {
      const content = `# Master Plan

## Weekly Focus

### Big Rocks This Week

1. Old rock

### Daily MUSTs

Old must

## Other
`
      writeFileSync(join(contextDir, 'master-plan.md'), content, 'utf-8')

      const result = writer.updateWeeklyFocus(['New rock 1', 'New rock 2'])
      expect(result).toBe(true)

      const updated = readFileSync(join(contextDir, 'master-plan.md'), 'utf-8')
      expect(updated).toContain('New rock 1')
      expect(updated).toContain('New rock 2')
      expect(updated).not.toContain('Old rock')
    })
  })

  describe('readDoc', () => {
    it('returns null for missing file', () => {
      expect(writer.readDoc('nonexistent.md')).toBeNull()
    })

    it('returns content for existing file', () => {
      writeFileSync(join(contextDir, 'hello.md'), 'Hello world', 'utf-8')
      expect(writer.readDoc('hello.md')).toBe('Hello world')
    })
  })
})
