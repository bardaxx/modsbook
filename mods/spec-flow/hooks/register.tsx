import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentRow, Flow, IntegrationPr, Role, Stage, Step, Ticket } from '../types'
import { header } from './header'

const PANE = 'spec-flow'
const TITLE = 'Flow'
const POLL_MS = 60_000
// The steps each agent keeps, and how many the focused card lays out.
const STEPS_KEPT = 40
const STEPS_SHOWN = 14

// The deck palette: muted pills on a dark track, dark ink on the pills.
const INK = '#151515'
const TRACK = '#2b2b2b'
const EDGE = '#4a4a4a'
const ACCENT = '#d97757'
const PAST_BG = '#1f3b31'
type TicketState = 'done' | 'implemented' | 'merging' | 'working' | 'ready' | 'blocked' | 'failed'
const STATE_COLOR: Record<TicketState, string> = {
  done: '#5ccf9f',
  implemented: '#7fb4f5',
  merging: '#b79cf5',
  working: ACCENT,
  ready: '#e2b867',
  blocked: '#5a5a5a',
  failed: '#e5737b',
}
// Bar order, left to right: what is finished first, what waits last.
const LEGEND: { state: TicketState; label: string }[] = [
  { state: 'done', label: 'done' },
  { state: 'implemented', label: 'to merge' },
  { state: 'merging', label: 'merging' },
  { state: 'working', label: 'in progress' },
  { state: 'failed', label: 'failed' },
  { state: 'ready', label: 'ready' },
  { state: 'blocked', label: 'blocked' },
]
const CI_LABEL: Record<IntegrationPr['ci'], string> = {
  pass: 'CI ✓',
  fail: 'CI ✗',
  running: 'CI …',
  none: 'no CI',
}
const CI_COLOR: Record<IntegrationPr['ci'], string> = {
  pass: STATE_COLOR.done,
  fail: STATE_COLOR.failed,
  running: STATE_COLOR.ready,
  none: EDGE,
}

// The states someone is acting on get a pill; the rest stay plain text.
const ACTIVE = new Set<TicketState>(['working', 'merging', 'implemented', 'failed'])
const ROLE_COLOR: Record<Role, string> = {
  implementer: ACCENT,
  merger: STATE_COLOR.merging,
  reviewer: STATE_COLOR.implemented,
  explorer: STATE_COLOR.ready,
  agent: '#9a9a9a',
}

const EMPTY: Flow = {
  stage: null,
  lastSkill: null,
  spec: null,
  pr: null,
  integration: null,
  slotCap: null,
  tickets: [],
  agents: [],
  focus: null,
  error: null,
  refreshedAt: null,
}
const flow = atom({ plugin: 'spec-flow', key: 'flow' } as const, EMPTY)

// A row an older version kept lacks the step log.
const upgrade = (a: AgentRow): AgentRow => ({ ...a, steps: a.steps ?? [], tools: a.tools ?? 0, errors: a.errors ?? 0 })

// State a session kept from an older version of the mod lacks the fields added since.
const current = async ($: EngineInterface): Promise<Flow> => {
  const f = { ...EMPTY, ...(await read($, flow)) }
  return { ...f, agents: f.agents.map(upgrade) }
}

// Changes one agent's row, if the pane knows the agent.
const withAgent = (f: Flow, id: string, change: (a: AgentRow) => AgentRow): Flow =>
  f.agents.some(a => a.id === id)
    ? { ...f, agents: f.agents.map(a => (a.id === id ? change(upgrade(a)) : a)) }
    : f

const firstLine = (text: string) => text.split('\n').find(line => line.trim())?.trim() ?? ''

