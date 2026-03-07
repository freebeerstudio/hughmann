import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TEST_HOME = join(import.meta.dirname, '.test-gmail-categories')
process.env.HUGHMANN_HOME = TEST_HOME

const { loadCategories, saveCategories } = await import('../src/mail/gmail-categories.js')
type EmailCategory = import('../src/mail/gmail-categories.js').EmailCategory

describe('gmail-categories', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_HOME, 'email'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true })
  })

  it('returns default categories when no config exists', () => {
    const cats = loadCategories()
    expect(cats.length).toBeGreaterThanOrEqual(2)
    expect(cats.find(c => c.name === 'unwanted')).toBeTruthy()
    expect(cats.find(c => c.name === 'unclassified')).toBeTruthy()
  })

  it('saves and loads categories', () => {
    const cats: EmailCategory[] = [
      { name: 'billing', description: 'Invoices and payments' },
      { name: 'unwanted', description: 'Junk' },
      { name: 'unclassified', description: 'Needs review' },
    ]
    saveCategories(cats)
    const loaded = loadCategories()
    expect(loaded).toEqual(cats)
  })

  it('always includes unwanted and unclassified even if missing from file', () => {
    const configPath = join(TEST_HOME, 'email', 'categories.json')
    writeFileSync(configPath, JSON.stringify({
      categories: [{ name: 'billing', description: 'Invoices' }]
    }))
    const loaded = loadCategories()
    expect(loaded.find(c => c.name === 'billing')).toBeTruthy()
    expect(loaded.find(c => c.name === 'unwanted')).toBeTruthy()
    expect(loaded.find(c => c.name === 'unclassified')).toBeTruthy()
  })
})
