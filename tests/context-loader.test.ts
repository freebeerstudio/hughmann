import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadContext } from '../src/runtime/context-loader.js'

describe('loadContext', () => {
  let contextDir: string

  beforeEach(() => {
    contextDir = join(tmpdir(), `hughmann-test-${Date.now()}`)
    mkdirSync(join(contextDir, 'domains'), { recursive: true })
  })

  afterEach(() => {
    rmSync(contextDir, { recursive: true, force: true })
  })

  function writeSoul(content: string) {
    writeFileSync(join(contextDir, 'soul.md'), content, 'utf-8')
  }

  function writeOwner(content: string) {
    writeFileSync(join(contextDir, 'owner.md'), content, 'utf-8')
  }

  it('throws if soul.md is missing', () => {
    writeOwner('# Alice\n')
    expect(() => loadContext(contextDir)).toThrow('soul.md')
  })

  it('throws if owner.md is missing', () => {
    writeSoul('# TestBot\n')
    expect(() => loadContext(contextDir)).toThrow('owner.md')
  })

  it('loads minimal context with soul and owner', () => {
    writeSoul('# TestBot\nYou are a test bot.\n')
    writeOwner('# Alice\n\n## How You Work\n\n- **Timezone**: America/New_York\n')

    const { store, warnings } = loadContext(contextDir)

    expect(store.config.systemName).toBe('TestBot')
    expect(store.config.ownerName).toBe('Alice')
    expect(store.config.timezone).toBe('America/New_York')
    expect(store.soul.raw).toContain('test bot')
    expect(warnings.length).toBeGreaterThan(0) // missing optional docs
  })

  it('defaults timezone to UTC if not found', () => {
    writeSoul('# Bot\n')
    writeOwner('# Bob\n')

    const { store } = loadContext(contextDir)
    expect(store.config.timezone).toBe('UTC')
  })

  it('loads domains from domains/ directory', () => {
    writeSoul('# Bot\n\n### Personal Domains\n- **Work** (career)\n')
    writeOwner('# Alice\n- **Timezone**: UTC\n')
    writeFileSync(
      join(contextDir, 'domains', 'work.md'),
      '# Work\n\n- **Type**: career\n\nWork stuff.\n',
      'utf-8',
    )

    const { store } = loadContext(contextDir)
    expect(store.domains.size).toBe(1)

    const work = store.domains.get('work')
    expect(work).toBeDefined()
    expect(work!.name).toBe('Work')
    expect(work!.domainType).toBe('career')
    expect(work!.isolation).toBe('personal')
  })

  it('resolves isolated domains correctly', () => {
    writeSoul('# Bot\n\n### Isolated Domains\n- **ClientCo** (career) — see domains/clientco.md\n')
    writeOwner('# Alice\n- **Timezone**: UTC\n')
    writeFileSync(
      join(contextDir, 'domains', 'clientco.md'),
      '# ClientCo\n\n- **Type**: career\n',
      'utf-8',
    )

    const { store } = loadContext(contextDir)
    const domain = store.domains.get('clientco')
    expect(domain).toBeDefined()
    expect(domain!.isolation).toBe('isolated')
  })
})
