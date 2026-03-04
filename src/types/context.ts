export type IsolationZone = 'isolated' | 'personal'

export interface ContextDocument {
  path: string
  raw: string
  meta: {
    title: string
    type: 'soul' | 'owner' | 'master-plan' | 'capabilities' | 'growth' | 'domain'
  }
}

export interface DomainContext {
  name: string
  slug: string
  domainType: string
  isolation: IsolationZone
  document: ContextDocument
}

export interface ContextStore {
  soul: ContextDocument
  owner: ContextDocument
  masterPlan: ContextDocument | null
  capabilities: ContextDocument | null
  growth: ContextDocument | null
  domains: Map<string, DomainContext>
  config: {
    systemName: string
    ownerName: string
    timezone: string
  }
  loadedAt: Date
}
