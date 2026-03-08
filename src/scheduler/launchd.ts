import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

const PLIST_PREFIX = 'com.hughmann.skill'
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents')
const HUGHMANN_HOME = join(homedir(), '.hughmann')
const LOG_DIR = join(HUGHMANN_HOME, 'logs')

export interface ScheduleEntry {
  skillId: string
  hour: number
  minute: number
  weekday?: number // 1=Monday ... 7=Sunday (launchd: 1=Mon)
  label: string
  plistPath: string
  loaded: boolean
}

/** Parse active hours string like "7am-6pm" into { start, end } in 24h format */
function parseActiveHours(activeHours: string): { start: number; end: number } | null {
  const match = activeHours.match(/(\d{1,2})(am|pm)?\s*-\s*(\d{1,2})(am|pm)?/i)
  if (!match) return null
  let startHour = parseInt(match[1])
  const startAmPm = (match[2] || '').toLowerCase()
  let endHour = parseInt(match[3])
  const endAmPm = (match[4] || '').toLowerCase()
  if (startAmPm === 'pm' && startHour < 12) startHour += 12
  if (startAmPm === 'am' && startHour === 12) startHour = 0
  if (endAmPm === 'pm' && endHour < 12) endHour += 12
  if (endAmPm === 'am' && endHour === 12) endHour = 0
  return { start: startHour, end: endHour }
}

/**
 * Default schedules — customizable via schedule.json or onboarding config.
 */
export function getDefaultSchedules(): { skillId: string; hour: number; minute: number; weekday?: number; description: string }[] {
  try {
    const configPath = join(HUGHMANN_HOME, '.onboarding-data.json')
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      const activeHours = config.autonomy?.activeHours
      if (activeHours) {
        const hours = parseActiveHours(activeHours)
        if (hours) {
          const reviewHour = Math.min(hours.start + 2, hours.end - 1)
          return [
            { skillId: 'morning', hour: hours.start, minute: 0, description: `Morning dashboard at ${formatHour(hours.start)}` },
            { skillId: 'closeout', hour: hours.end, minute: 0, description: `Afternoon closeout at ${formatHour(hours.end)}` },
            { skillId: 'review', hour: reviewHour, minute: 0, weekday: 5, description: `Weekly review on Fridays at ${formatHour(reviewHour)}` },
            { skillId: 'process-email', hour: 7, minute: 0, description: 'Process email at 7:00 AM' },
            { skillId: 'process-email', hour: 12, minute: 0, description: 'Process email at 12:00 PM' },
            { skillId: 'process-email', hour: 18, minute: 0, description: 'Process email at 6:00 PM' },
            { skillId: 'prep-meetings', hour: 16, minute: 0, description: 'Meeting prep at 4:00 PM' },
          ]
        }
      }
    }
  } catch {
    // Fall through to defaults
  }

  return [
    { skillId: 'morning', hour: 7, minute: 0, description: 'Morning dashboard at 7:00 AM' },
    { skillId: 'closeout', hour: 16, minute: 0, description: 'Afternoon closeout at 4:00 PM' },
    { skillId: 'review', hour: 9, minute: 0, weekday: 5, description: 'Weekly review on Fridays at 9:00 AM' },
    { skillId: 'process-email', hour: 7, minute: 0, description: 'Process email at 7:00 AM' },
    { skillId: 'process-email', hour: 12, minute: 0, description: 'Process email at 12:00 PM' },
    { skillId: 'process-email', hour: 18, minute: 0, description: 'Process email at 6:00 PM' },
    { skillId: 'prep-meetings', hour: 16, minute: 0, description: 'Meeting prep at 4:00 PM' },
  ]
}

function formatHour(hour: number): string {
  const h = hour % 12 || 12
  const ampm = hour < 12 ? 'AM' : 'PM'
  return `${h}:00 ${ampm}`
}

/** @deprecated Use getDefaultSchedules() instead */
export const DEFAULT_SCHEDULES = getDefaultSchedules()

/**
 * Generate the launchd plist XML for a scheduled skill.
 */
function generatePlist(skillId: string, hour: number, minute: number, weekday?: number): string {
  // Find the hughmann binary — prefer global install, fall back to npx tsx
  const hughmannPath = findHughmannBinary()

  const calendarLines = [
    '      <dict>',
    `        <key>Hour</key><integer>${hour}</integer>`,
    `        <key>Minute</key><integer>${minute}</integer>`,
  ]

  if (weekday !== undefined) {
    calendarLines.push(`        <key>Weekday</key><integer>${weekday}</integer>`)
  }
  calendarLines.push('      </dict>')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_PREFIX}.${skillId}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${hughmannPath.command}</string>
