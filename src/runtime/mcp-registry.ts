/**
 * Registry of known MCP servers that can be auto-installed.
 *
 * Each entry describes an npm-installable MCP server with its
 * package name, required env vars, and default configuration.
 */

export interface McpRegistryEntry {
  /** Display name */
  name: string
  /** npm package name */
  package: string
  /** Short description of what the server provides */
  description: string
  /** Keywords for matching capability gaps to servers */
  keywords: string[]
  /** Env vars required for this server to work */
  requiredEnvVars: string[]
  /** Optional env vars */
  optionalEnvVars?: string[]
  /** Default args to pass after the package name */
  defaultArgs?: string[]
  /** Whether this server needs user-specific configuration beyond env vars */
  needsUserConfig?: boolean
}

export const MCP_REGISTRY: Record<string, McpRegistryEntry> = {
  filesystem: {
    name: 'Filesystem',
    package: '@anthropic-ai/filesystem-mcp',
    description: 'Read, write, and manage files on the local filesystem',
    keywords: ['file', 'filesystem', 'read file', 'write file', 'directory', 'folder'],
    requiredEnvVars: [],
    defaultArgs: ['$HOME/Documents'],
    needsUserConfig: true,
  },
  'google-workspace': {
    name: 'Google Workspace',
    package: '@anthropic-ai/google-workspace-mcp',
    description: 'Access Gmail, Calendar, Drive, and Docs via Google Workspace APIs',
    keywords: ['gmail', 'email', 'calendar', 'google drive', 'google docs', 'google workspace'],
    requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
  },
  github: {
    name: 'GitHub',
    package: '@anthropic-ai/github-mcp',
    description: 'Interact with GitHub repos, issues, PRs, and actions',
    keywords: ['github', 'git', 'repository', 'pull request', 'issue', 'pr'],
    requiredEnvVars: ['GITHUB_TOKEN'],
  },
  slack: {
    name: 'Slack',
    package: '@anthropic-ai/slack-mcp',
    description: 'Send and read Slack messages, manage channels',
    keywords: ['slack', 'message', 'channel', 'chat', 'team communication'],
    requiredEnvVars: ['SLACK_BOT_TOKEN'],
  },
  'brave-search': {
    name: 'Brave Search',
    package: '@anthropic-ai/brave-search-mcp',
    description: 'Search the web using Brave Search API',
    keywords: ['search', 'web search', 'browse', 'internet', 'lookup'],
    requiredEnvVars: ['BRAVE_API_KEY'],
  },
  fetch: {
    name: 'Fetch',
    package: '@anthropic-ai/fetch-mcp',
    description: 'Fetch and parse web pages and APIs',
    keywords: ['fetch', 'http', 'api', 'web page', 'url', 'download', 'scrape'],
    requiredEnvVars: [],
  },
  postgres: {
    name: 'PostgreSQL',
    package: '@anthropic-ai/postgres-mcp',
    description: 'Query and manage PostgreSQL databases',
    keywords: ['postgres', 'postgresql', 'database', 'sql', 'query'],
    requiredEnvVars: ['POSTGRES_CONNECTION_STRING'],
  },
  sqlite: {
    name: 'SQLite',
    package: '@anthropic-ai/sqlite-mcp',
    description: 'Query and manage SQLite databases',
    keywords: ['sqlite', 'database', 'sql', 'local database'],
    requiredEnvVars: [],
    defaultArgs: ['$HOME/.hughmann/data/hughmann.db'],
  },
  puppeteer: {
    name: 'Puppeteer',
    package: '@anthropic-ai/puppeteer-mcp',
    description: 'Control a headless Chrome browser for web automation and screenshots',
    keywords: ['browser', 'puppeteer', 'screenshot', 'web automation', 'headless'],
    requiredEnvVars: [],
  },
}

/**
 * Find registry entries that match a capability description.
 * Uses keyword matching against the gap description.
 */
export function findMatchingServers(gapDescription: string): McpRegistryEntry[] {
  const lower = gapDescription.toLowerCase()
  const matches: { entry: McpRegistryEntry; score: number }[] = []

  for (const entry of Object.values(MCP_REGISTRY)) {
    let score = 0
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        score += keyword.length // longer matches = more specific
      }
    }
    if (score > 0) {
      matches.push({ entry, score })
    }
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .map(m => m.entry)
}
