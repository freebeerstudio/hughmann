/**
 * Trigger.dev scheduled task: Content Radar
 *
 * Runs weekly on Sunday at 8:00 AM CST. Fetches RSS feeds from active
 * content sources, scores article relevance against active topics via LLM,
 * creates content ideas in the database, and sends a Telegram summary.
 */

import { schedules } from '@trigger.dev/sdk/v3'
import { getSupabaseClient, callModel, sendTelegram } from './utils.js'

interface RssArticle {
  title: string
  url: string
  summary: string
  source: string
  pubDate: string | null
}

/**
 * Parse RSS 2.0 or Atom XML into articles.
 * Minimal XML parsing without external dependencies.
 */
function parseRssXml(xml: string, sourceName: string): RssArticle[] {
  const articles: RssArticle[] = []
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  // Try RSS 2.0 <item> elements
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]
    const title = extractTag(item, 'title')
    const link = extractTag(item, 'link') || extractAtomLink(item)
    const description = extractTag(item, 'description') || extractTag(item, 'summary')
    const pubDate = extractTag(item, 'pubDate') || extractTag(item, 'published') || extractTag(item, 'updated')

    if (!title || !link) continue

    // Skip articles older than 7 days
    if (pubDate) {
      const date = new Date(pubDate)
      if (!isNaN(date.getTime()) && date.getTime() < sevenDaysAgo) continue
    }

    articles.push({
      title: stripHtml(title),
      url: link.trim(),
      summary: stripHtml(description ?? '').slice(0, 500),
      source: sourceName,
      pubDate,
    })
  }

  // If no RSS items found, try Atom <entry> elements
  if (articles.length === 0) {
    const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi
    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1]
      const title = extractTag(entry, 'title')
      const link = extractAtomLink(entry) || extractTag(entry, 'link')
      const summary = extractTag(entry, 'summary') || extractTag(entry, 'content')
      const pubDate = extractTag(entry, 'published') || extractTag(entry, 'updated')

      if (!title || !link) continue

      if (pubDate) {
        const date = new Date(pubDate)
        if (!isNaN(date.getTime()) && date.getTime() < sevenDaysAgo) continue
      }

      articles.push({
        title: stripHtml(title),
        url: link.trim(),
        summary: stripHtml(summary ?? '').slice(0, 500),
        source: sourceName,
        pubDate,
      })
    }
  }

  return articles
}

function extractTag(xml: string, tag: string): string | null {
  // Try CDATA first
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i')
  const cdataMatch = xml.match(cdataRegex)
  if (cdataMatch) return cdataMatch[1].trim()

  // Then try regular content
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(regex)
  return match ? match[1].trim() : null
}

function extractAtomLink(xml: string): string | null {
  const match = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i)
  return match ? match[1] : null
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()
}

/**
 * Fetch and parse an RSS feed. Returns empty array on failure.
 */
async function fetchRssFeed(url: string, sourceName: string): Promise<RssArticle[]> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'HughMann/1.0 Content Radar' },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) return []

  const xml = await response.text()
  return parseRssXml(xml, sourceName)
}

