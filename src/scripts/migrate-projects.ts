#!/usr/bin/env tsx
/**
 * migrate-projects.ts
 *
 * Scans all HughMann projects and migrates them into the canonical
 * ~/Projects/{domain}/{slug}/ directory structure.
 *
 * Usage:
 *   tsx src/scripts/migrate-projects.ts              # dry run (default)
 *   tsx src/scripts/migrate-projects.ts --dry-run    # explicit dry run
 *   tsx src/scripts/migrate-projects.ts --live       # actually move/symlink
 *   tsx src/scripts/migrate-projects.ts --symlink    # symlink instead of move (implies --live)
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, symlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import type { DataAdapter } from '../adapters/data/types.js'
import type { Project } from '../types/projects.js'

// ─── Types ──────────────────────────────────────────────────────────────────

interface MigrateOptions {
  dryRun: boolean
  useSymlink: boolean
}

interface MigrationPlan {
  project: Project
  action: 'skip_has_path' | 'skip_not_found' | 'skip_already_canonical' | 'move' | 'symlink'
  sourcePath?: string
  targetPath?: string
  reason?: string
}

// ─── Discovery ──────────────────────────────────────────────────────────────

const SEARCH_ROOTS = [
  homedir(),
  join(homedir(), 'Documents'),
  join(homedir(), 'Developer'),
  join(homedir(), 'Projects'),
  join(homedir(), 'Code'),
  join(homedir(), 'src'),
  join(homedir(), 'repos'),
  join(homedir(), 'Sites'),
]

/**
 * Search common locations for a directory matching the project slug or name.
 * Returns the first match found, or null.
 */
function findProjectOnDisk(slug: string, name: string): string | null {
  const candidates = [slug, name.toLowerCase().replace(/\s+/g, '-')]
  const uniqueCandidates = [...new Set(candidates)]

  for (const root of SEARCH_ROOTS) {
    if (!existsSync(root)) continue

    for (const candidate of uniqueCandidates) {
      const fullPath = join(root, candidate)
      if (existsSync(fullPath)) {
        try {
          const s = lstatSync(fullPath)
          if (s.isDirectory() || s.isSymbolicLink()) {
            return fullPath
          }
        } catch {
          // permission error, skip
        }
      }
    }
  }

  // Deeper search: look one level into each root for partial matches
  for (const root of SEARCH_ROOTS) {
    if (!existsSync(root)) continue
    try {
      const entries = readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const entryLower = entry.name.toLowerCase()
        for (const candidate of uniqueCandidates) {
          if (entryLower === candidate.toLowerCase()) {
            return join(root, entry.name)
          }
        }
      }
    } catch {
      // permission error on root, skip
    }
  }

  return null
}

/**
 * Detect stack from project directory files (mirrors register_project logic).
 */
function detectStack(dirPath: string): string[] {
  const stack: string[] = []
  try {
    const files = readdirSync(dirPath)

    if (files.includes('package.json')) {
      try {
        const pkg = JSON.parse(readFileSync(join(dirPath, 'package.json'), 'utf8'))
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        if (deps.next) stack.push('nextjs')
        if (deps.react && !deps.next) stack.push('react')
        if (deps.vue) stack.push('vue')
        if (deps.tailwindcss) stack.push('tailwind')
        if (deps['@supabase/supabase-js']) stack.push('supabase')
        if (deps.express) stack.push('express')
        if (deps.prisma || deps['@prisma/client']) stack.push('prisma')
        if (deps.typescript) stack.push('typescript')
      } catch { /* couldn't parse package.json */ }
    }
    if (files.includes('Cargo.toml')) stack.push('rust')
    if (files.includes('go.mod')) stack.push('go')
    if (files.some((f: string) => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))) stack.push('swift')
    if (files.includes('requirements.txt') || files.includes('pyproject.toml')) stack.push('python')
  } catch {
    // can't read directory
  }
  return stack
}

/**
 * Detect git remote URL, CLAUDE.md existence.
 */
