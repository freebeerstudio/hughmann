/**
 * Shared utilities for Trigger.dev cloud tasks.
 * These run in the cloud without access to local files.
 * All context comes from Supabase.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Re-export shared task execution utilities for cloud tasks
export { buildTaskPrompt, selectBestTask, recordTaskResult } from '../runtime/task-executor.js'

let _client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY required for cloud tasks')
  }

  _client = createClient(url, key)
  return _client
}

/**
 * Load context documents from Supabase context_docs table.
 * These are synced from local ~/.hughmann/context/ files.
 */
export async function loadCloudContext(client: SupabaseClient): Promise<{
  soul: string
  owner: string
  masterPlan: string | null
  capabilities: string | null
  domains: Map<string, { name: string; slug: string; isolation: string; content: string }>
  systemName: string
  timezone: string
}> {
  const { data: docs } = await client
    .from('context_docs')
    .select('*')
    .order('doc_type')

  const context = {
    soul: '',
    owner: '',
    masterPlan: null as string | null,
    capabilities: null as string | null,
    domains: new Map<string, { name: string; slug: string; isolation: string; content: string }>(),
    systemName: 'Hugh Mann',
    timezone: 'America/Chicago',
  }

  for (const doc of docs ?? []) {
    switch (doc.doc_type) {
      case 'soul':
        context.soul = doc.content
        // Extract system name from soul doc
        const nameMatch = doc.content.match(/^#\s+(.+)/m)
        if (nameMatch) context.systemName = nameMatch[1]
        break
      case 'owner':
        context.owner = doc.content
        // Extract timezone
        const tzMatch = doc.content.match(/timezone[:\s]+([A-Za-z/_]+)/i)
        if (tzMatch) context.timezone = tzMatch[1]
        break
      case 'master-plan':
        context.masterPlan = doc.content
        break
      case 'capabilities':
        context.capabilities = doc.content
        break
      case 'domain':
        if (doc.domain_slug) {
          context.domains.set(doc.domain_slug, {
            name: doc.title,
            slug: doc.domain_slug,
            isolation: doc.isolation_zone ?? 'personal',
            content: doc.content,
          })
        }
        break
    }
  }

  return context
}

/**
 * Build a system prompt from cloud-loaded context.
 */
export function buildCloudPrompt(
  context: Awaited<ReturnType<typeof loadCloudContext>>,
  activeDomain?: string,
): string {
  const sections: string[] = []

  if (context.soul) sections.push(context.soul)
  if (context.owner) sections.push(context.owner)
  if (context.capabilities) sections.push(context.capabilities)

  // Domain context
  if (activeDomain) {
    const domain = context.domains.get(activeDomain)
    if (domain) {
      sections.push(`## Active Domain: ${domain.name} [${domain.isolation.toUpperCase()}]\n\n${domain.content}`)
    }
  }

  if (context.masterPlan) sections.push(context.masterPlan)

  // Environment
  const now = new Date()
  sections.push([
    '---',
    '## Environment',
    `- **Current time**: ${now.toLocaleString('en-US', { timeZone: context.timezone })}`,
    `- **Timezone**: ${context.timezone}`,
    `- **Active domain**: ${activeDomain ?? 'None (general)'}`,
    `- **Mode**: autonomous (cloud)`,
  ].join('\n'))

  return sections.join('\n\n---\n\n')
}

/**
 * Get recent domain-filtered memories from Supabase.
 */
export async function getCloudMemories(
  client: SupabaseClient,
  days: number = 3,
  domain?: string,
): Promise<string> {
  const since = new Date()
  since.setDate(since.getDate() - days)

  let query = client
    .from('memories')
    .select('content, domain, memory_date')
    .gte('memory_date', since.toISOString().split('T')[0])
    .order('created_at', { ascending: false })
    .limit(20)

  if (domain) {
    query = query.eq('domain', domain)
  }

  const { data } = await query
  if (!data || data.length === 0) return ''

  return data.map(m => {
    const tag = m.domain ? ` [${m.domain}]` : ''
    return `**${m.memory_date}${tag}**\n${m.content}`
  }).join('\n\n---\n\n')
}

/**
 * Call model via OpenRouter (Claude OAuth won't work in cloud).
 */
export async function callModel(
  systemPrompt: string,
  userMessage: string,
  options?: { model?: string; maxTokens?: number },
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required for cloud tasks')

  const model = options?.model ?? 'anthropic/claude-sonnet-4-6'

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://hughmann.ai',
      'X-Title': 'HughMann',
    },
    body: JSON.stringify({
      model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status} ${response.statusText}`)
  }

  const json = await response.json() as { choices: { message: { content: string } }[] }
  return json.choices[0]?.message?.content ?? ''
}

/**
 * Send a message via Telegram.
 */
export async function sendTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) return

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }),
  }).catch(() => {}) // Best-effort
}
