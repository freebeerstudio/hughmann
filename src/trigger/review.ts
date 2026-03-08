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
  buildPyramidContext,
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

    const pyramidContext = await buildPyramidContext(client)

    let systemPrompt = buildCloudPrompt(context)
    systemPrompt += '\n\n---\n\n' + pyramidContext
    if (memories) {
      systemPrompt += '\n\n---\n\n## This Week\'s Memory\n\n' + memories
    }

    const prompt = `Generate my weekly review. Include:

1. **Domain Goal Progress** — For each domain goal, are projects making real progress? Honest assessment.
2. **Project North Star Check** — For each active project, how close are we? Any guardrail violations?
3. **Wins** — Things that went well, progress made toward North Stars
4. **Challenges** — What was difficult, blockers encountered, things that took longer than expected
5. **Agent Performance** — How did the agent team perform this week? Tasks completed, quality of work.
6. **Next Week Focus** — Top 3 Big Rocks for next week based on project North Stars
7. **Habit Check** — Based on what you know about my daily habits (walk, workout, meditation, inbox zero, reading, calorie deficit, system updates), any observations

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
