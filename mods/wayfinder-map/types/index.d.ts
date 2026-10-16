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

/** One question of a grilling round (`❓ **Q1** - **…**`) or of an AskUserQuestion dialog. */
export type Question = {
  n: string
  title: string
  /** The recommended answer (`➡ …`), or the options the dialog offered. */
  recommended: string
  options: string[]
  answer?: string
  /** The person said yes to the recommendation. */
  isAccepted?: boolean
}

export type Round = {
  id: string
  /** The ticket being resolved when it was asked; null while charting the destination. */
  ticket: string | null
  at: number
  kind: 'grilling' | 'dialog'
  questions: Question[]
  /** What the person wrote back, whole. */
  reply?: string
}

export type Tab = 'route' | 'decisions' | 'grill'

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

export type Wayfinder = {
  target: Target | null
  map: MapView | null
  /** The ticket this session claimed. */
  working: string | null
  rounds: Round[]
  tab: Tab
  /** The ticket whose card is open on the route. */
  focus: string | null
  error: string | null
  refreshedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'wayfinder-map': { way: Wayfinder }
  }
}
