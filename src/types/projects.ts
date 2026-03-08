/**
 * Project and planning session types for HughMann strategic planning.
 */

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived' | 'incubator'

export interface Milestone {
  id: string
  title: string
  target_date: string | null
  completed: boolean
  completed_at: string | null
}

export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  domain: string | null
  status: ProjectStatus
  goals: string[]
  quarterly_goal: string | null
  milestones: Milestone[]
  priority: number
  north_star: string | null
  guardrails: string[]
  domain_goal_id: string | null
  infrastructure: { repo_url?: string; vercel_project?: string; production_url?: string; staging_url?: string; domain?: string }
  refinement_cadence: 'weekly' | 'biweekly' | 'monthly'
  last_refinement_at: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  metadata: Record<string, unknown>
}

export interface DomainGoal {
  id: string
  domain: string
  customer_id: string | null
  statement: string
  reviewed_at: string
  created_at: string
  updated_at: string
}

export interface CreateProjectInput {
  name: string
  slug?: string
  description?: string
  domain?: string
  status?: ProjectStatus
  goals?: string[]
  quarterly_goal?: string
  milestones?: Omit<Milestone, 'id' | 'completed' | 'completed_at'>[]
  priority?: number
  metadata?: Record<string, unknown>
  north_star?: string
  guardrails?: string[]
  infrastructure?: { repo_url?: string; vercel_project?: string; production_url?: string; staging_url?: string; domain?: string }
  refinement_cadence?: 'weekly' | 'biweekly' | 'monthly'
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  domain?: string
  status?: ProjectStatus
  goals?: string[]
  quarterly_goal?: string
  milestones?: Milestone[]
  priority?: number
  metadata?: Record<string, unknown>
  north_star?: string
  guardrails?: string[]
  infrastructure?: { repo_url?: string; vercel_project?: string; production_url?: string; staging_url?: string; domain?: string }
  refinement_cadence?: 'weekly' | 'biweekly' | 'monthly'
  last_refinement_at?: string
  domain_goal_id?: string
}

export interface ProjectFilters {
  domain?: string
  status?: ProjectStatus | ProjectStatus[]
  limit?: number
}

export interface PlanningSessionRecord {
  id: string
  session_id: string
  focus_area: string
  topics_covered: string[]
  decisions_made: string[]
  tasks_created: string[]
  projects_touched: string[]
  open_questions: string[]
  next_steps: string[]
  created_at: string
}