${hughmannPath.args.map(a => `    <string>${escapeXml(a)}</string>`).join('\n')}
    <string>${skillId}</string>
    <string>-q</string>
  </array>

  <key>StartCalendarInterval</key>
  <array>
${calendarLines.join('\n')}
  </array>

  <key>StandardOutPath</key>
  <string>${join(LOG_DIR, `${skillId}.log`)}</string>

  <key>StandardErrorPath</key>
  <string>${join(LOG_DIR, `${skillId}.error.log`)}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${process.env.HOME}/.npm-global/bin</string>
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>

  <key>RunAtLoad</key>
  <false/>

  <key>Nice</key>
  <integer>10</integer>
</dict>
</plist>
`
}

function findHughmannBinary(): { command: string; args: string[] } {
  // Check if hughmann is globally installed
  try {
    const path = execSync('which hughmann', { encoding: 'utf-8' }).trim()
    if (path) return { command: path, args: [] }
  } catch { /* not found */ }

  // Check if npx tsx is available (dev mode)
  try {
    const npxPath = execSync('which npx', { encoding: 'utf-8' }).trim()
    if (npxPath) {
      // Find the project directory by looking for package.json up from current dir
      const projectDir = findProjectRoot()
      if (projectDir) {
        return {
          command: npxPath,
          args: ['tsx', join(projectDir, 'src', 'cli.ts')],
        }
      }
    }
  } catch { /* not found */ }

  // Fallback: assume hughmann will be on PATH
  return { command: 'hughmann', args: [] }
}

function findProjectRoot(): string | null {
  let dir = process.cwd()
  while (dir !== '/') {
    if (existsSync(join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        if (pkg.name === 'hughmann') return dir
      } catch { /* skip */ }
    }
    dir = join(dir, '..')
  }
  return null
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Install a schedule by writing a plist and loading it with launchctl.
 */
export function installSchedule(skillId: string, hour: number, minute: number, weekday?: number): { success: boolean; path: string; error?: string } {
  const label = `${PLIST_PREFIX}.${skillId}`
  const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`)

  // Ensure directories exist
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })

  // Unload if already loaded
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' })
  } catch { /* not loaded, fine */ }

  // Write plist
  const plistContent = generatePlist(skillId, hour, minute, weekday)
  writeFileSync(plistPath, plistContent, 'utf-8')

  // Load with launchctl
  try {
    execSync(`launchctl load "${plistPath}"`, { encoding: 'utf-8' })
    return { success: true, path: plistPath }
  } catch (err) {
    return {
      success: false,
      path: plistPath,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Remove a schedule by unloading and deleting the plist.
 */
export function removeSchedule(skillId: string): boolean {
  const label = `${PLIST_PREFIX}.${skillId}`
  const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`)

  if (!existsSync(plistPath)) return false

  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' })
  } catch { /* already unloaded */ }

  unlinkSync(plistPath)
  return true
}

/**
 * List all installed HughMann schedules.
 */
export function listSchedules(): ScheduleEntry[] {
  if (!existsSync(LAUNCH_AGENTS_DIR)) return []

  const files = readdirSync(LAUNCH_AGENTS_DIR)
    .filter(f => f.startsWith(PLIST_PREFIX) && f.endsWith('.plist'))

  const entries: ScheduleEntry[] = []

  for (const file of files) {
    const plistPath = join(LAUNCH_AGENTS_DIR, file)
    const label = file.replace('.plist', '')
    const skillId = label.replace(`${PLIST_PREFIX}.`, '')

    // Parse the plist for schedule info
    let hour = 0, minute = 0, weekday: number | undefined
    try {
      const content = readFileSync(plistPath, 'utf-8')
      const hourMatch = content.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/)
      const minMatch = content.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/)
      const wdMatch = content.match(/<key>Weekday<\/key>\s*<integer>(\d+)<\/integer>/)
      if (hourMatch) hour = parseInt(hourMatch[1])
      if (minMatch) minute = parseInt(minMatch[1])
      if (wdMatch) weekday = parseInt(wdMatch[1])
    } catch { /* couldn't parse */ }

    // Check if loaded
    let loaded = false
    try {
      const result = execSync(`launchctl list "${label}" 2>/dev/null`, { encoding: 'utf-8' })
      loaded = result.includes(label)
    } catch { /* not loaded */ }

    entries.push({ skillId, hour, minute, weekday, label, plistPath, loaded })
  }

  return entries
}

/**
 * Remove ALL HughMann schedules.
 */
export function removeAllSchedules(): number {
  const schedules = listSchedules()
  let removed = 0
  for (const s of schedules) {
    if (removeSchedule(s.skillId)) removed++
  }
  return removed
}
