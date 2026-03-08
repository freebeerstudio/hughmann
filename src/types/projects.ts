/**
 * Project and planning session types for HughMann strategic planning.
 */

export type ProjectStatus = 'planning' | 'incubator' | 'active' | 'paused' | 'completed' | 'archived'

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
  created_at: string
  updated_at: string
}

export interface DomainGoal {
  id: string
  domain: string
  statement: string
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
}

export interface ProjectFilters {
  domain?: string
  status?: ProjectStatus | ProjectStatus[]
  limit?: number
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
