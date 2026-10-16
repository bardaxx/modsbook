// skillmaps' state: one value per map, under the one plugin. A contract imports nothing.

// ======== The Spine's steps: a grilling's rounds, lookups, glossary terms, ADRs and Wrap-up, as grill-map and
// wayfinder-map draw them (hooks/spine.tsx and hooks/reply.ts read them).
/** One question of a round (`❓ **Q1** - **Title**: body … ➡ recommended`) or of an AskUserQuestion dialog. */
export type Question = {
  n: string
  title: string
  /** The question's body, the choices left out. */
  body: string
  /** The choices the body listed, or the options the dialog offered. */
  options: string[]
  /** The recommended answer (`➡ …`), or the dialog's "(Recommended)" option. */
  recommended: string
  answer?: string
  /** The person took the recommendation: a yes with no Reserve, or the recommended option. */
  isAccepted?: boolean
}

/** A Level: one round, the frontier as it stood. */
export type RoundStep = {
  kind: 'round'
  id: string
  at: number
  via: 'grilling' | 'dialog'
  questions: Question[]
  /** What the person wrote back, whole. */
  reply?: string
}

/** A fact the agent went to find instead of asking: a sub-agent, or a run of reads and searches. */
export type LookupStep = {
  kind: 'lookup'
  id: string
  at: number
  label: string
  isAgent: boolean
  /** Reads and searches folded into this step. */
  count: number
  isDone: boolean
}

/** Terms written to the glossary (`CONTEXT.md`, `GLOSSARY.md`). */
export type TermStep = { kind: 'term'; id: string; at: number; file: string; terms: string[] }

/** An ADR written under `docs/adr/`. */
export type AdrStep = { kind: 'adr'; id: string; at: number; file: string; number: string; title: string; isUpdate: boolean }

/** The Wrap-up: a turn that ended without questions once rounds were answered, the summary up for confirmation. */
export type WrapStep = { kind: 'wrap'; id: string; at: number; text: string; reply?: string; isConfirmed?: boolean }

export type Step = RoundStep | LookupStep | TermStep | AdrStep | WrapStep

// ======== wayfinder-map

export type TicketType = 'research' | 'prototype' | 'grilling' | 'task'

export type Source = 'github' | 'local'

/** Where the map lives: an issue number on GitHub, or a `.scratch/<effort>` folder. */
export type Target = { source: Source; ref: string }

/** One decision ticket: a child issue of the map, or a `.scratch/<effort>/issues/NN-*.md` file. */
export type Ticket = {
  /** The issue number, or the file's `NN`. */
  id: string
  title: string
  type: TicketType | null
  isClosed: boolean
  isClaimed: boolean
  isOutOfScope: boolean
  /** The ids of the tickets that block it, open or closed. */
  blockedBy: string[]
  /** The issue's URL, or the file's path. */
  link: string
  /** The ticket's `## Question`. */
  question: string
  /** The resolution: a local `## Answer`, or the closing comment fetched on focus. */
  answer?: string
}

/** One line of the map's Decisions so far or Out of scope: a gist, and the ticket it points at. */
export type Entry = { title: string; gist: string; ticket: string | null }

export type MapView = {
  title: string
  link: string
  destination: string
  notes: string
  decisions: Entry[]
  fog: string[]
  outOfScope: Entry[]
  tickets: Ticket[]
}

export type Tab = 'route' | 'decisions'

export type NodeState = 'resolved' | 'claimed' | 'frontier' | 'blocked'

/** One ticket as the map's graph draws it: a box in the row of its depth. */
export type GraphNode = {
  id: string
  title: string
  type: TicketType | null
  state: NodeState
  /** 1 for a ticket nothing blocks, one more than its deepest blocker otherwise. */
  layer: number
  isNext: boolean
  isMine: boolean
}

/** What the graph's surface module draws from: the tickets, their blocking edges, the two ends. */
export type GraphProps = {
  nodes: GraphNode[]
  /** `[blocker, blocked]` pairs. */
  edges: [string, string][]
  start: string
  destination: string
  /** The ticket whose card is open, which the graph selects. */
  selected: string | null
  columns: number
}

/** What the graph posts to the hooks module as its selection moves. */
export type GraphMessage = { focus: string | null }

/** One line of a map's Spines: a step, and the ticket it was taken under; null for Charting. */
export type Line = Step & { ticket: string | null }

export type Wayfinder = {
  target: Target | null
  map: MapView | null
  /** Every ticket's Spine and Charting's, in the order the lines came; the map's store keeps them. */
  lines: Line[]
  tab: Tab
  /** The ticket whose card is open on the route. */
  focus: string | null
  /** Levels a press turned from how they are drawn by default. */
  turned: string[]
  isAllUnfolded: boolean
  error: string | null
  refreshedAt: number | null
}

/** A Run: the stretch of a conversation that works a map, from `/wayfinder` to `/clear`, a separate grill or `/skillmaps wayfinder clear`. */
export type Run = {
  /** The ticket claimed in the Run, null while charting. */
  ticket: { id: string; title: string } | null
  /** When the last claim was seen. */
  claimedAt: number | null
}

// ======== grill-map
/** The skill that started the grill: the interview itself, or one of its two wrappers. */
export type GrillSkill = 'grilling' | 'grill-me' | 'grill-with-docs'

export type Grill = {
  id: string
  skill: GrillSkill
  subject: string
  startedAt: number
  steps: Step[]
  /** The person confirmed the shared understanding. */
  isDone: boolean
  /** Inside a wayfinder Run: the claimed ticket's id, or `charting`. Absent for a grill of its own. */
  run?: string
}

export type GrillBook = {
  grills: Grill[]
  /** The grill the pane shows; null follows the newest. */
  shown: string | null
  /** Levels a press turned from how they are drawn by default. */
  expanded: string[]
  isAllExpanded: boolean
  /** The person's last prompt, the subject of a grill the model starts by itself. */
  lastPrompt: string
}

/** wayfinder-map's Run, read by grill-map to know a grill runs inside /wayfinder. */
export type WayfinderRun = Run

// ======== spec-map
export type Stage = 'grill' | 'spec' | 'tickets' | 'implement' | 'review' | 'ship'

export type Role = 'implementer' | 'merger' | 'reviewer' | 'explorer' | 'agent'

/** One thing an agent did: a tool it ran, or a line it wrote between tools. */
export type AgentStep = {
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
  steps: AgentStep[]
  tools: number
  errors: number
}

export type SpecTicket = {
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
  tickets: SpecTicket[]
  agents: AgentRow[]
  /** The agent whose steps the pane lays out in full. */
  focus: string | null
  error: string | null
  refreshedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    skillmaps: { book: GrillBook; way: Wayfinder; run: Run | null; flow: Flow }
  }
}
