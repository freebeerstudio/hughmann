/**
 * Shared AppleScript/JXA execution helper for macOS-native app tools.
 * Ported from Foundry's applescript.ts.
 *
 * Writes scripts to a temp file and runs `osascript <file>` to avoid
 * quoting issues with `osascript -e` on multi-line scripts.
 */

import { execFile } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function runAppleScript(
  script: string,
  opts?: { timeout?: number; maxBuffer?: number; language?: 'AppleScript' | 'JavaScript' },
): Promise<string> {
  const lang = opts?.language ?? 'AppleScript'
  const ext = lang === 'JavaScript' ? '.js' : '.applescript'
  const tmpFile = join(tmpdir(), `hughmann-as-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  writeFileSync(tmpFile, script, 'utf-8')
  try {
    const args = lang === 'JavaScript' ? ['-l', 'JavaScript', tmpFile] : [tmpFile]
    const { stdout } = await execFileAsync('osascript', args, {
      timeout: opts?.timeout ?? 30_000,
      maxBuffer: opts?.maxBuffer ?? 5 * 1024 * 1024,
    })
    return stdout.trim()
  } finally {
    try { unlinkSync(tmpFile) } catch { /* best-effort cleanup */ }
  }
}
