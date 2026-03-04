/**
 * Shared AppleScript execution helper for macOS-native app tools.
 * Ported from Foundry's applescript.ts.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function runAppleScript(
  script: string,
  opts?: { timeout?: number; maxBuffer?: number },
): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], {
    timeout: opts?.timeout ?? 30_000,
    maxBuffer: opts?.maxBuffer ?? 5 * 1024 * 1024,
  })
  return stdout.trim()
}
