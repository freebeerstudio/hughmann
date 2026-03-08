/**
 * Task system types for HughMann autonomous work tracking.
 */

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'blocked'
export type TaskType = 'MUST' | 'MIT' | 'BIG_ROCK' | 'STANDARD'

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  task_type: TaskType
  domain: string | null
  project: string | null
  project_id: string | null
  priority: number // 0 (highest) to 5 (lowest)
  due_date: string | null
  cwd: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  completion_notes: string | null
  assignee: string | null
  assigned_agent_id: string | null
  blocked_reason: string | null
  sprint: string | null
}

export interface TaskFilters {
  status?: TaskStatus | TaskStatus[]
  domain?: string
  project?: string
  task_type?: TaskType | TaskType[]
  limit?: number
}

export interface CreateTaskInput {
  title: string
  description?: string
  status?: TaskStatus
  task_type?: TaskType
  domain?: string
  project?: string
  project_id?: string
  priority?: number
  due_date?: string
  cwd?: string
  assignee?: string
  assigned_agent_id?: string
  blocked_reason?: string
  sprint?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  task_type?: TaskType
  domain?: string
  project?: string
  project_id?: string
  priority?: number
  due_date?: string
  cwd?: string
  assignee?: string
  assigned_agent_id?: string
  blocked_reason?: string
  sprint?: string
}
