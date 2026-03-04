/**
 * Trigger.dev scheduled task: Afternoon Closeout
 *
 * Runs daily at 4:00 PM CST. Reviews the day's progress,
 * extracts learnings, and plans tomorrow.
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

export const afternoonCloseout = schedules.task({
  id: 'afternoon-closeout',
  cron: '0 21 * * *', // 4:00 PM CST = 21:00 UTC
  run: async () => {
    const client = getSupabaseClient()
    const context = await loadCloudContext(client)
    const memories = await getCloudMemories(client, 1) // Today only

    let systemPrompt = buildCloudPrompt(context)
    if (memories) {
      systemPrompt += '\n\n---\n\n## Today\'s Activity\n\n' + memories
    }

    const prompt = `Generate my afternoon closeout review. Include:

1. **Completed Today** — What got done based on today's conversations and activity
2. **Open Items** — Anything started but not finished
3. **Key Learnings** — Any insights, decisions, or patterns worth remembering
4. **Tomorrow's Setup** — What should I prioritize first thing tomorrow

Keep it brief and focused. This is a 1-minute read at end of day.`

    const result = await callModel(systemPrompt, prompt)

    // Save to memories
    await client.from('memories').insert({
      session_id: `trigger-closeout-${new Date().toISOString().split('T')[0]}`,
      domain: null,
      content: result,
      memory_date: new Date().toISOString().split('T')[0],
    })

    // Push to Telegram
    await sendTelegram(`🌙 *Afternoon Closeout*\n\n${result}`)

    return { success: true, length: result.length }
  },
})
