export type Stage = 'grill' | 'spec' | 'tickets' | 'implement' | 'review' | 'ship'

export type Role = 'implementer' | 'merger' | 'reviewer' | 'explorer' | 'agent'

export type AgentRow = {
  id: string
  role: Role
  description: string
  type: string
  tickets: number[]
  status: 'running' | 'done' | 'failed'
  activity: string
  report: string
  startedAt: number
  endedAt?: number
}

export type Ticket = {
  number: number
  title: string
  isClosed: boolean
  /** Merged into the integration branch: a merge commit of the spec's PR names it. */
  isMerged: boolean
  blockedBy: number[]
}

export type IntegrationPr = {
  number: number
  branch: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  ci: 'pass' | 'fail' | 'running' | 'none'
}

export type Flow = {
  stage: Stage | null
  lastSkill: string | null
  spec: { number: number; title: string } | null
  pr: number | null
  integration: IntegrationPr | null
  tickets: Ticket[]
  agents: AgentRow[]
  error: string | null
  refreshedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'spec-flow': { flow: Flow }
  }
}