export const contentRadar = schedules.task({
  id: 'content-radar',
  cron: '0 13 * * 0', // Sunday 8:00 AM CST = 13:00 UTC
  run: async () => {
    const client = getSupabaseClient()

    // 1. Fetch active sources
    const { data: sources } = await client
      .from('content_sources')
      .select('*')
      .eq('active', true)

    if (!sources?.length) {
      return { success: true, ideas: 0, message: 'No active sources' }
    }

    // 2. Fetch active topics
    const { data: topics } = await client
      .from('topics')
      .select('*')
      .eq('active', true)

    if (!topics?.length) {
      return { success: true, ideas: 0, message: 'No active topics' }
    }

    // 3. Fetch RSS feeds (best-effort, skip failures)
    const articles: RssArticle[] = []
    for (const source of sources) {
      if (source.type !== 'rss' || !source.url) continue
      try {
        const items = await fetchRssFeed(source.url, source.name)
        articles.push(...items)
      } catch {
        // Skip failed feeds silently
      }
    }

    if (!articles.length) {
      return { success: true, ideas: 0, message: 'No new articles found' }
    }

    // 4. Deduplicate against existing content by URL
    const { data: existing } = await client
      .from('content')
      .select('source_material')

    const existingUrls = new Set(
      (existing ?? []).flatMap((c: Record<string, unknown>) => {
        const sm = Array.isArray(c.source_material) ? c.source_material : []
        return sm.map((s: { url: string }) => s.url)
      })
    )

    const newArticles = articles
      .filter(a => !existingUrls.has(a.url))
      .slice(0, 50) // Cap at 50 per run

    if (!newArticles.length) {
      return { success: true, ideas: 0, message: 'All articles already seen' }
    }

    // 5. Score relevance via LLM
    const topicList = topics.map((t: { name: string; description: string | null }) =>
      `- ${t.name}: ${t.description || 'No description'}`
    ).join('\n')

    const articleList = newArticles.map((a, i) =>
      `${i + 1}. "${a.title}" (${a.source})\n   ${a.summary.slice(0, 200)}`
    ).join('\n\n')

    const scoringPrompt = `You are a content curator for Free Beer Studio, a web design/development studio that writes about AI, automation, small business technology, content marketing, and web development.

Your job is to find articles that could inspire blog posts, LinkedIn posts, or newsletter content. Be generous — if an article could be spun into useful content for small business owners or tech-savvy entrepreneurs, include it.

## Our Topics
${topicList}

## Articles to Score
${articleList}

Score each article's relevance to each topic (0.0 to 1.0). Include any match scoring 0.4 or above.

For each match, suggest a content angle — how would Free Beer Studio write about this for their audience of small business owners and entrepreneurs?

Output a JSON array:
[{ "article_index": 1, "topic_name": "Topic Name", "relevance": 0.7, "angle": "How small businesses can use this to..." }]

Be generous with matching — we'd rather review and reject than miss good ideas. Aim for 10-20 matches from this batch.

Return ONLY the JSON array, no other text.`

    let matches: { article_index: number; topic_name: string; relevance: number; angle: string }[] = []
    try {
      const response = await callModel(
        'You are a content relevance scoring assistant. Return only valid JSON.',
        scoringPrompt,
        { maxTokens: 2048 },
      )
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (jsonMatch) matches = JSON.parse(jsonMatch[0])
    } catch {
      // If scoring fails, skip — don't create unscored ideas
      return { success: true, ideas: 0, message: 'LLM scoring failed' }
    }

    // 6. Create content rows for matches
    let created = 0
    for (const match of matches) {
      const article = newArticles[match.article_index - 1]
      if (!article) continue

      const topic = topics.find((t: { name: string }) =>
        t.name.toLowerCase() === match.topic_name.toLowerCase()
      )

      const { error } = await client.from('content').insert({
        domain: 'fbs',
        title: `${article.title}${match.angle ? ` — ${match.angle}` : ''}`,
        topic_id: topic?.id ?? null,
        status: 'idea',
        platform: 'blog',
        source_material: [{ url: article.url, title: article.title, summary: article.summary }],
        created_by: 'radar',
      })

      if (!error) created++
    }

    // 7. Send Telegram summary (best-effort)
    if (created > 0) {
      const summary = [
        `*Content Radar Report*`,
        `Scanned ${sources.length} sources, found ${newArticles.length} new articles`,
        `Created ${created} content ideas from ${matches.length} relevant matches`,
        '',
        'Top ideas:',
        ...matches.slice(0, 5).map(m => {
          const article = newArticles[m.article_index - 1]
          return article ? `• ${article.title} (${(m.relevance * 100).toFixed(0)}%)` : ''
        }).filter(Boolean),
      ].join('\n')

      await sendTelegram(summary).catch(() => {})
    }

    return { success: true, ideas: created, articles_scanned: newArticles.length, matches: matches.length }
  },
})
