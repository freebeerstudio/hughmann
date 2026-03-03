export interface SystemIdentity {
  name: string
  personality: string
  customPersonality?: string
  communicationRules: string[]
  customRules?: string
}

export interface UserIdentity {
  name: string
  description: string
  timezone: string
  peakHours: string
  communicationStyle: string
}

export interface LifeDomain {
  name: string
  type: string
  description: string
  primaryGoal: string
  quarterlyGoals: string
  activeProjects: string
  tools: string
  biggestChallenge: string
}

export interface InfrastructureChoices {
  dataEngine: string
  executionEngine: string
  frontends: string[]
  modelProviders: string[]
}

export interface AutonomySettings {
  level: string
  communicationChannels: string[]
  activeHours: string
  customSchedule?: string
}

export interface OnboardingResult {
  system: SystemIdentity
  user: UserIdentity
  domains: LifeDomain[]
  infrastructure: InfrastructureChoices
  autonomy: AutonomySettings
}
