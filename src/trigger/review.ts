/**
 * Trigger.dev scheduled task: Weekly Review
 *
 * Runs Fridays at 9:00 AM CST. Reviews the week's progress,
 * identifies patterns, and plans the upcoming week.
 */

import { schedules } from '@trigger.dev/sdk/v3'
import {
  getSupabaseClient,
  loadCloudContext,
  buildCloudPrompt,
  getCloudMemories,
  callModel,
  sendTelegram,
} from './utils.js'

export const weeklyReview = schedules.task({
  id: 'weekly-review',
  cron: '0 14 * * 5', // 9:00 AM CST Friday = 14:00 UTC
  run: async () => {
    const client = getSupabaseClient()
    const context = await loadCloudContext(client)
    const memories = await getCloudMemories(client, 7) // Full week

    let systemPrompt = buildCloudPrompt(context)
    if (memories) {
      systemPrompt += '\n\n---\n\n## This Week\'s Memory\n\n' + memories
    }

    const prompt = `Generate my weekly review. Include:

1. **Week Summary** — High-level overview of what happened this week across all domains
2. **Wins** — Things that went well, progress made, goals hit
3. **Challenges** — What was difficult, blockers encountered, things that took longer than expected
4. **Patterns** — Any recurring themes, habits (good or bad), or trends worth noting
5. **Next Week Focus** — Top 3 priorities for the upcoming week
6. **Habit Check** — Based on what you know about my daily habits (walk, workout, meditation, inbox zero, reading, calorie deficit, system updates), any observations

Be thorough but organized. This is a 3-5 minute read.`

    const result = await callModel(systemPrompt, prompt, {
      maxTokens: 6000,
    })

    // Save to memories
    await client.from('memories').insert({
      session_id: `trigger-review-${new Date().toISOString().split('T')[0]}`,
      domain: null,
      content: result,
      memory_date: new Date().toISOString().split('T')[0],
    })

    // Push to Telegram
    await sendTelegram(`📋 *Weekly Review*\n\n${result}`)

    return { success: true, length: result.length }
  },
})
