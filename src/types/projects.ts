/**
 * Project and planning session types for HughMann strategic planning.
 */

export type ProjectStatus = 'planning' | 'incubator' | 'active' | 'paused' | 'completed' | 'archived'
export type ApprovalMode = 'required' | 'auto_proceed' | 'notify_only'

export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  domain: string
  status: ProjectStatus
  priority: number
  domain_goal_id: string | null
  north_star: string | null
  guardrails: string[]
  infrastructure: {
    repo_url?: string
    vercel_project?: string
    production_url?: string
    staging_url?: string
    domain?: string
  }
  refinement_cadence: 'weekly' | 'biweekly' | 'monthly'
  last_refinement_at: string | null
  approval_mode: ApprovalMode
  local_path: string | null
  stack: string[]
  claude_md_exists: boolean
  created_at: string
  updated_at: string
}

export interface StateUpdate {
  date: string
  projectId: string
  projectName: string
  summary: string
  previousState: string | null
  newState: string
}

export interface DomainGoal {
  id: string
  domain: string
  statement: string
  current_state: string | null
  state_updates: StateUpdate[]
  reviewed_at: string
  created_at: string
  updated_at: string
}

export interface CreateProjectInput {
  name: string
  slug?: string
  description?: string
  domain: string
  status?: ProjectStatus
  priority?: number
  north_star?: string
  guardrails?: string[]
  infrastructure?: Project['infrastructure']
  refinement_cadence?: 'weekly' | 'biweekly' | 'monthly'
  domain_goal_id?: string
  approval_mode?: ApprovalMode
  local_path?: string
  stack?: string[]
  claude_md_exists?: boolean
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  domain?: string
  status?: ProjectStatus
  priority?: number
  north_star?: string
  guardrails?: string[]
  infrastructure?: Project['infrastructure']
  refinement_cadence?: 'weekly' | 'biweekly' | 'monthly'
  last_refinement_at?: string
  domain_goal_id?: string
  approval_mode?: ApprovalMode
  local_path?: string
  stack?: string[]
  claude_md_exists?: boolean
}

export interface ProjectFilters {
  domain?: string
  status?: ProjectStatus | ProjectStatus[]
  limit?: number
}

export interface ProposedTask {
  title: string
  description: string
  type: string
  assignee: string
  priority: number
}

export interface ApprovalBundle {
  id: string
  project_id: string
  domain: string
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_proceeded'
  summary: string
  proposed_tasks: ProposedTask[]
  reasoning: string
  expires_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

export interface ApprovalBundleFilters {
  project_id?: string
  status?: string
  domain?: string
}

export interface PlanningSessionRecord {
  id?: string
  session_id?: string
  focus_area: string
  topics_covered: string[]
  decisions_made: string[]
  tasks_created?: string[]
  projects_touched?: string[]
  open_questions?: string[]
  next_steps?: string[]
  created_at?: string
}
