import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../src/runtime/system-prompt-builder.js'
import type { ContextStore } from '../src/types/context.js'

function makeContext(overrides?: Partial<ContextStore>): ContextStore {
  return {
    soul: { path: 'soul.md', raw: '# TestBot\nYou are helpful.', meta: { title: 'TestBot', type: 'soul' } },
    owner: { path: 'owner.md', raw: '# Alice\nA test user.', meta: { title: 'Alice', type: 'owner' } },
    masterPlan: null,
    capabilities: null,
    growth: null,
    domains: new Map(),
    config: { systemName: 'TestBot', ownerName: 'Alice', timezone: 'UTC' },
    loadedAt: new Date(),
    ...overrides,
  }
}

describe('buildSystemPrompt', () => {
  it('includes soul and owner docs', () => {
    const prompt = buildSystemPrompt(makeContext())
    expect(prompt).toContain('You are helpful')
    expect(prompt).toContain('A test user')
  })

  it('includes environment block with timezone', () => {
    const prompt = buildSystemPrompt(makeContext())
    expect(prompt).toContain('UTC')
    expect(prompt).toContain('Active domain')
  })

  it('interpolates ownerName in tools section', () => {
    const prompt = buildSystemPrompt(makeContext(), { hasTools: true })
    expect(prompt).toContain('If Alice mentions')
    expect(prompt).not.toContain('Wayne')
  })

  it('does not include tools section when hasTools is false', () => {
    const prompt = buildSystemPrompt(makeContext(), { hasTools: false })
    expect(prompt).not.toContain('list_tasks')
  })

  it('includes first boot instructions', () => {
    const prompt = buildSystemPrompt(makeContext(), { firstBoot: true })
    expect(prompt).toContain('First Conversation')
    expect(prompt).toContain('Introduce yourself')
  })

  it('includes master plan when provided', () => {
    const ctx = makeContext({
      masterPlan: { path: 'plan.md', raw: '# Master Plan\nConquer the world.', meta: { title: 'Master Plan', type: 'master-plan' } },
    })
    const prompt = buildSystemPrompt(ctx, { includeMasterPlan: true })
    expect(prompt).toContain('Conquer the world')
  })

  it('respects maxLength truncation', () => {
    const prompt = buildSystemPrompt(makeContext(), { maxLength: 50 })
    expect(prompt.length).toBeLessThanOrEqual(50 + 50) // truncation message adds some text
    expect(prompt).toContain('truncated')
  })
})
