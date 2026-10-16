export type Stage = 'grill' | 'spec' | 'tickets' | 'implement' | 'review' | 'ship'

export type Role = 'implementer' | 'merger' | 'reviewer' | 'explorer' | 'agent'

/** One thing an agent did: a tool it ran, or a line it wrote between tools. */
export type Step = {
  kind: 'tool' | 'say'
  id: string
  text: string
  status: 'running' | 'ok' | 'error'
  at: number
  ms?: number
  /** The first line of the error the tool answered. */
  error?: string
}

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
  /** The newest steps, oldest first. */
  steps: Step[]
  tools: number
  errors: number
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
  /** The cap on parallel implementers the running skill states, if it states one. */
  slotCap: number | null
  tickets: Ticket[]
  agents: AgentRow[]
  /** The agent whose steps the pane lays out in full. */
  focus: string | null
  error: string | null
  refreshedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'spec-flow': { flow: Flow }
  }
}
