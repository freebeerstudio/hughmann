#!/usr/bin/env node
/**
 * HughMann MCP Server
 *
 * Exposes HughMann capabilities as MCP tools that any MCP client
 * (Claude Code, Cursor, etc.) can use. Run via:
 *   hughmann serve
 *   npx tsx src/mcp-server.ts
 *
 * Provides tools for:
 *   - chat: Send a message and get a response
 *   - run_skill: Execute a built-in or custom skill
 *   - list_skills: List available skills
 *   - list_domains: List configured domains
 *   - set_domain: Switch active domain
 *   - get_status: Get current session and domain info
 *   - search_memory: Search recent memories
 *   - distill: Distill current session into memory
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { boot } from './runtime/boot.js'
import type { Runtime } from './runtime/runtime.js'

let runtime: Runtime | null = null

async function getRuntime(): Promise<Runtime> {
  if (runtime) return runtime

  const result = await boot()
  if (!result.success || !result.runtime) {
    throw new Error(`Boot failed: ${result.errors.join(', ')}`)
  }

  await result.runtime.initSession()
  runtime = result.runtime
  return runtime
}

// ─── Server Setup ──────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'hughmann', version: '0.1.0' },
  { capabilities: { tools: { listChanged: false } } },
)

// ─── Tools ─────────────────────────────────────────────────────────────────

server.tool(
  'chat',
  'Send a message to Hugh Mann and get a response. Use for conversation, questions, or requests.',
  { message: z.string().describe('The message to send') },
  async ({ message }) => {
    const rt = await getRuntime()
    const response = await rt.chat(message)
    return { content: [{ type: 'text', text: response }] }
  },
)

server.tool(
  'run_skill',
  'Execute a HughMann skill (e.g. morning dashboard, weekly review, status check). Skills are predefined routines.',
  {
    skill_id: z.string().describe('The skill ID to run (e.g. "morning", "status", "review")'),
    extra_context: z.string().optional().describe('Additional context or instructions for the skill'),
  },
  async ({ skill_id, extra_context }) => {
    const rt = await getRuntime()
    const skill = rt.skills.get(skill_id)
    if (!skill) {
      const available = rt.skills.list().map(s => s.id).join(', ')
      return {
        content: [{ type: 'text', text: `Unknown skill: ${skill_id}. Available: ${available}` }],
        isError: true,
      }
    }

    // Auto-switch domain if skill requires it
    const prevDomain = rt.activeDomain
    if (skill.domain) {
      try { rt.setDomain(skill.domain) } catch { /* proceed */ }
    }

    let prompt = skill.prompt
    if (extra_context) {
      prompt += `\n\nAdditional context: ${extra_context}`
    }

    let result: string
    if (skill.complexity === 'autonomous') {
      // Collect full output from autonomous task
      const chunks: string[] = []
      for await (const chunk of rt.doTaskStream(prompt, { maxTurns: skill.maxTurns })) {
        if (chunk.type === 'text') chunks.push(chunk.content)
      }
      result = chunks.join('')
    } else {
      result = await rt.chat(prompt)
    }

    // Restore domain
    if (skill.domain && prevDomain !== rt.activeDomain) {
      rt.setDomain(prevDomain)
    }

    return { content: [{ type: 'text', text: result }] }
  },
)

server.tool(
  'list_skills',
  'List all available HughMann skills with their descriptions and complexity levels.',
  async () => {
    const rt = await getRuntime()
    const skills = rt.skills.list()

    const lines = skills.map(s => {
      const tier = s.complexity === 'autonomous' ? '[opus+tools]'
        : s.complexity === 'lightweight' ? '[haiku]'
        : '[sonnet]'
      const domain = s.domain ? ` (domain: ${s.domain})` : ''
      const builtin = s.builtin ? '' : ' [custom]'
      return `- ${s.id}: ${s.description} ${tier}${domain}${builtin}`
    })

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'list_domains',
  'List all configured domains with their isolation status.',
  async () => {
    const rt = await getRuntime()
    const domains = rt.getAvailableDomains()
    const active = rt.activeDomain

    const lines = domains.map(d => {
      const marker = d.slug === active ? ' ← active' : ''
      return `- ${d.name} (${d.domainType}) [${d.isolation}]${marker}`
    })

    if (!active) {
      lines.push('\nNo domain currently active (general context).')
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'set_domain',
  'Switch the active domain context. Use null/empty to clear domain.',
  { domain: z.string().describe('Domain slug to switch to, or "none" to clear') },
  async ({ domain }) => {
    const rt = await getRuntime()

    try {
      if (domain === 'none' || domain === '') {
        rt.setDomain(null)
        return { content: [{ type: 'text', text: 'Domain cleared. Using general context.' }] }
      }

      rt.setDomain(domain)
      return { content: [{ type: 'text', text: `Switched to domain: ${rt.activeDomain}` }] }
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      }
    }
  },
)

server.tool(
  'get_status',
  'Get current HughMann status: active domain, session info, and system name.',
  async () => {
    const rt = await getRuntime()
    const session = rt.getSessionInfo()
    const domains = rt.getAvailableDomains()
    const systemName = rt.context.config.systemName

    const lines = [
      `System: ${systemName}`,
      `Active Domain: ${rt.activeDomain ?? 'none (general)'}`,
      `Domains: ${domains.map(d => d.name).join(', ')}`,
    ]

    if (session) {
      lines.push(`Session: ${session.title} (${session.messageCount} messages)`)
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'search_memory',
  'Search recent memories and distilled knowledge from past sessions.',
  { count: z.number().optional().describe('Number of recent memories to return (default: 5)') },
  async ({ count }) => {
    const rt = await getRuntime()
    const memories = rt.memory.getRecentMemories(count ?? 5)

    if (!memories) {
      return { content: [{ type: 'text', text: 'No memories found.' }] }
    }

    return { content: [{ type: 'text', text: memories }] }
  },
)

server.tool(
  'distill',
  'Distill the current session into memory. Extracts key facts, decisions, and learnings.',
  async () => {
    const rt = await getRuntime()
    const result = await rt.distillCurrent()

    if (!result) {
      return { content: [{ type: 'text', text: 'Nothing to distill (session too short or already distilled).' }] }
    }

    return { content: [{ type: 'text', text: `Distilled:\n\n${result}` }] }
  },
)

server.tool(
  'do_task',
  'Execute an autonomous task with full tool access (file read/write, web search, etc). For complex tasks that need the AI to take actions.',
  {
    task: z.string().describe('The task to execute'),
    max_turns: z.number().optional().describe('Maximum agent turns (default: 25)'),
  },
  async ({ task, max_turns }) => {
    const rt = await getRuntime()
    const chunks: string[] = []
    const toolLog: string[] = []

    for await (const chunk of rt.doTaskStream(task, { maxTurns: max_turns })) {
      if (chunk.type === 'text') chunks.push(chunk.content)
      if (chunk.type === 'tool_use') toolLog.push(chunk.content)
    }

    let result = chunks.join('')
    if (toolLog.length > 0) {
      result = `Tools used:\n${toolLog.map(t => `- ${t}`).join('\n')}\n\n${result}`
    }

    return { content: [{ type: 'text', text: result }] }
  },
)

server.tool(
  'reload_context',
  'Reload context documents from disk. Use after editing ~/.hughmann/context/ files.',
  async () => {
    const rt = await getRuntime()
    const result = rt.reloadContext()

    const lines = [
      `Reloaded: ${result.domainCount} domains, ${result.docCount} documents`,
    ]

    if (result.warnings.length > 0) {
      lines.push(`Warnings: ${result.warnings.join('; ')}`)
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

// ─── Start ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
