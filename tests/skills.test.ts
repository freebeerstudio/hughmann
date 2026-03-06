import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillManager } from '../src/runtime/skills.js'

describe('SkillManager', () => {
  let home: string

  beforeEach(() => {
    home = join(tmpdir(), `hughmann-skills-test-${Date.now()}`)
    mkdirSync(join(home, 'skills'), { recursive: true })
    mkdirSync(join(home, 'context'), { recursive: true })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('loads built-in skills', () => {
    const mgr = new SkillManager(home)
    expect(mgr.has('morning')).toBe(true)
    expect(mgr.has('habits')).toBe(true)
    expect(mgr.has('focus')).toBe(true)
    expect(mgr.listBuiltin().length).toBeGreaterThanOrEqual(8)
  })

  it('interpolates {{OWNER}} placeholder in focus skill', () => {
    const mgr = new SkillManager(home)
    mgr.setInterpolationContext('Alice')
    const focus = mgr.get('focus')!
    expect(focus.prompt).toContain('Alice')
    expect(focus.prompt).not.toContain('{{OWNER}}')
  })

  it('interpolates {{HABITS}} placeholder in habits skill', () => {
    const mgr = new SkillManager(home)
    const habits = mgr.get('habits')!
    // Default habits should be present
    expect(habits.prompt).toContain('Exercise')
    expect(habits.prompt).not.toContain('{{HABITS}}')
  })

  it('loads custom habits from habits.md', () => {
    writeFileSync(join(home, 'context', 'habits.md'), '1. Run\n2. Code\n3. Sleep', 'utf-8')
    const mgr = new SkillManager(home)
    const habits = mgr.get('habits')!
    expect(habits.prompt).toContain('Run')
    expect(habits.prompt).toContain('Code')
    expect(habits.prompt).not.toContain('Exercise')
  })

  it('loads user-defined SKILL.md skills', () => {
    const skillDir = join(home, 'skills', 'my-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: My Skill
description: A test skill
---
Do the thing.`, 'utf-8')

    const mgr = new SkillManager(home)
    const skill = mgr.get('my-skill')
    expect(skill).toBeDefined()
    expect(skill!.name).toBe('My Skill')
    expect(skill!.prompt).toBe('Do the thing.')
    expect(skill!.builtin).toBe(false)
  })

  it('does not let user skills override built-ins', () => {
    const skillDir = join(home, 'skills', 'morning')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: Evil Morning
description: Override
---
Evil prompt.`, 'utf-8')

    const mgr = new SkillManager(home)
    const morning = mgr.get('morning')!
    expect(morning.builtin).toBe(true)
    expect(morning.prompt).not.toContain('Evil')
  })

  it('does not modify non-built-in skills during interpolation', () => {
    const skillDir = join(home, 'skills', 'custom')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: Custom
description: test
---
Hello {{OWNER}}.`, 'utf-8')

    const mgr = new SkillManager(home)
    mgr.setInterpolationContext('Bob')
    const custom = mgr.get('custom')!
    // Non-built-in skills should NOT get interpolation
    expect(custom.prompt).toContain('{{OWNER}}')
  })
})
