/**
 * Trigger.dev scheduled task: Autonomous Task Execution
 *
 * Runs every 15 minutes during business hours (7am-6pm CST).
 * Picks up the highest-priority todo task assigned to an agent,
 * loads the agent's persona, and executes via callModel.
 * Results are saved and pushed to Telegram.
 *
 * Guardrails: max 5 tasks/day, skips tasks assigned to "wayne".
 */

import { schedules } from '@trigger.dev/sdk/v3'
import {
  getSupabaseClient,
  loadCloudContext,
  buildCloudPrompt,
  buildPyramidContext,
  getCloudTasks,
  callModel,
  sendTelegram,
} from './utils.js'

// Agent persona prompts (subset of what's in SKILL.md files)
const AGENT_PERSONAS: Record<string, string> = {
  'hugh': `You are Hugh Mann, Chief of Staff. You orchestrate, plan, prioritize, and coordinate across all domains. Think in the pyramid: domain goals → project North Stars → guardrails → tasks.`,
  'agent-hugh': `You are Hugh Mann, Chief of Staff. You orchestrate, plan, prioritize, and coordinate across all domains. Think in the pyramid: domain goals → project North Stars → guardrails → tasks.`,
  'celine': `You are Celine Robutz, CRO of Free Beer Studio. You own revenue growth — finding customers, closing deals, and maximizing lifetime value. Every recommendation ties to revenue impact.`,
  'agent-celine': `You are Celine Robutz, CRO of Free Beer Studio. You own revenue growth — finding customers, closing deals, and maximizing lifetime value. Every recommendation ties to revenue impact.`,
  'mark': `You are Mark Etting, Marketing Director at Free Beer Studio. You own the brand voice and all marketing output — content that attracts, engages, and converts small business owners.`,
  'agent-mark': `You are Mark Etting, Marketing Director at Free Beer Studio. You own the brand voice and all marketing output — content that attracts, engages, and converts small business owners.`,
  'support': `You are the Customer Success agent for Free Beer Studio. You ensure every client has an exceptional experience from onboarding through ongoing support.`,
  'agent-support': `You are the Customer Success agent for Free Beer Studio. You ensure every client has an exceptional experience from onboarding through ongoing support.`,
}

const MAX_TASKS_PER_DAY = 5
const TASK_COUNTER_KEY = 'trigger-task-count'

export const executeTask = schedules.task({
  id: 'execute-task',
  cron: '*/15 12-23 * * 1-5', // Every 15min, 7am-6pm CST (UTC 12-23), Mon-Fri
  run: async () => {
    const client = getSupabaseClient()

    // Check daily limit
    const today = new Date().toISOString().split('T')[0]
    const { data: countData } = await client
      .from('memories')
      .select('id')
      .eq('session_id', `${TASK_COUNTER_KEY}-${today}`)

    const tasksToday = countData?.length ?? 0
    if (tasksToday >= MAX_TASKS_PER_DAY) {
      return { skipped: true, reason: `Daily limit reached (${tasksToday}/${MAX_TASKS_PER_DAY})` }
    }

    // Get todo tasks not assigned to wayne
    const tasks = await getCloudTasks(client, { status: 'todo', limit: 10 })
    const agentTasks = tasks.filter(t =>
      t.assignee && t.assignee !== 'wayne' && t.assignee !== 'Wayne'
    )

    if (agentTasks.length === 0) {
      return { skipped: true, reason: 'No agent-assigned tasks in queue' }
    }

    // Pick highest priority task
    const task = agentTasks[0] // Already sorted by priority from query

    // Mark as in_progress
    await client.from('tasks').update({ status: 'in_progress' }).eq('id', task.id)

    // Load context
    const context = await loadCloudContext(client)
    const pyramidContext = await buildPyramidContext(client)

    // Build system prompt with agent persona
    const agentId = task.assigned_agent_id ?? task.assignee ?? 'hugh'
    const persona = AGENT_PERSONAS[agentId] ?? AGENT_PERSONAS['hugh']

    let systemPrompt = persona + '\n\n---\n\n' + buildCloudPrompt(context, task.domain ?? undefined)
    systemPrompt += '\n\n---\n\n' + pyramidContext

    // Build task prompt
    let taskPrompt = `Execute the following task:\n\n**Title**: ${task.title}\n`
    if (task.description) taskPrompt += `**Description**: ${task.description}\n`
    if (task.domain) taskPrompt += `**Domain**: ${task.domain}\n`
    if (task.sprint) taskPrompt += `**Sprint**: ${task.sprint}\n`

    // Load project context if available
    if (task.project_id) {
      const { data: project } = await client
        .from('projects')
        .select('name, north_star, guardrails')
        .eq('id', task.project_id)
        .single()

      if (project) {
        taskPrompt += `\n**Project**: ${project.name}\n`
        if (project.north_star) taskPrompt += `**North Star**: ${project.north_star}\n`
        if (project.guardrails && Array.isArray(project.guardrails) && project.guardrails.length > 0) {
          taskPrompt += `**Guardrails**: ${(project.guardrails as string[]).join('; ')}\n`
        }
      }
    }

    taskPrompt += '\nComplete this task thoroughly. Provide a clear summary of what was accomplished.'

    try {
      const result = await callModel(systemPrompt, taskPrompt, { maxTokens: 4096 })
      const summary = result.length > 500 ? result.slice(0, 500) + '...' : result

      // Mark complete
      await client.from('tasks').update({
        status: 'done',
        completed_at: new Date().toISOString(),
        completion_notes: summary,
      }).eq('id', task.id)

      // Record daily counter
      await client.from('memories').insert({
        session_id: `${TASK_COUNTER_KEY}-${today}`,
        domain: task.domain,
        content: `[Auto-executed] ${task.title}: ${summary}`,
        memory_date: today,
      })

      // Notify
      const agentName = agentId.replace('agent-', '')
      await sendTelegram(`✅ *Task Completed* (${agentName})\n\n*${task.title}*\n\n${summary}`)

      return { success: true, taskId: task.id, agent: agentId, title: task.title }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)

      // Mark as blocked
      await client.from('tasks').update({
        status: 'blocked',
        blocked_reason: `Cloud execution failed: ${errorMsg}`,
      }).eq('id', task.id)

      await sendTelegram(`❌ *Task Failed* (${agentId})\n\n*${task.title}*\n\n${errorMsg}`)

      return { success: false, taskId: task.id, error: errorMsg }
    }
  },
})
