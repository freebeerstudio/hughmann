import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServerConfig } from '../types/model.js'

export interface McpConfig {
  servers: Record<string, McpServerConfig>
}

/**
 * Load MCP server configuration from ~/.hughmann/mcp.json
 *
 * Format:
 * {
 *   "servers": {
 *     "google-workspace": {
 *       "command": "npx",
 *       "args": ["-y", "@anthropic-ai/google-workspace-mcp"],
 *       "env": { "GOOGLE_CLIENT_ID": "...", "GOOGLE_CLIENT_SECRET": "..." }
 *     },
 *     "filesystem": {
 *       "command": "npx",
 *       "args": ["-y", "@anthropic-ai/filesystem-mcp", "/Users/you/Documents"]
 *     }
 *   }
 * }
 */
export function loadMcpConfig(hughmannHome: string): { config: McpConfig; warnings: string[] } {
  const warnings: string[] = []
  const configPath = join(hughmannHome, 'mcp.json')

  if (!existsSync(configPath)) {
    return {
      config: { servers: {} },
      warnings: [],
    }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw)

    const servers: Record<string, McpServerConfig> = {}

    if (parsed.servers && typeof parsed.servers === 'object') {
      for (const [name, def] of Object.entries(parsed.servers)) {
        const serverDef = def as Record<string, unknown>

        if (!serverDef.command && !serverDef.url) {
          warnings.push(`MCP server "${name}": missing command or url, skipping`)
          continue
        }

        // Expand env vars in command and args
        const server: McpServerConfig = {
          command: expandEnvVars(String(serverDef.command ?? '')),
          type: serverDef.url ? 'sse' : 'stdio',
        }

        if (serverDef.args && Array.isArray(serverDef.args)) {
          server.args = serverDef.args.map((a: unknown) => expandEnvVars(String(a)))
        }

        if (serverDef.env && typeof serverDef.env === 'object') {
          server.env = {}
          for (const [k, v] of Object.entries(serverDef.env as Record<string, unknown>)) {
            server.env[k] = expandEnvVars(String(v))
          }
        }

        if (serverDef.url) {
          server.url = expandEnvVars(String(serverDef.url))
        }

        servers[name] = server
      }
    }

    return { config: { servers }, warnings }
  } catch (err) {
    warnings.push(`Failed to parse mcp.json: ${err instanceof Error ? err.message : String(err)}`)
    return { config: { servers: {} }, warnings }
  }
}

/**
 * Add an MCP server to mcp.json. Creates the file if it doesn't exist.
 * Returns true if added, false if a server with that name already exists.
 */
export function addMcpServer(
  hughmannHome: string,
  name: string,
  config: { command: string; args?: string[]; env?: Record<string, string> },
): boolean {
  const configPath = join(hughmannHome, 'mcp.json')

  let existing: Record<string, unknown> = { servers: {} }
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      existing = { servers: {} }
    }
  }

  const servers = (existing.servers ?? {}) as Record<string, unknown>
  if (servers[name]) return false

  servers[name] = {
    command: config.command,
    ...(config.args ? { args: config.args } : {}),
    ...(config.env ? { env: config.env } : {}),
  }

  existing.servers = servers
  writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
  return true
}

/**
 * Remove an MCP server from mcp.json. Returns true if removed.
 */
export function removeMcpServer(hughmannHome: string, name: string): boolean {
  const configPath = join(hughmannHome, 'mcp.json')
  if (!existsSync(configPath)) return false

  try {
    const existing = JSON.parse(readFileSync(configPath, 'utf-8'))
    const servers = existing.servers as Record<string, unknown> | undefined
    if (!servers || !servers[name]) return false
    delete servers[name]
    writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
    return true
  } catch {
    return false
  }
}

/**
 * Expand $VAR and ${VAR} references in strings using process.env.
 */
function expandEnvVars(s: string): string {
  return s.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/gi, (_, braced, plain) => {
    const varName = braced ?? plain
    return process.env[varName] ?? ''
  })
}
