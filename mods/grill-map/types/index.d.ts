// The Spine's steps, declared alike in both mods' contracts (a contract imports nothing): hooks/spine.tsx and
// hooks/reply.ts read them, and scripts/check.sh compares the two declarations, down to `export type Step`.
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

/** wayfinder-map's Run, as its contract declares it: read to know a grill runs inside /wayfinder. */
export type WayfinderRun = {
  /** The ticket claimed in the Run, null while charting. */
  ticket: { id: string; title: string } | null
  /** When the last claim was seen. */
  claimedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'grill-map': { book: GrillBook }
    'wayfinder-map': { run: WayfinderRun | null }
  }
}
