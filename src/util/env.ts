import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Simple .env file loader. Reads KEY=VALUE lines and sets them on process.env.
 * Doesn't override existing env vars.
 */
export function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      let value = trimmed.slice(eqIndex + 1).trim()
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // Silently ignore .env read errors
  }
}

/**
 * Write or update key=value pairs in a .env file.
 * Creates the file and parent directories if they don't exist.
 * Updates existing keys in-place, appends new ones at the end.
 */
export function writeEnvFile(path: string, entries: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true })

  let lines: string[] = []
  if (existsSync(path)) {
    lines = readFileSync(path, 'utf-8').split('\n')
  }

  const remaining = { ...entries }

  // Update existing keys
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    if (key in remaining) {
      lines[i] = `${key}=${remaining[key]}`
      delete remaining[key]
    }
  }

  // Append new keys
  for (const [key, value] of Object.entries(remaining)) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('')
    }
    lines.push(`${key}=${value}`)
  }

  writeFileSync(path, lines.join('\n'), 'utf-8')
}