function detectProjectMeta(dirPath: string): { repoUrl: string | null; claudeMdExists: boolean } {
  let repoUrl: string | null = null
  try {
    repoUrl = execSync('git remote get-url origin', { cwd: dirPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch { /* no git remote */ }

  const claudeMdExists = existsSync(join(dirPath, 'CLAUDE.md'))

  return { repoUrl, claudeMdExists }
}

// ─── Planning ───────────────────────────────────────────────────────────────

function canonicalPath(domain: string, slug: string): string {
  return join(homedir(), 'Projects', domain, slug)
}

function planMigration(project: Project, _options: MigrateOptions): MigrationPlan {
  const target = canonicalPath(project.domain, project.slug)

  // Already has local_path set
  if (project.local_path) {
    // Check if it's already at the canonical location
    if (project.local_path === target) {
      return { project, action: 'skip_already_canonical', reason: `Already at ${target}` }
    }
    return { project, action: 'skip_has_path', reason: `local_path already set: ${project.local_path}` }
  }

  // Try to find on disk
  const found = findProjectOnDisk(project.slug, project.name)
  if (!found) {
    return { project, action: 'skip_not_found', reason: 'Could not find project directory on disk' }
  }

  // Found it — check if already at canonical location
  if (found === target) {
    return { project, action: 'skip_already_canonical', sourcePath: found, targetPath: target, reason: 'Already at canonical location (needs DB update)' }
  }

  return {
    project,
    action: _options.useSymlink ? 'symlink' : 'move',
    sourcePath: found,
    targetPath: target,
  }
}

// ─── Execution ──────────────────────────────────────────────────────────────

async function executePlan(plan: MigrationPlan, data: DataAdapter, options: MigrateOptions): Promise<void> {
  const { project, action, sourcePath, targetPath } = plan

  if (action === 'skip_has_path' || action === 'skip_not_found') {
    return // Nothing to do
  }

  if (action === 'skip_already_canonical' && sourcePath && targetPath) {
    // Just update DB
    if (!options.dryRun) {
      const stack = detectStack(targetPath)
      const { repoUrl, claudeMdExists } = detectProjectMeta(targetPath)
      await data.updateProject(project.id, {
        local_path: targetPath,
        stack,
        claude_md_exists: claudeMdExists,
        infrastructure: {
          ...project.infrastructure,
          ...(repoUrl ? { repo_url: repoUrl } : {}),
        },
      })
    }
    return
  }

  if (!sourcePath || !targetPath) return

  if (!options.dryRun) {
    // Ensure parent directory exists
    const parentDir = join(targetPath, '..')
    await mkdir(parentDir, { recursive: true })

    if (action === 'symlink') {
      // Create symlink from canonical path to source
      if (existsSync(targetPath)) {
        console.log(`    Target already exists: ${targetPath} — skipping`)
        return
      }
      await symlink(sourcePath, targetPath, 'dir')
    } else if (action === 'move') {
      if (existsSync(targetPath)) {
        console.log(`    Target already exists: ${targetPath} — skipping`)
        return
      }
      await rename(sourcePath, targetPath)
    }

    // Update DB with registration info
    const actualPath = action === 'symlink' ? sourcePath : targetPath
    const stack = detectStack(actualPath)
    const { repoUrl, claudeMdExists } = detectProjectMeta(actualPath)

    await data.updateProject(project.id, {
      local_path: targetPath,
      stack,
      claude_md_exists: claudeMdExists,
      infrastructure: {
        ...project.infrastructure,
        ...(repoUrl ? { repo_url: repoUrl } : {}),
      },
    })
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function migrateProjects(data: DataAdapter, options: MigrateOptions): Promise<void> {
  console.log()
  console.log(options.dryRun ? '  Project Migration (dry run)' : '  Project Migration (live)')
  console.log('  ' + '─'.repeat(50))

  // 1. Fetch all projects
  const projects = await data.listProjects()
  console.log(`  Found ${projects.length} project(s)\n`)

  if (projects.length === 0) {
    console.log('  No projects to migrate.')
    return
  }

  // 2. Plan each migration
  const plans = projects.map(p => planMigration(p, options))

  // 3. Display plans
  const actionable = plans.filter(p => p.action === 'move' || p.action === 'symlink' || (p.action === 'skip_already_canonical' && p.sourcePath))
  const skippedHasPath = plans.filter(p => p.action === 'skip_has_path')
  const skippedNotFound = plans.filter(p => p.action === 'skip_not_found')
  const skippedCanonical = plans.filter(p => p.action === 'skip_already_canonical' && !p.sourcePath)

  if (skippedHasPath.length > 0) {
    console.log(`  Already registered (${skippedHasPath.length}):`)
    for (const p of skippedHasPath) {
      console.log(`    - ${p.project.name} → ${p.project.local_path}`)
    }
    console.log()
  }

  if (skippedCanonical.length > 0) {
    console.log(`  Already canonical (${skippedCanonical.length}):`)
    for (const p of skippedCanonical) {
      console.log(`    - ${p.project.name}`)
    }
    console.log()
  }

  if (skippedNotFound.length > 0) {
    console.log(`  Not found on disk (${skippedNotFound.length}):`)
    for (const p of skippedNotFound) {
      console.log(`    - ${p.project.name} (slug: ${p.project.slug})`)
    }
    console.log()
  }

  if (actionable.length > 0) {
    console.log(`  Will ${options.useSymlink ? 'symlink' : 'move'} (${actionable.length}):`)
    for (const p of actionable) {
      const verb = p.action === 'skip_already_canonical' ? 'register' : p.action
      console.log(`    - ${p.project.name}`)
      console.log(`      ${verb}: ${p.sourcePath} → ${p.targetPath}`)
    }
    console.log()
  } else {
    console.log('  Nothing to migrate.\n')
    return
  }

  // 4. Execute if not dry run
  if (!options.dryRun) {
    console.log('  Executing...\n')
    for (const plan of actionable) {
      try {
        await executePlan(plan, data, options)
        const verb = plan.action === 'skip_already_canonical' ? 'Registered' : plan.action === 'symlink' ? 'Symlinked' : 'Moved'
        console.log(`    ✓ ${verb}: ${plan.project.name}`)
      } catch (err) {
        console.error(`    ✗ Failed: ${plan.project.name} — ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    console.log()
  } else {
    console.log('  Run without --dry-run (use --live) to execute. Add --symlink for symlinks instead of moves.\n')
  }
}

// ─── Standalone entry point ─────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const useSymlink = args.includes('--symlink')
  const isLive = args.includes('--live') || useSymlink
  const dryRun = !isLive

  // Boot runtime to get DataAdapter
  const { join: pathJoin } = await import('node:path')
  const { HUGHMANN_HOME, loadConfig } = await import('../config.js')
  const { loadEnvFile } = await import('../util/env.js')
  const envPath = pathJoin(HUGHMANN_HOME, '.env')
  if (existsSync(envPath)) {
    loadEnvFile(envPath)
  }

  const config = loadConfig()
  const dataEngine = config.infrastructure?.dataEngine ?? 'none'

  let data: DataAdapter | undefined

  if (dataEngine === 'supabase' || (process.env.SUPABASE_URL && process.env.SUPABASE_KEY)) {
    const { SupabaseAdapter } = await import('../adapters/data/supabase.js')
    const adapter = new SupabaseAdapter({
      url: process.env.SUPABASE_URL!,
      key: process.env.SUPABASE_KEY!,
    })
    const result = await adapter.init()
    if (result.success) {
      data = adapter
    } else {
      console.error(`  Failed to connect to Supabase: ${result.error}`)
      process.exit(1)
    }
  } else if (dataEngine === 'sqlite') {
    const { SQLiteAdapter } = await import('../adapters/data/sqlite.js')
    const adapter = new SQLiteAdapter(HUGHMANN_HOME)
    const result = await adapter.init()
    if (result.success) {
      data = adapter
    } else {
      console.error(`  Failed to connect to SQLite: ${result.error}`)
      process.exit(1)
    }
  } else if (dataEngine === 'turso') {
    const { TursoAdapter } = await import('../adapters/data/turso.js')
    const adapter = new TursoAdapter({
      url: process.env.TURSO_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    })
    const result = await adapter.init()
    if (result.success) {
      data = adapter
    } else {
      console.error(`  Failed to connect to Turso: ${result.error}`)
      process.exit(1)
    }
  }

  if (!data) {
    console.error('  No data adapter available. Configure a data engine first.')
    process.exit(1)
  }

  await migrateProjects(data, { dryRun, useSymlink })
}

// Run if invoked directly
const isDirectRun = process.argv[1]?.includes('migrate-projects')
if (isDirectRun) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
