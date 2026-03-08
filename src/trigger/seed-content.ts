/**
 * Seed initial content sources and topics into Supabase.
 * Run via: hughmann trigger seed-content
 * Or as a Trigger.dev one-shot task.
 */

import { task } from '@trigger.dev/sdk/v3'
import { getSupabaseClient } from './utils.js'

const INITIAL_SOURCES = [
  // AI & LLM Core
  { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml', type: 'rss' as const },
  { name: 'Anthropic Blog', url: 'https://www.anthropic.com/rss.xml', type: 'rss' as const },
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', type: 'rss' as const },
  { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', type: 'rss' as const },

  // AI Engineering & Dev Tools
  { name: "Simon Willison's Weblog", url: 'https://simonwillison.net/atom/everything/', type: 'rss' as const },
  { name: 'The Batch (Andrew Ng)', url: 'https://www.deeplearning.ai/the-batch/feed/', type: 'rss' as const },
  { name: 'Latent Space', url: 'https://www.latent.space/feed', type: 'rss' as const },

  // Automation & Low-Code
  { name: 'Zapier Blog', url: 'https://zapier.com/blog/feed/', type: 'rss' as const },
  { name: 'Make Blog', url: 'https://www.make.com/en/blog/feed', type: 'rss' as const },
  { name: 'n8n Blog', url: 'https://blog.n8n.io/rss/', type: 'rss' as const },

  // Business + AI
  { name: 'a16z AI', url: 'https://a16z.com/feed/', type: 'rss' as const },
  { name: "Lenny's Newsletter", url: 'https://www.lennysnewsletter.com/feed', type: 'rss' as const },
  { name: 'Stratechery', url: 'https://stratechery.com/feed/', type: 'rss' as const },

  // Startups & Tech
  { name: 'TechCrunch Startups', url: 'https://techcrunch.com/category/startups/feed/', type: 'rss' as const },
  { name: 'Y Combinator Blog', url: 'https://www.ycombinator.com/blog/rss/', type: 'rss' as const },
]

const INITIAL_TOPICS = [
  { name: 'AI Tools & Applications', description: 'New AI tools, models, and practical applications for businesses' },
  { name: 'Automation & Workflows', description: 'Business process automation, no-code/low-code platforms, integration tools' },
  { name: 'Small Business Technology', description: 'Technology solutions and trends for small businesses and local services' },
  { name: 'Content & Marketing Strategy', description: 'Content marketing, social media strategy, and digital marketing trends' },
  { name: 'Web Development & Design', description: 'Modern web development frameworks, design trends, and best practices' },
]

export const seedContent = task({
  id: 'seed-content',
  run: async () => {
    const client = getSupabaseClient()
    let sourcesCreated = 0
    let topicsCreated = 0

    // Seed sources (skip duplicates by name)
    for (const source of INITIAL_SOURCES) {
      const { data: existing } = await client
        .from('content_sources')
        .select('id')
        .eq('name', source.name)
        .limit(1)

      if (existing && existing.length > 0) continue

      const { error } = await client.from('content_sources').insert({
        domain: 'fbs',
        name: source.name,
        type: source.type,
        url: source.url,
        active: true,
      })

      if (!error) sourcesCreated++
    }

    // Seed topics (skip duplicates by name)
    for (const topic of INITIAL_TOPICS) {
      const { data: existing } = await client
        .from('topics')
        .select('id')
        .eq('name', topic.name)
        .limit(1)

      if (existing && existing.length > 0) continue

      const { error } = await client.from('topics').insert({
        domain: 'fbs',
        name: topic.name,
        description: topic.description,
        active: true,
      })

      if (!error) topicsCreated++
    }

    return {
      success: true,
      sources: { total: INITIAL_SOURCES.length, created: sourcesCreated },
      topics: { total: INITIAL_TOPICS.length, created: topicsCreated },
    }
  },
})

/**
 * Seed directly via Supabase client (for local CLI use without Trigger.dev).
 */
export async function seedContentLocally(supabaseUrl: string, supabaseKey: string): Promise<{
  sources: number
  topics: number
}> {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(supabaseUrl, supabaseKey)

  let sourcesCreated = 0
  let topicsCreated = 0

  for (const source of INITIAL_SOURCES) {
    const { data: existing } = await client
      .from('content_sources')
      .select('id')
      .eq('name', source.name)
      .limit(1)

    if (existing && existing.length > 0) continue

    const { error } = await client.from('content_sources').insert({
      domain: 'fbs',
      name: source.name,
      type: source.type,
      url: source.url,
      active: true,
    })

    if (!error) sourcesCreated++
  }

  for (const topic of INITIAL_TOPICS) {
    const { data: existing } = await client
      .from('topics')
      .select('id')
      .eq('name', topic.name)
      .limit(1)

    if (existing && existing.length > 0) continue

    const { error } = await client.from('topics').insert({
      domain: 'fbs',
      name: topic.name,
      description: topic.description,
      active: true,
    })

    if (!error) topicsCreated++
  }

  return { sources: sourcesCreated, topics: topicsCreated }
}
