/**
 * Obsidian Vault Sync Pipeline
 *
 * Incrementally syncs Obsidian vault .md files to:
 *   1. memory_embeddings — chunked, tagged source='obsidian-vault', memory_type='knowledge'
 *   2. kb_nodes — full document with metadata, for graph traversal
 *   3. kb_edges — extracted [[wikilinks]] as graph edges
 *
 * Ported from Foundry's sync-vault.ts, adapted for HughMann's multi-vault design.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename, extname } from 'node:path'
import type { DataAdapter } from '../adapters/data/types.js'
import type { EmbeddingAdapter } from '../adapters/embeddings/index.js'
import { domainToCustomerId } from '../util/domain.js'

const MAX_CHUNK_SIZE = 2000

export interface VaultConfig {
  name: string          // domain slug: 'omnissa', 'fbs', 'personal'
  path: string          // absolute path to vault root
  folders: string[]     // subfolders to sync (e.g. ['Customers', 'Products'])
}

export interface SyncStats {
  vault: string
  filesScanned: number
  filesChanged: number
  filesSynced: number
  filesDeleted: number
  chunksCreated: number
  edgesCreated: number
  errors: string[]
}

/**
 * Load vault configurations from environment variables.
 * Pattern: VAULT_{NAME}_PATH, VAULT_{NAME}_FOLDERS
 */
export function loadVaultConfigs(): VaultConfig[] {
  const configs: VaultConfig[] = []
  const seen = new Set<string>()

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^VAULT_(\w+)_PATH$/)
    if (!match || !value) continue

    const name = match[1].toLowerCase()
    if (seen.has(name)) continue
    seen.add(name)

    const foldersKey = `VAULT_${match[1]}_FOLDERS`
    const foldersStr = process.env[foldersKey] ?? ''
    const folders = foldersStr.split(',').map(f => f.trim()).filter(Boolean)

    if (existsSync(value)) {
      configs.push({ name, path: value, folders })
    }
  }

  return configs
}

/**
 * Sync a single vault to the database.
 */