// The idea-to-ship spine (aihero.dev/skills) and the skills that move it.
const STAGES: { stage: Stage; label: string }[] = [
  { stage: 'grill', label: 'grill' },
  { stage: 'spec', label: 'spec' },
  { stage: 'tickets', label: 'tickets' },
  { stage: 'implement', label: 'implement' },
  { stage: 'review', label: 'review' },
  { stage: 'ship', label: 'ship' },
]
const STAGE_OF: Record<string, Stage> = {
  'grill-me': 'grill',
  'grill-with-docs': 'grill',
  grilling: 'grill',
  wayfinder: 'grill',
  'to-questionnaire': 'grill',
  'to-spec': 'spec',
  'to-tickets': 'tickets',
  'implement-spec': 'implement',
  implement: 'implement',
  'code-review': 'review',
  pr: 'ship',
}
// Skills worth naming in the pane though they do not move the spine.
const SIDE_SKILLS = new Set([
  'prototype',
  'research',
  'domain-modeling',
  'diagnosing-bugs',
  'improve-codebase-architecture',
  'triage',
  'tdd',
  'codebase-design',
])

// A cap the running skill sets on parallel implementers: "in **3 slots** at most".
const slotCapIn = (text: string): number | null => {
  const n = Number(/\b(\d+)\**\s+slots?\b/i.exec(text)?.[1])
  return n > 0 ? n : null
}

const issueIn = (text: string): number | null => {
  const m = /issues\/(\d+)/.exec(text) ?? /#(\d+)/.exec(text) ?? /^\s*(\d+)\b/.exec(text)
  return m ? Number(m[1]) : null
}

