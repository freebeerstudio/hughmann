import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Architecture boundary test — ensures runtime, tools, and daemon code
 * never import concrete adapter implementations directly.
 */
describe('architecture boundaries', () => {
  const SRC = join(__dirname, '..', 'src')
  const FORBIDDEN_IMPORT = /from\s+['"]\.\.\/.*adapters\/data\/(sqlite|supabase|turso)\.js['"]/

  function collectTsFiles(dir: string): string[] {
    const results: string[] = []
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return results }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...collectTsFiles(full))
      } else if (entry.name.endsWith('.ts')) {
        results.push(full)
      }
    }
    return results
  }

  const dirs = ['runtime', 'tools', 'daemon']

  for (const subdir of dirs) {
    it(`src/${subdir}/ does not import concrete adapters`, () => {
      const files = collectTsFiles(join(SRC, subdir))
        // boot.ts is the only file allowed to import concrete adapters
        .filter(f => !f.endsWith('boot.ts'))

      const violations: string[] = []

      for (const file of files) {
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (FORBIDDEN_IMPORT.test(lines[i])) {
            const relPath = file.replace(SRC + '/', '')
            violations.push(`${relPath}:${i + 1}: ${lines[i].trim()}`)
          }
        }
      }

      expect(violations, `Concrete adapter imports found:\n${violations.join('\n')}`).toHaveLength(0)
    })
  }
})
