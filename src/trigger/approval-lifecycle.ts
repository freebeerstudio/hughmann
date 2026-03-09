/**
 * Trigger.dev scheduled task: Approval Lifecycle
 *
 * Runs every 15 minutes during business hours (7am-6pm CST).
 * Checks for expired approval bundles and handles timeout behavior:
 * - auto_proceed projects: creates all proposed tasks automatically
 * - required projects: marks the bundle as expired
 */

import { schedules } from '@trigger.dev/sdk/v3'
import { getSupabaseClient } from './utils.js'

export const approvalLifecycle = schedules.task({
  id: 'approval-lifecycle',
  // Every 15 minutes during business hours (7am-6pm CST = 13:00-00:00 UTC), weekdays
  cron: '*/15 13-23 * * 1-5',
  run: async () => {
    const supabase = getSupabaseClient()
    const now = new Date().toISOString()

    // Fetch pending bundles that have expired
    const { data: expired, error } = await supabase
      .from('approval_bundles')
      .select('*')
      .eq('status', 'pending')
      .not('expires_at', 'is', null)
      .lt('expires_at', now)

    if (error) {
      console.error('[approval-lifecycle] Query error:', error.message)
      return { processed: 0, error: error.message }
    }

    let processed = 0
    for (const bundle of expired || []) {
      // Look up the project's approval_mode
      const { data: project } = await supabase
        .from('projects')
        .select('approval_mode, name')
        .eq('id', bundle.project_id)
        .single()

      if (!project) continue

      const mode = project.approval_mode

      if (mode === 'auto_proceed') {
        // Create all proposed tasks
        const tasks = (bundle.proposed_tasks || []) as Array<{
          title: string; description: string; type: string; assignee: string; priority: number
        }>
        for (const task of tasks) {
          await supabase.from('tasks').insert({
            title: task.title,
            description: task.description,
            task_type: task.type,
            assignee: task.assignee,
            priority: task.priority,
            project_id: bundle.project_id,
            domain: bundle.domain,
            status: 'todo',
          })
        }
        // Mark bundle as auto_proceeded
        await supabase.from('approval_bundles').update({
          status: 'auto_proceeded',
          resolved_at: now,
          resolved_by: 'timeout',
        }).eq('id', bundle.id)

        console.log(`[approval-lifecycle] Auto-proceeded bundle ${bundle.id} for ${project.name} (${tasks.length} tasks created)`)
      } else {
        // For 'required' mode with expiry or any other case, just expire
        await supabase.from('approval_bundles').update({
          status: 'expired',
          resolved_at: now,
          resolved_by: 'timeout',
        }).eq('id', bundle.id)

        console.log(`[approval-lifecycle] Expired bundle ${bundle.id} for ${project.name}`)
      }

      processed++
    }

    return { processed }
  },
})