const refsIn = (text: string): number[] => {
  const found = new Set<number>()
  for (const m of text.matchAll(/(?:#|issues\/|ticket\s+)(\d+)/gi)) found.add(Number(m[1]))
  return [...found]
}

const roleOf = (description: string, type: string, prompt: string): Role => {
  const head = `${description} ${type}`
  if (/merg/i.test(head)) return 'merger'
  if (/review/i.test(head)) return 'reviewer'
  if (/explor|research/i.test(head) || type === 'Explore') return 'explorer'
  if (/implement|ticket|fix|#\d+/i.test(head) || /\btdd\b|implement/i.test(prompt.slice(0, 400)))
    return 'implementer'
  return 'agent'
}

const baseName = (path: string) => path.split('/').pop() ?? path

const activityOf = (e: { tool: unknown }): string => {
  const tool = String(e.tool)
  const args = e as unknown as Record<string, unknown>
  const field = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const detail =
    tool === 'Bash'
      ? field('description') || field('command')
      : tool === 'Skill'
        ? `/${field('skill')}`
        : field('file_path')
          ? baseName(field('file_path'))
          : field('pattern') || field('description')
  return `${tool} ${detail}`.trim().split('\n')[0] ?? tool
}

// "feat(web): Create episode…" reads as "Create episode…" in a narrow pane.
const shortTitle = (title: string) => title.replace(/^\w+(\([^)]*\))?!?:\s*/, '')

// A spec title's headline: what comes before its first colon or parenthesis.
const headline = (title: string) => title.split(/:\s|\s\(/)[0]?.trim() || title

const since = (from: number, to = Date.now()) => {
  const s = Math.max(0, Math.round((to - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}

const gh = async ($: EngineInterface, args: string[]) => {
  const run = await $.process.run(['gh', ...args], { timeoutMs: 20_000 })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n')[0] || `gh ${args[0]} failed`)
  return run.stdout
}

type GhPr = {
  number: number
  title: string
  body: string
  state: string
  isDraft: boolean
  headRefName: string
}
type GhCheck = { status: string | null; conclusion: string | null; state: string | null }

// The spec's integration PR: the one whose title or body names the spec, open first.
const findPr = async ($: EngineInterface, spec: number, known: number | null) => {
  const prs = JSON.parse(
    await gh($, [
      'pr',
      'list',
      '--state',
      'all',
      '--search',
      String(spec),
      '--limit',
      '20',
      '--json',
      'number,title,body,state,isDraft,headRefName',
    ]),
  ) as GhPr[]
  const names = new RegExp(`#${spec}\\b`)
  const mine = prs.filter(p => p.number === known || names.test(`${p.title}\n${p.body}`))
  return mine.find(p => p.state === 'OPEN') ?? mine.find(p => p.state === 'MERGED') ?? mine[0]
}

const ciOf = (checks: GhCheck[]): IntegrationPr['ci'] => {
  if (!checks.length) return 'none'
  const outcome = (c: GhCheck) => (c.conclusion ?? c.state ?? '').toUpperCase()
  if (checks.some(c => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'].includes(outcome(c)))) return 'fail'
  if (checks.some(c => (c.status && c.status !== 'COMPLETED') || outcome(c) === 'PENDING')) return 'running'
  return 'pass'
}

// Tickets a merge commit of the PR names: "Merge #239: ..." or "feat: merge ... (#238)".
const mergedTickets = async ($: EngineInterface, pr: number, tickets: Set<number>) => {
  const lines = await gh($, [
    'api',
    `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`,
    '--paginate',
    '--jq',
    '.[] | [(.commit.message | split("\\n")[0]), (.parents | length)] | @json',
  ])
  const merged = new Set<number>()
  for (const line of lines.split('\n').filter(Boolean)) {
    const [subject, parents] = JSON.parse(line) as [string, number]
    if (parents < 2 && !/\bmerge\b/i.test(subject)) continue
    for (const n of refsIn(subject)) if (tickets.has(n)) merged.add(n)
  }
  return merged
}

type GhIssue = { number: number; title: string; state: string; body: string | null }

// "## Blocked by" (GitHub tickets) or "**Blocked by:**" (local tickets); null when absent.
const blockersInBody = (body: string): number[] | null => {
  const m = /blocked by[:*\s]*([\s\S]*?)(?:\n#{1,6}\s|\n\*\*|$)/i.exec(body)
  return m ? refsIn(m[1] ?? '') : null
}

const refresh = async ($: EngineInterface) => {
  const { spec } = await current($)
  if (!spec) return
  try {
    const head = JSON.parse(await gh($, ['issue', 'view', String(spec.number), '--json', 'title'])) as {
      title: string
    }
    const subs = JSON.parse(
      await gh($, ['api', `repos/{owner}/{repo}/issues/${spec.number}/sub_issues?per_page=100`]),
    ) as GhIssue[]
    const tickets: Ticket[] = []
    for (const sub of subs) {
      let blockedBy = blockersInBody(sub.body ?? '')
      if (blockedBy === null) {
        // to-tickets omits the section when it set native blocking edges.
        try {
          const deps = JSON.parse(
            await gh($, ['api', `repos/{owner}/{repo}/issues/${sub.number}/dependencies/blocked_by`]),
          ) as { number: number }[]
          blockedBy = deps.map(d => d.number)
        } catch {
          blockedBy = []
        }
      }
      tickets.push({
        number: sub.number,
        title: sub.title,
        isClosed: sub.state === 'closed',
        isMerged: false,
        blockedBy,
      })
    }
    tickets.sort((a, b) => a.number - b.number)

    // Progress lives on GitHub, whichever session did the work.
    let integration: IntegrationPr | null = null
    const found = await findPr($, spec.number, (await current($)).pr)
    if (found) {
      const view = JSON.parse(
        await gh($, ['pr', 'view', String(found.number), '--json', 'statusCheckRollup']),
      ) as { statusCheckRollup: GhCheck[] }
      integration = {
        number: found.number,
        branch: found.headRefName,
        state:
          found.state === 'MERGED'
            ? 'merged'
            : found.state === 'CLOSED'
              ? 'closed'
              : found.isDraft
                ? 'draft'
                : 'open',
        ci: ciOf(view.statusCheckRollup),
      }
      const merged = await mergedTickets($, found.number, new Set(tickets.map(t => t.number)))
      for (const t of tickets) t.isMerged = merged.has(t.number) || integration.state === 'merged'
    }

    await update($, flow, f => ({
      ...f,
      spec: f.spec && { ...f.spec, title: head.title },
      pr: integration?.number ?? f.pr,
      integration,
      tickets,
      error: null,
      refreshedAt: Date.now(),
    }))
  } catch (err) {
    await update($, flow, f => ({ ...f, error: String(err instanceof Error ? err.message : err) }))
  }
}

const setSpec = async ($: EngineInterface, number: number) => {
  await update($, flow, f =>
    f.spec?.number === number
      ? f
      : { ...f, spec: { number, title: '' }, pr: null, integration: null, tickets: [], error: null },
  )
  await refresh($)
}

// Bookkeeping never fails the call it watches.
const quietly = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch {
    // the pane misses one update; the session goes on
  }
}

// The agent's whole transcript in the main view, as the tasks list switches to it.
const openView = async ($: EngineInterface, view: { agentId?: string }) => {
  const moved = await $.ui.view(view)
  if (moved.deny) $.ui.toast(`Cannot open the transcript: ${moved.deny}`)
}

const enterSkill = async ($: EngineInterface, skill: string, args: string) => {
  const name = skill.replace(/^.*:/, '')
  const stage = STAGE_OF[name]
  if (!stage && !SIDE_SKILLS.has(name)) return
  await update($, flow, f => ({ ...f, stage: stage ?? f.stage, lastSkill: name }))
  if (stage) void $.ui.open({ id: PANE, title: TITLE })
  const spec = issueIn(args)
  if (spec !== null && (name === 'implement-spec' || name === 'to-tickets')) await setSpec($, spec)
}

export const register: Register = (on, options) => {
  // The `slots` setting wins over a cap read from the skill; 0 leaves it to the skill.
  const configuredCap = typeof options.slots === 'number' && options.slots > 0 ? options.slots : null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flow',
      description: 'Show the spec flow pane (/flow spec <n>, /flow refresh, /flow clear)',
      argumentHint: '[spec <n> | refresh | clear]',
    })
    $.clock.every(POLL_MS, () => void refresh($))
    const { spec, stage } = await current($)
    if (spec || stage) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'clear') {
      await update($, flow, () => EMPTY)
      return { text: 'Flow pane cleared.' }
    }
    if (verb === 'spec') {
      const n = issueIn(arg)
      if (n === null) return { text: 'Usage: /flow spec <issue number>' }
      await $.ui.open({ id: PANE, title: TITLE })
      await setSpec($, n)
      return { text: `Following spec #${n}.` }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    if (verb === 'refresh') await refresh($)
    return { text: 'Flow pane opened.' }
  })

  // A skill typed as /name args.
  on('prompt.submit', async ($, e, next) => {
    const m = /^\/([\w:-]+)\s*([\s\S]*)$/.exec(e.text.trim())
    if (m) await quietly(() => enterSkill($, m[1] ?? '', m[2] ?? ''))
    return next(e)
  })

  // Every skill the model or the person runs, whatever route it came by.
  on('skill.prompt', async ($, e, next) => {
    const args = /ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? ''
    await quietly(() => enterSkill($, e.skill, args))
    const cap = STAGE_OF[e.skill.replace(/^.*:/, '')] === 'implement' ? slotCapIn(e.text) : null
    if (cap !== null) await quietly(() => update($, flow, f => ({ ...f, slotCap: cap })))
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if ('deny' in started && started.deny) return started
    await quietly(async () => {
      const id = started.agentId ?? e.tool_use_id
      const spec = (await current($)).spec?.number
      const row: AgentRow = {
        id,
        role: roleOf(e.description, e.subagentType, e.prompt),
        description: e.description,
        type: e.subagentType,
        tickets: refsIn(`${e.description}\n${e.prompt}`)
          .filter(n => n !== spec)
          .slice(0, 4),
        status: 'running',
        activity: 'starting',
        report: '',
        startedAt: Date.now(),
        steps: [],
        tools: 0,
        errors: 0,
      }
      await update($, flow, f => ({ ...f, agents: [...f.agents.filter(a => a.id !== id), row].slice(-30) }))
    })

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    if (id)
      await quietly(async () => {
        const status: AgentRow['status'] = e.reason === 'answer' ? 'done' : 'failed'
        const report =
          e.answer
            .trim()
            .split('\n')
            .find(line => line.trim()) ?? ''
        await update($, flow, f => ({
          ...f,
          agents: f.agents.map(a => (a.id === id ? { ...a, status, report, endedAt: Date.now() } : a)),
        }))
        const row = (await current($)).agents.find(a => a.id === id)
        if (row?.role === 'merger' || row?.role === 'implementer') void refresh($)
      })

    return done
  })

  // What an agent writes between its tools: why it runs the next one, what it found.
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    const id = e.agentId
    const said = firstLine(step.answer)
    if (id && said) {
      const row: Step = {
        kind: 'say',
        id: `say-${step.turnId}-${step.index}`,
        text: said.slice(0, 300),
        status: 'ok',
        at: Date.now(),
      }
      await quietly(() =>
        update($, flow, f => withAgent(f, id, a => ({ ...a, steps: [...a.steps, row].slice(-STEPS_KEPT) }))),
      )
    }
    return step
  })

  let calls = 0
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    const stepId = e.tool_use_id ?? `call-${++calls}`
    const at = Date.now()
    if (id) {
      const activity = activityOf(e)
      const step: Step = { kind: 'tool', id: stepId, text: activity, status: 'running', at }
      await quietly(() =>
        update($, flow, f =>
          withAgent(f, id, a => ({
            ...a,
            activity,
            tools: a.tools + 1,
            steps: [...a.steps, step].slice(-STEPS_KEPT),
          })),
        ),
      )
    }
    const ran = await next(e)
    if (id) {
      const failure = 'deny' in ran && ran.deny ? ran.deny : ran.isError ? (ran.text ?? 'error') : null
      const error = failure === null ? undefined : firstLine(failure).slice(0, 200)
      await quietly(() =>
        update($, flow, f =>
          withAgent(f, id, a => ({
            ...a,
            errors: a.errors + (error === undefined ? 0 : 1),
            steps: a.steps.map(s =>
              s.id === stepId
                ? { ...s, status: error === undefined ? ('ok' as const) : ('error' as const), ms: Date.now() - at, error }
                : s,
            ),
          })),
        ),
      )
    }
    if (e.tool === 'Skill' && !id) await quietly(() => enterSkill($, e.skill, e.args ?? ''))
    if (e.tool === 'Bash')
      await quietly(async () => {
        const out = `${JSON.stringify(ran.result ?? '')}`
        const cmd = e.command
        const pr = /pull\/(\d+)/.exec(out)?.[1] ?? /pr:wait\s+(\d+)/.exec(cmd)?.[1]
        if (pr) await update($, flow, f => ({ ...f, pr: Number(pr) }))
        if (/gh pr merge/.test(cmd)) await update($, flow, f => ({ ...f, stage: 'ship' as const }))
        const { stage, spec } = await current($)
        if (/gh issue create/.test(cmd)) {
          const made = issueIn(out)
          if (stage === 'spec' && made !== null) await setSpec($, made)
          else if (spec) void refresh($)
        }
      })

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const f = await current($)
    const now = Date.now()
    const inner = Math.max(20, e.props.bodyColumns - 4)
    const merged = new Set(
      f.agents.filter(a => a.role === 'merger' && a.status === 'done').flatMap(a => a.tickets),
    )
    const isDone = (n: number) =>
      merged.has(n) || f.tickets.some(t => t.number === n && (t.isClosed || t.isMerged))
    const stateOf = (t: Ticket): { state: TicketState; note: string } => {
      if (t.isClosed) return { state: 'done', note: 'closed' }
      if (t.isMerged || merged.has(t.number)) return { state: 'done', note: 'merged' }
      const mine = f.agents.filter(a => a.tickets.includes(t.number))
      const busy = mine.find(a => a.status === 'running')
      if (busy?.role === 'merger') return { state: 'merging', note: 'merging' }
      if (busy) return { state: 'working', note: busy.role }
      if (mine.some(a => a.role === 'implementer' && a.status === 'done'))
        return { state: 'implemented', note: 'to merge' }
      if (mine.some(a => a.status === 'failed')) return { state: 'failed', note: 'failed' }
      const open = t.blockedBy.filter(n => !isDone(n))
      if (open.length) return { state: 'blocked', note: `after ${open.map(n => `#${n}`).join(' ')}` }
      return { state: 'ready', note: 'ready' }
    }
    const tickets = f.tickets.map(t => ({ ...t, ...stateOf(t) }))
    const count = (s: TicketState) => tickets.filter(t => t.state === s).length
    const done = count('done')
    const percent = tickets.length ? Math.round((done / tickets.length) * 100) : 0
    // Followed with /flow spec, no skill set the stage: the tickets say where the work stands.
    const stage: Stage | null =
      f.stage ??
      (f.integration?.state === 'merged'
        ? 'ship'
        : tickets.length
          ? done === tickets.length
            ? 'review'
            : 'implement'
          : f.spec
            ? 'tickets'
            : null)
    const at = stage ? STAGES.findIndex(s => s.stage === stage) : -1

    const running = f.agents.filter(a => a.status === 'running')
    const finished = f.agents
      .filter(a => a.status !== 'running')
      .slice(-4)
      .reverse()
    const slots = running.filter(a => a.role === 'implementer').length
    const cap = configuredCap ?? f.slotCap

    const pill = (text: string, bg: string, fg = INK, bold = false) => (
      <Text backgroundColor={bg} color={fg} bold={bold}>
        {` ${text} `}
      </Text>
    )
    const heading = (title: string, right?: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={ACCENT}>◆ </Text>
          <Text bold>{title}</Text>
        </Text>
        {right}
      </Box>
    )
    const card = (key: string, children: RenderChildren) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={EDGE} paddingX={1}>
        {children}
      </Box>
    )

    // One cell row split by ticket state, like the context bar.
    const bar = () => {
      if (!tickets.length) return <Text backgroundColor={TRACK}>{' '.repeat(inner)}</Text>
      let left = inner
      const cells = LEGEND.map(({ state }, i) => {
        const n = count(state)
        const width = i === LEGEND.length - 1 ? left : Math.round((n / tickets.length) * inner)
        left -= width
        return { state, width: Math.max(0, width) }
      })
      return (
        <Box flexDirection="row">
          {cells
            .filter(c => c.width > 0)
            .map(c => (
              <Text key={`bar-${c.state}`} backgroundColor={STATE_COLOR[c.state]}>
                {' '.repeat(c.width)}
              </Text>
            ))}
        </Box>
      )
    }

    // A digit focuses an agent: its steps laid out in full below the list.
    const listed = [...running, ...finished].slice(0, 9)
    const focused = f.agents.find(a => a.id === f.focus)
    const toggleFocus = (id: string) => update($, flow, g => ({ ...g, focus: g.focus === id ? null : id }))
    const counts = (a: AgentRow) => (
      <Text dimColor>
        {a.tools} tools{a.errors ? <Text color={STATE_COLOR.failed}> · {a.errors} ✗</Text> : ''}
      </Text>
    )

    const agentRow = (a: AgentRow) => {
      const color = ROLE_COLOR[a.role]
      const refs = a.tickets.map(n => `#${n}`).join(' ')
      const age = since(a.startedAt, a.endedAt ?? now)
      const label = ` ${a.activity.slice(0, inner - 3)}${a.activity.length > inner - 3 ? '…' : ''} `
      const digit = String(listed.indexOf(a) + 1)
      const isFocused = a.id === f.focus
      if (a.status !== 'running') {
        return (
          <Box key={`agent-${a.id}`} flexDirection="row" justifyContent="space-between">
            <Box flexShrink={1}>
              <Button key={`focus-${a.id}`} plain hotkey={digit} onPress={() => toggleFocus(a.id)}>
                <Text dimColor={!isFocused} bold={isFocused} wrap="truncate-end">
                  <Text color={a.status === 'done' ? STATE_COLOR.done : STATE_COLOR.failed}>
                    {a.status === 'done' ? '✓' : '✗'}{' '}
                  </Text>
                  {a.role}
                  {refs ? ` ${refs}` : ''} · {a.report || a.description}
                </Text>
              </Button>
            </Box>
            <Text dimColor> {age}</Text>
          </Box>
        )
      }
      return (
        <Box key={`agent-${a.id}`} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexShrink={1}>
              <Button key={`focus-${a.id}`} plain hotkey={digit} onPress={() => toggleFocus(a.id)}>
                <Text wrap="truncate-end">
                  <Text color={color}>{isFocused ? '◉ ' : '● '}</Text>
                  <Text bold>{a.role}</Text>
                  {refs ? <Text color={color}> {refs}</Text> : ''}
                  <Text dimColor> · {a.description}</Text>
                </Text>
              </Button>
            </Box>
            <Text>
              {counts(a)}
              <Text dimColor> ↻ {age}</Text>
            </Text>
          </Box>
          <Text>
            <Text backgroundColor={color} color={INK}>
              {label}
            </Text>
            <Text backgroundColor={TRACK}>{' '.repeat(inner - label.length)}</Text>
          </Text>
        </Box>
      )
    }

    const STEP_MARK: Record<Step['status'], { mark: string; color: string }> = {
      running: { mark: '●', color: ACCENT },
      ok: { mark: '✓', color: STATE_COLOR.done },
      error: { mark: '✗', color: STATE_COLOR.failed },
    }
    const stepRow = (s: Step) => {
      if (s.kind === 'say')
        return (
          <Text key={`step-${s.id}`} dimColor italic wrap="truncate-end">
            › {s.text}
          </Text>
        )
      const { mark, color } = STEP_MARK[s.status]
      return (
        <Box key={`step-${s.id}`} flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end" bold={s.status === 'running'}>
              <Text color={color}>{mark} </Text>
              {s.text}
            </Text>
            <Text dimColor> {s.status === 'running' ? `↻ ${since(s.at, now)}` : since(s.at, s.at + (s.ms ?? 0))}</Text>
          </Box>
          {s.error && (
            <Text color={STATE_COLOR.failed} dimColor wrap="truncate-end">
              {'  '}└ {s.error}
            </Text>
          )}
        </Box>
      )
    }
    const isViewed = (a: AgentRow) => e.props.view.agentId === a.id
    const stepsCard = (a: AgentRow) => {
      const shown = a.steps.slice(-STEPS_SHOWN)
      const hidden = a.steps.length - shown.length
      return (
        <Box flexDirection="column">
          {heading(
            `${a.role}${a.tickets.length ? ` ${a.tickets.map(n => `#${n}`).join(' ')}` : ''}`,
            <Text>
              {counts(a)}
              <Text dimColor> · {since(a.startedAt, a.endedAt ?? now)}</Text>
            </Text>,
          )}
          <Text dimColor wrap="truncate-end">
            {a.description} · {a.type}
          </Text>
          <Text> </Text>
          {a.steps.length === 0 && <Text dimColor>Nothing yet.</Text>}
          {hidden > 0 && <Text dimColor>… {hidden} earlier steps in the transcript</Text>}
          {shown.map(stepRow)}
          {a.status !== 'running' && a.report && (
            <Text wrap="truncate-end">
              <Text color={a.status === 'done' ? STATE_COLOR.done : STATE_COLOR.failed}>⏎ </Text>
              {a.report}
            </Text>
          )}
          <Box flexDirection="row" columnGap={1} marginTop={1}>
            {isViewed(a) ? (
              <Button key="view" label="Main transcript" hotkey="o" onPress={() => openView($, {})} />
            ) : (
              <Button key="view" label="Open transcript" hotkey="o" onPress={() => openView($, { agentId: a.id })} />
            )}
            <Button key="unfocus" label="Close" hotkey="x" onPress={() => toggleFocus(a.id)} />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {header({ Box, Text }, PANE, e.props.bodyColumns)}
        {card(
          'flow',
          <Box flexDirection="column">
            {heading(
              'flow',
              <Text>
                <Text dimColor>{f.spec ? `spec #${f.spec.number}` : 'no spec'} </Text>
                {pill(
                  `${percent}%`,
                  percent === 100 ? STATE_COLOR.done : TRACK,
                  percent === 100 ? INK : 'white',
                  true,
                )}
              </Text>,
            )}
            {f.spec?.title ? (
              <Text bold wrap="truncate-end">
                {headline(f.spec.title)}
              </Text>
            ) : (
              !f.spec && <Text dimColor>/flow spec &lt;n&gt; to follow one</Text>
            )}
            {f.integration ? (
              <Box flexDirection="row" justifyContent="space-between">
                <Text dimColor wrap="truncate-end">
                  PR #{f.integration.number} · {f.integration.state} · {f.integration.branch}
                </Text>
                {pill(CI_LABEL[f.integration.ci], CI_COLOR[f.integration.ci])}
              </Box>
            ) : (
              f.pr !== null && <Text dimColor>PR #{f.pr}</Text>
            )}
            <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
              {STAGES.map((s, i) => (
                <Text key={`stage-${s.stage}`}>
                  {i > 0 ? <Text color={EDGE}>▸</Text> : ''}
                  {i === at
                    ? pill(s.label, ACCENT, INK, true)
                    : i < at
                      ? pill(s.label, PAST_BG, STATE_COLOR.done)
                      : pill(s.label, TRACK, 'gray')}
                </Text>
              ))}
            </Box>
            {f.lastSkill && <Text dimColor>last skill /{f.lastSkill}</Text>}
          </Box>,
        )}

        {card(
          'agents',
          <Box flexDirection="column">
            {heading(
              'agents',
              <Text>
                {Array.from({ length: cap ?? slots }, (_, i) => (
                  <Text key={`slot-${i}`} color={i < slots ? ROLE_COLOR.implementer : EDGE}>
                    {i < slots ? '■' : '□'}{' '}
                  </Text>
                ))}
                <Text dimColor>
                  {cap !== null
                    ? `${slots}/${cap} slots`
                    : slots
                      ? `${slots} implementing`
                      : 'none implementing'}
                </Text>
              </Text>,
            )}
            {running.length === 0 && finished.length === 0 && <Text dimColor>No agents yet.</Text>}
            {running.length > 0 && <Text> </Text>}
            {running.map(agentRow)}
            {finished.map(agentRow)}
            {listed.length > 0 && !focused && <Text dimColor>1–{listed.length} shows what an agent did</Text>}
          </Box>,
        )}

        {focused && card('steps', stepsCard(focused))}

        {card(
          'tickets',
          <Box flexDirection="column">
            {heading(
              'tickets',
              <Text dimColor>{tickets.length ? `${done} of ${tickets.length} done` : 'none yet'}</Text>,
            )}
            {bar()}
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {LEGEND.filter(l => count(l.state) > 0).map(l => (
                <Text key={`legend-${l.state}`}>
                  <Text color={STATE_COLOR[l.state]}>■ </Text>
                  {l.label} <Text bold>{count(l.state)}</Text>
                </Text>
              ))}
            </Box>
            {tickets.length > 0 && <Text> </Text>}
            {tickets.map(t => (
              <Box key={`ticket-${t.number}`} flexDirection="row" justifyContent="space-between">
                <Box flexShrink={1}>
                  <Text wrap="truncate-end" dimColor={t.state === 'done' || t.state === 'blocked'}>
                    <Text color={STATE_COLOR[t.state]}>■ </Text>
                    <Text bold>#{t.number}</Text> {shortTitle(t.title)}
                  </Text>
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                  {ACTIVE.has(t.state) ? (
                    pill(t.note, STATE_COLOR[t.state])
                  ) : (
                    <Text
                      color={t.state === 'blocked' ? undefined : STATE_COLOR[t.state]}
                      dimColor={t.state !== 'ready'}
                    >
                      {t.note}
                    </Text>
                  )}
                </Box>
              </Box>
            ))}
          </Box>,
        )}

        {f.error && <Text color={STATE_COLOR.failed}> gh: {f.error}</Text>}
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refresh($)} />
            <Button key="clear" label="Clear" hotkey="c" onPress={() => update($, flow, () => EMPTY)} />
          </Box>
          {f.refreshedAt !== null && <Text dimColor>↻ {since(f.refreshedAt, now)} ago</Text>}
        </Box>
      </Box>
    )
  })
}
