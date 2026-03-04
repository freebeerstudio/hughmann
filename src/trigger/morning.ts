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
  getCloudMemories,
  callModel,
  sendTelegram,
} from './utils.js'

export const morningDashboard = schedules.task({
  id: 'morning-dashboard',
  cron: '0 12 * * *', // 7:00 AM CST = 12:00 UTC
  run: async () => {
    const client = getSupabaseClient()
    const context = await loadCloudContext(client)
    const memories = await getCloudMemories(client, 3)

    let systemPrompt = buildCloudPrompt(context)
    if (memories) {
      systemPrompt += '\n\n---\n\n## Recent Memory\n\n' + memories
    }

    const prompt = `Generate my morning dashboard briefing. Include:

1. **Priority Focus** — What's the #1 thing I should focus on today based on recent context
2. **Active Projects** — Quick status on anything in-flight from recent conversations
3. **Reminders** — Any commitments, deadlines, or follow-ups from recent memory
4. **Energy Check** — Based on what you know about my schedule and patterns, suggest how to structure the day

Keep it concise and actionable. Use bullet points. This should take 2 minutes to read.`

    const result = await callModel(systemPrompt, prompt)

    // Save to memories table
    await client.from('memories').insert({
      session_id: `trigger-morning-${new Date().toISOString().split('T')[0]}`,
      domain: null,
      content: result,
      memory_date: new Date().toISOString().split('T')[0],
    })

    // Push to Telegram
    await sendTelegram(`☀️ *Morning Dashboard*\n\n${result}`)

    return { success: true, length: result.length }
  },
})