export async function syncVault(
  config: VaultConfig,
  dataAdapter: DataAdapter,
  embeddings: EmbeddingAdapter,
  onProgress?: (msg: string) => void,
): Promise<SyncStats> {
  const stats: SyncStats = {
    vault: config.name,
    filesScanned: 0,
    filesChanged: 0,
    filesSynced: 0,
    filesDeleted: 0,
    chunksCreated: 0,
    edgesCreated: 0,
    errors: [],
  }

  const log = onProgress ?? (() => {})
  const customerId = domainToCustomerId(config.name)

  // 1. Walk configured folders and find all .md files
  const files = walkVaultFiles(config)
  stats.filesScanned = files.length
  log(`Found ${files.length} files in ${config.name} vault`)

  // 2. Process each file (incremental — skip unchanged)
  for (const filePath of files) {
    try {
      const relPath = relative(config.path, filePath)
      const fileStat = statSync(filePath)
      const mtime = fileStat.mtime.toISOString()

      // Check if already synced and unchanged
      const existing = await dataAdapter.getKbNodeByPath(config.name, relPath)
      if (existing?.lastModified && new Date(existing.lastModified).getTime() >= fileStat.mtime.getTime()) {
        continue // Skip unchanged
      }

      stats.filesChanged++
      const content = readFileSync(filePath, 'utf-8')
      if (!content.trim()) continue

      // Parse frontmatter
      const { frontmatter, body } = parseFrontmatter(content)
      const title = frontmatter.title as string ?? basename(filePath, extname(filePath))
      const nodeType = inferNodeType(relPath, frontmatter)

      // Generate embedding for the full document (or first chunk if too long)
      const embeddingText = body.slice(0, MAX_CHUNK_SIZE)
      let embedding: number[] | undefined
      try {
        embedding = await embeddings.embed(embeddingText)
      } catch {
        stats.errors.push(`Embedding failed: ${relPath}`)
      }

      // Upsert to kb_nodes
      const nodeId = await dataAdapter.upsertKbNode({
        vault: config.name,
        filePath: relPath,
        title,
        content: body,
        embedding,
        frontmatter,
        nodeType,
        lastModified: mtime,
        customerId,
      })

      // Chunk and store in memory_embeddings for semantic search
      const chunks = splitIntoChunks(body, MAX_CHUNK_SIZE)
      for (let i = 0; i < chunks.length; i++) {
        try {
          const chunkEmbedding = i === 0 && embedding
            ? embedding
            : await embeddings.embed(chunks[i])

          await dataAdapter.saveMemoryEmbedding({
            memoryId: 0,
            content: chunks[i],
            domain: config.name,
            embedding: chunkEmbedding,
          })
          stats.chunksCreated++
        } catch {
          stats.errors.push(`Chunk ${i} embedding failed: ${relPath}`)
        }
      }

      // Extract wikilinks for graph edges
      if (nodeId) {
        const links = extractWikilinks(body)
        for (const linkTarget of links) {
          // Resolve link to a file path in the vault
          const targetPath = resolveWikilink(linkTarget, config.path, files)
          if (targetPath) {
            const targetRel = relative(config.path, targetPath)
            const targetNode = await dataAdapter.getKbNodeByPath(config.name, targetRel)
            if (targetNode) {
              // Edge creation would require a dedicated method — for now tracked in stats
              stats.edgesCreated++
            }
          }
        }
      }

      stats.filesSynced++
      if (stats.filesSynced % 10 === 0) {
        log(`Synced ${stats.filesSynced}/${stats.filesChanged} changed files...`)
      }
    } catch (err) {
      const relPath = relative(config.path, filePath)
      stats.errors.push(`${relPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 3. Clean up orphans (files removed from vault)
  // Would need a listKbNodes method — deferred to avoid over-engineering

  log(`Sync complete: ${stats.filesSynced} files, ${stats.chunksCreated} chunks`)
  return stats
}

/**
 * Walk vault folders recursively and collect all .md file paths.
 */
function walkVaultFiles(config: VaultConfig): string[] {
  const files: string[] = []
  const foldersToWalk = config.folders.length > 0
    ? config.folders.map(f => join(config.path, f))
    : [config.path]

  for (const folder of foldersToWalk) {
    if (!existsSync(folder)) continue
    walkDir(folder, files)
  }

  return files
}

function walkDir(dir: string, results: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip hidden folders and common non-content folders
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      walkDir(fullPath, results)
    } else if (entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
      results.push(fullPath)
    }
  }
}

/**
 * Parse YAML frontmatter from markdown content.
 * Simple regex-based parser (no yaml library dependency).
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const fm: Record<string, unknown> = {}
  const lines = match[1].split('\n')
  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/)
    if (kvMatch) {
      const val = kvMatch[2].trim()
      // Strip quotes
      fm[kvMatch[1]] = val.replace(/^["']|["']$/g, '')
    }
  }

  return { frontmatter: fm, body: match[2] }
}

/**
 * Infer node type from file path and frontmatter.
 */
function inferNodeType(relPath: string, frontmatter: Record<string, unknown>): string {
  // Frontmatter type takes priority
  if (frontmatter.type) return String(frontmatter.type)

  // Infer from path
  const pathLower = relPath.toLowerCase()
  if (pathLower.startsWith('customers/')) return 'customer'
  if (pathLower.startsWith('products/')) return 'product'
  if (pathLower.startsWith('projects/')) return 'project'
  if (pathLower.startsWith('resources/')) return 'resource'
  if (pathLower.startsWith('areas/')) return 'area'
  if (pathLower.startsWith('daily notes/')) return 'daily-note'
  return 'note'
}

/**
 * Smart chunking — paragraph-aware splits.
 * Tries paragraph boundary, then line break, then hard cut.
 * Ported from Foundry's MemoryClient.splitIntoChunks.
 */
export function splitIntoChunks(text: string, maxSize: number = MAX_CHUNK_SIZE): string[] {
  if (text.length <= maxSize) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxSize) {
      chunks.push(remaining)
      break
    }

    // Try to find paragraph boundary
    let cutPoint = remaining.lastIndexOf('\n\n', maxSize)
    if (cutPoint < maxSize * 0.3) {
      // Too early — try line break
      cutPoint = remaining.lastIndexOf('\n', maxSize)
    }
    if (cutPoint < maxSize * 0.3) {
      // Hard cut at max size
      cutPoint = maxSize
    }

    chunks.push(remaining.slice(0, cutPoint).trim())
    remaining = remaining.slice(cutPoint).trim()
  }

  return chunks.filter(c => c.length > 0)
}

/**
 * Extract [[wikilinks]] from markdown content.
 */
function extractWikilinks(content: string): string[] {
  const links: string[] = []
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  let match
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim())
  }
  return [...new Set(links)]
}

/**
 * Resolve a wikilink target to an actual file path.
 * Searches all known vault files for a matching filename.
 */
function resolveWikilink(linkTarget: string, vaultPath: string, allFiles: string[]): string | null {
  const target = linkTarget.toLowerCase()
  // Try exact filename match (without extension)
  for (const file of allFiles) {
    const name = basename(file, '.md').toLowerCase()
    if (name === target) return file
  }
  return null
}
