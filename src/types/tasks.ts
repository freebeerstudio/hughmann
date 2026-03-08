/**
 * Task system types for HughMann autonomous work tracking.
 */

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'blocked'

export type TaskType = 'big_rock' | 'must' | 'mit' | 'standard'

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  task_type: TaskType
  domain: string | null
  project_id: string | null
  sprint: string | null
  priority: number
  assignee: string | null
  assigned_agent_id: string | null
  blocked_reason: string | null
  due_date: string | null
  cwd: string | null
  completion_notes: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface TaskFilters {
  status?: TaskStatus | TaskStatus[]
  domain?: string
  project_id?: string
  task_type?: TaskType | TaskType[]
  assignee?: string
  /** Match tasks assigned to this agent OR unassigned (assignee IS NULL). Used by daemon task routing. */
  assigneeOrUnassigned?: string
  limit?: number
}

export interface CreateTaskInput {
  title: string
  description?: string
  status?: TaskStatus
  task_type?: TaskType
  domain?: string
  project_id?: string
  sprint?: string
  priority?: number
  assignee?: string
  assigned_agent_id?: string
  blocked_reason?: string
  due_date?: string
  cwd?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  task_type?: TaskType
  domain?: string
  project_id?: string
  sprint?: string
  priority?: number
  assignee?: string
  assigned_agent_id?: string
  blocked_reason?: string
  due_date?: string
  cwd?: string
  completion_notes?: string
}
