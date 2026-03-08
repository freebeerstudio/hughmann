/**
 * Trigger.dev scheduled task: Morning Dashboard
 *
 * Runs daily at 7:00 AM CST. Loads context from Supabase,
 * gets recent memories, generates morning briefing, pushes to Telegram.
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
  saveBriefing,
} from './utils.js'

export const morningDashboard = schedules.task({
  id: 'morning-dashboard',
  cron: '0 12 * * *', // 7:00 AM CST = 12:00 UTC
  run: async () => {
    const client = getSupabaseClient()
    const context = await loadCloudContext(client)
    const memories = await getCloudMemories(client, 3)

    const pyramidContext = await buildPyramidContext(client)

    let systemPrompt = buildCloudPrompt(context)
    systemPrompt += '\n\n---\n\n' + pyramidContext
    if (memories) {
      systemPrompt += '\n\n---\n\n## Recent Memory\n\n' + memories
    }

    const prompt = `Generate my morning dashboard briefing. Include:

1. **Domain Goals** — Quick check: are we making progress toward each domain goal?
2. **Priority Focus** — Based on active project North Stars, what's the #1 thing I should focus on today?
3. **Active Projects** — For each active project, how close are we to the North Star? Any guardrail violations?
4. **Reminders** — Any commitments, deadlines, or follow-ups from recent memory
5. **Agent Activity** — Any tasks completed by agents overnight?

Keep it concise and actionable. Use bullet points. This should take 2 minutes to read.`

    const result = await callModel(systemPrompt, prompt)

    // Save to memories table
    await client.from('memories').insert({
      session_id: `trigger-morning-${new Date().toISOString().split('T')[0]}`,
      domain: null,
      content: result,
      memory_date: new Date().toISOString().split('T')[0],
    })

    // Save to briefings table
    await saveBriefing(client, 'morning', result)

    // Push to Telegram
    await sendTelegram(`☀️ *Morning Dashboard*\n\n${result}`)

    return { success: true, length: result.length }
  },
})
