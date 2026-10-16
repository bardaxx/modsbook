import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type {
  Entry,
  GraphMessage,
  GraphProps,
  Line,
  MapView,
  Question,
  RoundStep,
  Run,
  Step,
  Tab,
  Target,
  Ticket,
  TicketType,
  Wayfinder,
} from '../types'
import { applyReply, dialogRound, firstLine, isWaiting, isWrapDue, lastTurn, markOf, parseRound, plain, settleWrap } from './reply'
import { header } from './header'
import {
  cut,
  docTraceOf,
  foldAllButton,
  foldsInto,
  isDocPath,
  lookupOf,
  since,
  spineHeading,
  spineRows,
  termsFoldInto,
} from './spine'

const PANE = 'wayfinder-map'
const TITLE = 'Wayfinder'
const POLL_MS = 60_000
// About 800 KB at worst, of the store's 4 MiB in all.
const LINES_KEPT = 400

// The modsbook palette: muted pills on a dark track, dark ink on the pills.
const INK = '#151515'
const TRACK = '#2b2b2b'
const EDGE = '#4a4a4a'
const ACCENT = '#d97757'
const FOG = '#8a93a6'
type State = 'resolved' | 'claimed' | 'frontier' | 'blocked'
const STATE_COLOR: Record<State, string> = {
  resolved: '#5ccf9f',
  claimed: ACCENT,
  frontier: '#e2b867',
  blocked: '#5a5a5a',
}
const STATE_MARK: Record<State, string> = { resolved: '✓', claimed: '●', frontier: '◇', blocked: '○' }
const LEGEND: { state: State; label: string }[] = [
  { state: 'resolved', label: 'resolved' },
  { state: 'claimed', label: 'claimed' },
  { state: 'frontier', label: 'frontier' },
  { state: 'blocked', label: 'blocked' },
]
const TYPE_COLOR: Record<TicketType, string> = {
  grilling: '#b79cf5',
  prototype: '#7fb4f5',
  research: '#6fd3c8',
  task: '#c9a26b',
}
// Who resolves each type (the skill's Ticket Types).
const MODE: Record<TicketType, string> = { grilling: 'HITL', prototype: 'HITL', research: 'AFK', task: 'either' }
const TYPES = new Set<string>(['research', 'prototype', 'grilling', 'task'])

const EMPTY: Wayfinder = {
  target: null,
  map: null,
  lines: [],
  tab: 'route',
  focus: null,
  turned: [],
  isAllUnfolded: false,
  error: null,
  refreshedAt: null,
}
const way = atom({ plugin: 'wayfinder-map', key: 'way' } as const, EMPTY)
const running = atom({ plugin: 'wayfinder-map', key: 'run' } as const, null)

// State kept from an older version lacks the fields added since; its `grill` tab is gone.
const current = async ($: EngineInterface): Promise<Wayfinder> => {
  const w = { ...EMPTY, ...(await read($, way)) }
  return w.tab === 'route' || w.tab === 'decisions' ? w : { ...w, tab: 'route' }
}
const runOf = async ($: EngineInterface): Promise<Run | null> => (await read($, running)) ?? null

let made = 0
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}-${made++}`

// ── The map and its tickets, as the tracker doc's "Wayfinding operations" lay them out ──

/** `## Heading` → its body, lower-cased headings, HTML comments dropped. */
const sections = (md: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const part of md.replace(/<!--[\s\S]*?-->/g, '').split(/^##[ \t]+/m).slice(1)) {
    const nl = part.indexOf('\n')
    const head = (nl < 0 ? part : part.slice(0, nl)).trim().toLowerCase()
    out[head] = nl < 0 ? '' : part.slice(nl + 1).trim()
  }
  return out
}

const items = (body: string) =>
  body
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '').trim())
    .filter(Boolean)

const ticketIdIn = (text: string): string | null => {
  const m = /issues\/(\d+)/.exec(text) ?? /#(\d+)\b/.exec(text)
  return m ? String(Number(m[1])) : null
}

/** `- [Title](link): gist`, or `- Title: gist`. */
const entry = (line: string): Entry => {
  const linked = /^\[([^\]]+)\]\(([^)]*)\)\s*(?:[:—–-]\s*)?([\s\S]*)$/.exec(line)
  if (linked) return { title: plain(linked[1] ?? ''), gist: plain(linked[3] ?? ''), ticket: ticketIdIn(linked[2] ?? '') }
  const split = /^(.+?):\s+([\s\S]+)$/.exec(line)
  return split
    ? { title: plain(split[1] ?? ''), gist: plain(split[2] ?? ''), ticket: ticketIdIn(line) }
    : { title: plain(line), gist: '', ticket: ticketIdIn(line) }
}

const mapBody = (md: string) => {
  const s = sections(md)
  return {
    destination: plain(s['destination'] ?? ''),
    notes: plain(s['notes'] ?? ''),
    decisions: items(s['decisions so far'] ?? '').map(entry),
    fog: items(s['not yet specified'] ?? '').map(plain),
    outOfScope: items(s['out of scope'] ?? '').map(entry),
  }
}

const blockersIn = (text: string): string[] | null => {
  const m = /^\s*\**blocked by\**:?\**\s*(.*)$/im.exec(text)
  return m ? [...(m[1] ?? '').matchAll(/\d+/g)].map(n => String(Number(n[0]))) : null
}

// A ticket the map's Out of scope section links, or one closed as not planned.
const scoped = (tickets: Ticket[], outOfScope: Entry[]) => {
  const out = new Set(outOfScope.map(e => e.ticket).filter(Boolean))
  return tickets.map(t => (out.has(t.id) ? { ...t, isOutOfScope: true, isClosed: true } : t))
}

const gh = async ($: EngineInterface, args: string[]) => {
  const run = await $.process.run(['gh', ...args], { timeoutMs: 20_000 })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n')[0] || `gh ${args[0]} failed`)
  return run.stdout
}

type GhIssue = {
  number: number
  title: string
  state: string
  state_reason?: string | null
  stateReason?: string | null
  body: string | null
  labels?: { name: string }[]
  assignees?: { login: string }[]
  html_url?: string
  url?: string
  issue_dependencies_summary?: { total_blocked_by?: number }
}

const fromGh = async ($: EngineInterface, issue: GhIssue): Promise<Ticket> => {
  const body = issue.body ?? ''
  const label = (issue.labels ?? []).map(l => l.name).find(n => n.startsWith('wayfinder:'))
  const type = label?.slice('wayfinder:'.length) ?? ''
  let blockedBy = blockersIn(body)
  if (blockedBy === null) {
    // Native blocking: the canonical edges, one call per ticket that has any.
    if (issue.issue_dependencies_summary?.total_blocked_by === 0) blockedBy = []
    else {
      try {
        const deps = JSON.parse(
          await gh($, ['api', `repos/{owner}/{repo}/issues/${issue.number}/dependencies/blocked_by`]),
        ) as { number: number }[]
        blockedBy = deps.map(d => String(d.number))
      } catch {
        blockedBy = []
      }
    }
  }
  const reason = (issue.state_reason ?? issue.stateReason ?? '').toLowerCase()
  return {
    id: String(issue.number),
    title: issue.title,
    type: TYPES.has(type) ? (type as TicketType) : null,
    isClosed: issue.state.toLowerCase() === 'closed',
    isClaimed: (issue.assignees ?? []).length > 0,
    isOutOfScope: reason === 'not_planned',
    blockedBy,
    link: issue.html_url ?? issue.url ?? '',
    question: plain(sections(body)['question'] ?? firstLine(body)),
  }
}

const readGithub = async ($: EngineInterface, ref: string): Promise<MapView> => {
  const head = JSON.parse(await gh($, ['issue', 'view', ref, '--json', 'number,title,body,url'])) as {
    title: string
    body: string
    url: string
  }
  let subs: GhIssue[] = []
  try {
    subs = JSON.parse(await gh($, ['api', `repos/{owner}/{repo}/issues/${ref}/sub_issues?per_page=100`])) as GhIssue[]
  } catch {
    // no sub-issues on this repository: the map's task list names the children
  }
  if (!subs.length) {
    const refs = [...head.body.matchAll(/^\s*[-*]\s*\[[ xX]\]\s*.*?#(\d+)/gm)].map(m => m[1] ?? '')
    subs = await Promise.all(
      refs.map(
        async n =>
          JSON.parse(
            await gh($, ['issue', 'view', n, '--json', 'number,title,state,stateReason,body,labels,assignees,url']),
          ) as GhIssue,
      ),
    )
  }
  const body = mapBody(head.body)
  const tickets = await Promise.all(subs.map(s => fromGh($, s)))
  return { title: head.title, link: head.url, ...body, tickets: scoped(tickets, body.outOfScope) }
}

const readLocal = async ($: EngineInterface, dir: string): Promise<MapView> => {
  const md = await $.fs.read(`${dir}/map.md`)
  const body = mapBody(md)
  const files = (await $.fs.list(`${dir}/issues`).catch(() => []))
    .filter(f => f.kind === 'file' && /^\d+.*\.md$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const tickets = await Promise.all(
    files.map(async (f): Promise<Ticket> => {
      const path = `${dir}/issues/${f.name}`
      const text = await $.fs.read(path)
      const s = sections(text)
      const status = (/^\s*\**status\**:?\**\s*(.+)$/im.exec(text)?.[1] ?? '').toLowerCase()
      const type = (/^\s*\**type\**:?\**\s*(\w+)/im.exec(text)?.[1] ?? '').toLowerCase()
      const slug = f.name.replace(/^\d+-?/, '').replace(/\.md$/, '').replace(/[-_]+/g, ' ')
      const answer = plain(s['answer'] ?? '')
      return {
        id: String(Number(/^\d+/.exec(f.name)?.[0] ?? f.name)),
        title: plain(/^#[ \t]+(.+)$/m.exec(text)?.[1] ?? slug),
        type: TYPES.has(type) ? (type as TicketType) : null,
        isClosed: /resolved|closed|done|scope|wontfix|dropped/.test(status),
        isClaimed: /claimed/.test(status),
        isOutOfScope: /scope/.test(status),
        blockedBy: blockersIn(text) ?? [],
        link: path,
        question: plain(s['question'] ?? ''),
        ...(answer ? { answer } : {}),
      }
    }),
  )
  const effort = dir.split('/').pop() ?? dir
  return {
    title: plain(/^#[ \t]+(.+)$/m.exec(md)?.[1] ?? effort.replace(/[-_]+/g, ' ')),
    link: `${dir}/map.md`,
    ...body,
    tickets: scoped(tickets, body.outOfScope),
  }
}

// ── The Spines: each ticket's lines and Charting's, kept per map ──

const spineKey = (t: Target) => `spine:${t.source}:${t.ref}`
// Before the Spine: the last rounds alone, read once and moved over.
const roundsKey = (t: Target) => `rounds:${t.source}:${t.ref}`
type OldRound = {
  id: string
  ticket: string | null
  at: number
  kind: 'grilling' | 'dialog'
  questions: (Omit<Question, 'body'> & { body?: string })[]
  reply?: string
}
const fromOld = (r: OldRound): Line => ({
  kind: 'round',
  id: r.id,
  at: r.at,
  via: r.kind,
  questions: r.questions.map(q => ({ ...q, body: q.body ?? '' })),
  ...(r.reply !== undefined ? { reply: r.reply } : {}),
  ticket: r.ticket,
})

/** A ticket's Spine, or Charting's for `null`. */
const linesOf = (lines: Line[], ticket: string | null): Step[] => lines.filter(l => l.ticket === ticket)

/**
 * Past the cap, the oldest lookups go first, never a Level or a Wrap-up; past that, the oldest lines
 * of closed tickets, never the open ticket's or Charting's.
 */
const capped = (lines: Line[], map: MapView | null, open: string | null): Line[] => {
  const closed = new Set((map?.tickets ?? []).filter(t => t.isClosed).map(t => t.id))
  const out = [...lines]
  while (out.length > LINES_KEPT) {
    let i = out.findIndex(l => l.kind === 'lookup')
    if (i < 0) i = out.findIndex(l => l.ticket !== null && l.ticket !== open && closed.has(l.ticket))
    if (i < 0) break
    out.splice(i, 1)
  }
  return out
}

const saveLines = async ($: EngineInterface) => {
  const { target, lines } = await current($)
  if (target) await $.store.set(spineKey(target), lines)
}

/** The lines stored for a map; a map kept before the Spine has its rounds moved over, once. */
const storedLines = async ($: EngineInterface, target: Target): Promise<Line[]> => {
  const stored = (await $.store.get(spineKey(target))) as Line[] | undefined
  if (stored) return stored
  const old = (await $.store.get(roundsKey(target))) as OldRound[] | undefined
  if (!old) return []
  const lines = old.map(fromOld)
  await $.store.set(spineKey(target), lines)
  await $.store.delete(roundsKey(target))
  return lines
}

// ── The Run: the stretch of a conversation that works a map ──

let shownStatus: string | undefined

/** Inside a Run, the line the claimed ticket's Spine (or Charting's) stands at; none outside. */
const syncStatus = async ($: EngineInterface) => {
  const run = await runOf($)
  let text: string | undefined
  if (run) {
    const steps = linesOf((await current($)).lines, run.ticket?.id ?? null)
    const subject = run.ticket ? cut(run.ticket.title, 32) : 'charting'
    const rounds = steps.filter((s): s is RoundStep => s.kind === 'round')
    const last = rounds.at(-1)
    const step = lastTurn(steps)
    const left = last ? last.questions.filter(q => markOf(q, last) === 'open').length : 0
    text =
      step?.kind === 'wrap' && step.reply === undefined
        ? `${subject} · confirm the shared understanding`
        : last && isWaiting(last)
          ? `${subject} · L${rounds.length} · ${left} open`
          : last
            ? `${subject} · L${rounds.length} · next frontier`
            : `${subject} · starting`
  }
  if (text === shownStatus) return
  shownStatus = text
  $.ui.status(text)
}

const endRun = async ($: EngineInterface) => {
  await update($, running, () => null)
  await syncStatus($)
}

/** A claim seen in the Run: its lines go to that ticket until it closes. */
const claim = async ($: EngineInterface, id: string) => {
  if (!(await runOf($))) return
  const { map } = await current($)
  const title = map?.tickets.find(t => t.id === id)?.title ?? `#${id}`
  await update($, running, r => (r ? { ticket: { id, title }, claimedAt: Date.now() } : r))
  await syncStatus($)
}

// ── Following a map ──

let refreshing: Promise<void> | null = null
let isPending = false

const refresh = async ($: EngineInterface): Promise<void> => {
  if (refreshing) {
    isPending = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      isPending = false
      const { target } = await current($)
      if (!target) break
      try {
        const map = target.source === 'github' ? await readGithub($, target.ref) : await readLocal($, target.ref)
        await update($, way, w => {
          // A GitHub answer fetched on focus stays until the ticket reopens.
          const kept = new Map((w.map?.tickets ?? []).map(t => [t.id, t.answer]))
          const tickets = map.tickets.map(t => (t.answer || !t.isClosed ? t : { ...t, answer: kept.get(t.id) }))
          return { ...w, map: { ...map, tickets }, error: null, refreshedAt: Date.now() }
        })
        // The ticket worked on closed: later lines land on Charting until the next claim.
        const run = await runOf($)
        if (run?.ticket && map.tickets.find(t => t.id === run.ticket?.id)?.isClosed) {
          await update($, running, r => (r ? { ...r, ticket: null } : r))
          await syncStatus($)
        }
      } catch (err) {
        await update($, way, w => ({ ...w, error: String(err instanceof Error ? err.message : err) }))
      }
    } while (isPending)
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

const follow = async ($: EngineInterface, target: Target) => {
  const was = (await current($)).target
  if (was?.source === target.source && was.ref === target.ref) return refresh($)
  const stored = await storedLines($, target)
  await update($, way, w => {
    // Charting held before the map existed joins it; another map's lines stay with that map.
    const carried = w.target ? [] : w.lines
    const ids = new Set(carried.map(l => l.id))
    const lines = [...stored.filter(l => !ids.has(l.id)), ...carried].sort((a, b) => a.at - b.at)
    return { ...w, target, map: null, focus: null, lines, turned: [], error: null }
  })
  await saveLines($)
  void $.ui.open({ id: PANE, title: TITLE })
  return refresh($)
}

/** A map named in the skill's or the command's argument: a URL, `#42`, `42`, or a `.scratch/<effort>` path. */
const targetIn = (text: string): Target | null => {
  const local = /(\S*\.scratch\/[^/\s]+)/.exec(text)?.[1]
  if (local) return { source: 'local', ref: local.replace(/\/(map\.md|issues.*)$/, '') }
  const n = /issues\/(\d+)/.exec(text)?.[1] ?? /^\s*#?(\d+)\s*$/.exec(text)?.[1]
  return n ? { source: 'github', ref: n } : null
}

// A map the repo already has: the newest `.scratch/*/map.md`, else the newest open `wayfinder:map` issue.
const discover = async ($: EngineInterface): Promise<Target | null> => {
  const dirs = (await $.fs.list('.scratch').catch(() => [])).filter(d => d.kind === 'dir')
  const maps = await Promise.all(
    dirs.map(async d => {
      const stat = await $.fs.stat(`.scratch/${d.name}/map.md`).catch(() => null)
      return stat ? { ref: `.scratch/${d.name}`, at: stat.mtimeMs } : null
    }),
  )
  const local = maps.filter(m => m !== null).sort((a, b) => b.at - a.at)[0]
  if (local) return { source: 'local', ref: local.ref }
  try {
    const open = JSON.parse(
      await gh($, ['issue', 'list', '--label', 'wayfinder:map', '--state', 'open', '--limit', '1', '--json', 'number']),
    ) as { number: number }[]
    return open[0] ? { source: 'github', ref: String(open[0].number) } : null
  } catch {
    return null
  }
}

const SCRATCH = /^(.*\.scratch\/[^/]+)\/(?:map\.md|issues\/(\d+)[^/]*\.md)$/

// Bookkeeping never fails the call it watches.
const quietly = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch {
    // the pane misses one update; the session goes on
  }
}

/**
 * Writes the Run's lines: `fn` gets them with the ticket a new line goes to (null for Charting) and
 * the map. Outside a Run nothing lands: a map followed by hand keeps no Spine.
 */
const record = async ($: EngineInterface, fn: (lines: Line[], ticket: string | null, map: MapView | null) => Line[]) => {
  const run = await runOf($)
  if (!run) return
  const ticket = run.ticket?.id ?? null
  await update($, way, w => ({ ...w, lines: capped(fn(w.lines, ticket, w.map), w.map, ticket) }))
  await saveLines($)
}

const mapLine = (lines: Line[], id: string, fn: (l: Line) => Line) => lines.map(l => (l.id === id ? fn(l) : l))

/** The newest line, when it is the given ticket's: what a read or a term folds into. */
const lastOf = (lines: Line[], ticket: string | null) => {
  const last = lines.at(-1)
  return last?.ticket === ticket ? last : undefined
}

/** Once the map has a ticket, Charting keeps no lookups: those are a session reading the map to choose one. */
const keepsLookups = (ticket: string | null, map: MapView | null) => ticket !== null || !map?.tickets.length

// A new Level takes the focus: every Level unfolded by hand folds again.
const addLevel = async ($: EngineInterface, round: RoundStep) => {
  await record($, (lines, ticket) => [...lines, { ...round, ticket }])
  await update($, way, w => ({ ...w, turned: [] }))
  await syncStatus($)
  void $.ui.open({ id: PANE, title: TITLE })
}

const fetchAnswer = async ($: EngineInterface, id: string) => {
  const { target, map } = await current($)
  const t = map?.tickets.find(x => x.id === id)
  if (target?.source !== 'github' || !t?.isClosed || t.answer) return
  const view = JSON.parse(await gh($, ['issue', 'view', id, '--json', 'comments'])) as { comments: { body: string }[] }
  const answer = plain(view.comments.at(-1)?.body ?? '') || 'Closed with no comment.'
  await update($, way, w =>
    w.map ? { ...w, map: { ...w.map, tickets: w.map.tickets.map(x => (x.id === id ? { ...x, answer } : x)) } } : w,
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'waymap',
      description: 'Show the wayfinder map pane (/waymap <map>, /waymap refresh, /waymap clear)',
      argumentHint: '[<issue> | <.scratch/effort> | refresh | clear]',
    })
    $.clock.every(POLL_MS, () => void refresh($))
    const { target, lines } = await current($)
    if (target || lines.length) {
      void $.ui.open({ id: PANE, title: TITLE })
      void refresh($)
    }
    shownStatus = undefined
    await quietly(() => syncStatus($))
    return next(e)
  })

  // `/clear` ends the conversation, and the Run with it; compact, resume and fork keep it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await quietly(() => endRun($))
    return next(e)
  })

  on('command.run', { command: 'waymap' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'clear') {
      await update($, way, () => EMPTY)
      await endRun($)
      return { text: 'Wayfinder pane cleared.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    if (arg === 'refresh' || arg === '') {
      const { target } = await current($)
      if (target) {
        await refresh($)
        return { text: 'Wayfinder pane opened.' }
      }
      const found = await discover($)
      if (!found) return { text: 'No wayfinder map found here. /waymap <issue> or /waymap .scratch/<effort> names one.' }
      await follow($, found)
      return { text: `Following the map at ${found.source === 'github' ? `#${found.ref}` : found.ref}.` }
    }
    const named = targetIn(arg)
    if (!named) return { text: 'Usage: /waymap [<issue number or URL> | .scratch/<effort> | refresh | clear]' }
    await follow($, named)
    return { text: `Following the map at ${named.source === 'github' ? `#${named.ref}` : named.ref}.` }
  })

  // /wayfinder starts a Run: with a map it works through it; with a loose idea it charts one, found once it is created.
  // A grill the person asks for by name ends it.
  on('skill.prompt', async ($, e, next) => {
    const name = e.skill.replace(/^.*:/, '')
    if (name === 'wayfinder')
      await quietly(async () => {
        await update($, running, r => r ?? { ticket: null, claimedAt: null })
        const args = /ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? ''
        const named = targetIn(args)
        if (named) await follow($, named)
        else void $.ui.open({ id: PANE, title: TITLE })
        await syncStatus($)
      })
    if (name === 'grill-me' || name === 'grill-with-docs') await quietly(() => endRun($))
    return next(e)
  })

  // The person's reply: the answers to the newest Level still waiting, or their word on the Wrap-up.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && e.text.trim())
      await quietly(async () => {
        const text = e.text.trim()
        await record($, (lines, ticket) => {
          const last = lastTurn(linesOf(lines, ticket))
          if (last?.kind === 'round' && last.reply === undefined)
            return mapLine(lines, last.id, l => ({ ...applyReply(last, text), ticket: l.ticket }))
          if (last?.kind === 'wrap' && last.reply === undefined)
            return mapLine(lines, last.id, l => ({ ...settleWrap(last, text), ticket: l.ticket }))
          return lines
        })
        await syncStatus($)
      })
    return next(e)
  })

  // A Level is a main-loop turn that ends on questions; one that ends without them, once answered, is the Wrap-up.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.reason === 'answer')
      await quietly(async () => {
        const questions = parseRound(e.answer)
        if (questions.length)
          return addLevel($, { kind: 'round', id: newId('r'), at: Date.now(), via: 'grilling', questions })
        await record($, (lines, ticket) =>
          isWrapDue(linesOf(lines, ticket))
            ? [...lines, { kind: 'wrap', id: newId('w'), at: Date.now(), text: cut(plain(e.answer), 600), ticket }]
            : lines,
        )
        await syncStatus($)
      })
    return done
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const isRun = (await runOf($)) !== null

    // A fact the agent sends a sub-agent for: one Trace, running until the sub-agent reports.
    let agent: string | null = null
    if (isRun && e.tool === 'Agent') {
      const id = newId('l')
      agent = id
      await quietly(() =>
        record($, (lines, ticket, map) =>
          keepsLookups(ticket, map)
            ? [...lines, { kind: 'lookup', id, at: Date.now(), label: plain(e.description), isAgent: true, count: 1, isDone: false, ticket }]
            : lines,
        ),
      )
    }

    const path = e.tool === 'Write' || e.tool === 'Edit' ? e.file_path : ''
    const isDoc = isRun && isDocPath(path)
    const before = e.tool === 'Write' && isDoc ? await $.fs.read(path).catch(() => null) : null
    const wasClaimed = new Set(((await current($)).map?.tickets ?? []).filter(t => t.isClaimed).map(t => t.id))

    const ran = await next(e)
    if (agent) {
      const id = agent
      await quietly(() => record($, lines => mapLine(lines, id, l => (l.kind === 'lookup' ? { ...l, isDone: true } : l))))
    }
    if (('deny' in ran && ran.deny) || ran.isError) return ran

    if (isRun && e.tool === 'AskUserQuestion')
      await quietly(() => addLevel($, dialogRound(e.questions, ran.result, newId('r'), Date.now())))

    // Reads and searches between Levels fold into one lookup.
    const looked = isRun ? lookupOf(e.tool, e as unknown as Record<string, unknown>) : null
    if (looked !== null)
      await quietly(() =>
        record($, (lines, ticket, map) => {
          if (!keepsLookups(ticket, map)) return lines
          const last = lastOf(lines, ticket)
          const label = cut(looked, 60)
          return foldsInto(last)
            ? mapLine(lines, last.id, l => (l.kind === 'lookup' ? { ...l, count: l.count + 1, label } : l))
            : [...lines, { kind: 'lookup', id: newId('l'), at: Date.now(), label, isAgent: false, count: 1, isDone: true, ticket }]
        }),
      )

    // The glossary's resolved terms and the ADRs, as they are written.
    if (isDoc && (e.tool === 'Write' || e.tool === 'Edit'))
      await quietly(async () => {
        const trace =
          e.tool === 'Write'
            ? docTraceOf(path, e.content, before, false, newId('d'), Date.now())
            : docTraceOf(path, e.new_string, e.old_string, true, newId('d'), Date.now())
        if (!trace) return
        await record($, (lines, ticket) => {
          const last = lastOf(lines, ticket)
          return trace.kind === 'term' && termsFoldInto(last, path)
            ? mapLine(lines, last.id, l => (l.kind === 'term' ? { ...l, terms: [...new Set([...l.terms, ...trace.terms])] } : l))
            : [...lines, { ...trace, ticket }]
        })
      })

    if (e.tool === 'Write' || e.tool === 'Edit')
      await quietly(async () => {
        const m = SCRATCH.exec(e.file_path)
        if (!m) return
        const text = e.tool === 'Write' ? e.content : e.new_string
        const id = m[2] ? String(Number(m[2])) : null
        await follow($, { source: 'local', ref: m[1] ?? '' })
        if (id && /^\s*\**status\**:?\**\s*claimed/im.test(text)) await claim($, id)
      })

    if (e.tool === 'Bash')
      await quietly(async () => {
        const cmd = e.command
        const out = JSON.stringify(ran.result ?? '')
        const { target } = await current($)
        if (/wayfinder:map/.test(cmd) && /gh issue create/.test(cmd)) {
          const made = /issues\/(\d+)/.exec(out)?.[1]
          if (made) return follow($, { source: 'github', ref: made })
        }
        const claimed = /gh issue edit\s+#?(\d+)[^|;&]*--add-assignee/.exec(cmd)?.[1]
        const touches =
          target?.source === 'github'
            ? /\bgh (issue|api)\b/.test(cmd) && !/gh issue (view|list)\b/.test(cmd)
            : target?.source === 'local' && /\.scratch\//.test(cmd)
        if (!touches) return
        if (target?.source === 'github' && !claimed) return void refresh($)
        await refresh($)
        if (claimed) return claim($, claimed)
        // A local claim made from the shell: a ticket file the command named, claimed now and not before.
        if (target?.source === 'local') {
          const named = new Set([...cmd.matchAll(/issues\/(\d+)/g)].map(n => String(Number(n[1]))))
          const now = (await current($)).map?.tickets.find(t => named.has(t.id) && t.isClaimed && !t.isClosed && !wasClaimed.has(t.id))
          if (now) await claim($, now.id)
        }
      })

    return ran
  })

  // The graph moved its selection: the ticket's card follows it.
  on('ui.message', { element: 'graph' }, async ($, e) => {
    const data = e.data as Partial<GraphMessage> | null
    if (data && typeof data === 'object' && 'focus' in data) {
      const focus = typeof data.focus === 'string' ? data.focus : null
      await update($, way, w => ({ ...w, focus }))
      if (focus) await quietly(() => fetchAnswer($, focus))
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    // The graph needs a surface module's region: the terminal and the desktop draw one.
    const Client =
      (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in elements ? elements.Client : undefined
    const el = { Box, Text, Button }
    const w = await current($)
    const run = await runOf($)
    const mine = run?.ticket?.id ?? null
    const now = Date.now()
    const inner = Math.max(24, e.props.bodyColumns - 4)
    const map = w.map
    const all = map?.tickets ?? []
    const tickets = all.filter(t => !t.isOutOfScope)
    const byId = new Map(all.map(t => [t.id, t]))
    const name = (id: string) => byId.get(id)?.title ?? `#${id}`
    const isOpen = (id: string) => byId.has(id) && !byId.get(id)?.isClosed

    const stateOf = (t: Ticket): State =>
      t.isClosed ? 'resolved' : t.isClaimed ? 'claimed' : t.blockedBy.some(isOpen) ? 'blocked' : 'frontier'
    // The skill takes the first frontier ticket in map order.
    const next = tickets.find(t => stateOf(t) === 'frontier')
    const count = (s: State) => tickets.filter(t => stateOf(t) === s).length

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
    const typeChip = (t: Ticket) =>
      t.type ? <Text color={TYPE_COLOR[t.type]}>{t.type}</Text> : <Text dimColor>untyped</Text>

    const bar = () => {
      if (!tickets.length) return <Text backgroundColor={TRACK}>{' '.repeat(inner)}</Text>
      let left = inner
      const cells = LEGEND.map(({ state }, i) => {
        const width = i === LEGEND.length - 1 ? left : Math.round((count(state) / tickets.length) * inner)
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

    // ── route: the tickets as a tree, each under the deepest ticket that blocks it ──
    const depth = new Map<string, number>()
    const depthOf = (t: Ticket, seen = new Set<string>()): number => {
      const known = depth.get(t.id)
      if (known !== undefined) return known
      if (seen.has(t.id)) return 0
      seen.add(t.id)
      const parents = t.blockedBy.map(id => byId.get(id)).filter((p): p is Ticket => !!p && !p.isOutOfScope)
      const d = parents.length ? 1 + Math.max(...parents.map(p => depthOf(p, seen))) : 0
      depth.set(t.id, d)
      return d
    }
    const parentOf = new Map<string, string>()
    for (const t of tickets) {
      const parents = t.blockedBy.map(id => byId.get(id)).filter((p): p is Ticket => !!p && !p.isOutOfScope)
      const deepest = parents.sort((a, b) => depthOf(b) - depthOf(a))[0]
      if (deepest && depthOf(deepest) < depthOf(t)) parentOf.set(t.id, deepest.id)
    }
    const childrenOf = (id: string | null) => tickets.filter(t => (parentOf.get(t.id) ?? null) === id)
    const rows: { t: Ticket; prefix: string }[] = []
    const walk = (id: string | null, lead: string) => {
      const kids = childrenOf(id)
      kids.forEach((t, i) => {
        const isLast = i === kids.length - 1
        rows.push({ t, prefix: `${lead}${isLast ? '└─ ' : '├─ '}` })
        walk(t.id, `${lead}${isLast ? '   ' : '│  '}`)
      })
    }
    walk(null, '')

    // ── The Spines: each ticket's in its card, Charting's in the map card ──
    const turn = (id: string) =>
      update($, way, g => ({ ...g, turned: g.turned.includes(id) ? g.turned.filter(k => k !== id) : [...g.turned, id] }))
    const spineBlock = (title: string, steps: Step[], keyPrefix: string, isClosed: boolean, isLive: boolean) => (
      <Box flexDirection="column" marginTop={1}>
        {spineHeading(el, title, steps, isClosed)}
        {spineRows(el, {
          steps,
          keyPrefix,
          isClosed,
          isLive,
          isAllUnfolded: w.isAllUnfolded,
          turned: w.turned,
          onTurn: turn,
          width: inner,
          now,
        })}
      </Box>
    )
    // Once the map has tickets, Charting is folded as a closed ticket's, unless a Level came since the last claim.
    const charting = linesOf(w.lines, null)
    const chartingLevel = charting.filter(l => l.kind === 'round').at(-1)?.at ?? 0
    const isChartingLive = !!run && !run.ticket && (!tickets.length || chartingLevel > (run.claimedAt ?? 0))

    const toggleFocus = async (id: string) => {
      await update($, way, g => ({ ...g, focus: g.focus === id ? null : id }))
      await quietly(() => fetchAnswer($, id))
    }
    const noteOf = (t: Ticket, s: State) => {
      if (s === 'claimed') return t.id === mine ? 'you' : 'claimed'
      if (s === 'blocked') {
        const open = t.blockedBy.filter(isOpen)
        return `after ${cut(name(open[0] ?? ''), 18)}${open.length > 1 ? ` +${open.length - 1}` : ''}`
      }
      if (s === 'frontier') return t === next ? 'next' : 'ready'
      return ''
    }

    const routeRow = ({ t, prefix }: { t: Ticket; prefix: string }, i: number) => {
      const s = stateOf(t)
      const note = noteOf(t, s)
      const isFocused = w.focus === t.id
      const digit = i < 9 ? String(i + 1) : undefined
      const extra = t.blockedBy.filter(id => id !== parentOf.get(t.id) && byId.has(id)).length
      return (
        <Box key={`row-${t.id}`} flexDirection="row" justifyContent="space-between">
          <Box flexShrink={1}>
            <Button key={`focus-${t.id}`} plain {...(digit ? { hotkey: digit } : {})} onPress={() => toggleFocus(t.id)}>
              <Text wrap="truncate-end" bold={isFocused} dimColor={s === 'resolved' || s === 'blocked'}>
                <Text color={EDGE}>{prefix}</Text>
                <Text color={STATE_COLOR[s]}>{isFocused ? '◉' : STATE_MARK[s]} </Text>
                {t.title}
                {extra > 0 ? <Text dimColor> ⋯{extra}</Text> : ''}
              </Text>
            </Button>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text>
              {typeChip(t)}
              {note === 'next' || note === 'you' ? (
                <Text> {pill(note, STATE_COLOR[s])}</Text>
              ) : note ? (
                <Text dimColor> · {note}</Text>
              ) : (
                ''
              )}
            </Text>
          </Box>
        </Box>
      )
    }

    const ticketCard = (t: Ticket) => {
      const s = stateOf(t)
      const blocks = tickets.filter(x => x.blockedBy.includes(t.id))
      const steps = linesOf(w.lines, t.id)
      return (
        <Box flexDirection="column">
          {heading(
            cut(t.title, inner - 18),
            <Text>
              {typeChip(t)}
              {t.type ? <Text dimColor> · {MODE[t.type]}</Text> : ''}
            </Text>,
          )}
          <Text wrap="truncate-end">
            <Text color={STATE_COLOR[s]}>{STATE_MARK[s]} {s}</Text>
            {t.blockedBy.length ? <Text dimColor> · after {t.blockedBy.map(name).join(', ')}</Text> : ''}
          </Text>
          {blocks.length > 0 && (
            <Text dimColor wrap="truncate-end">
              unblocks {blocks.map(b => b.title).join(', ')}
            </Text>
          )}
          {t.question && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Question</Text>
              <Text wrap="wrap">{cut(t.question, inner * 5)}</Text>
            </Box>
          )}
          {t.isClosed && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color={STATE_COLOR.resolved}>
                Answer
              </Text>
              <Text wrap="wrap">{t.answer ? cut(t.answer, inner * 6) : 'Reading the resolution…'}</Text>
            </Box>
          )}
          {steps.length > 0 && spineBlock('Spine', steps, `${t.id}-`, t.isClosed, !t.isClosed && t.id === mine)}
          <Box flexDirection="row" columnGap={1} marginTop={1} justifyContent="space-between">
            <Box flexShrink={1}>
              {/^https?:/.test(t.link) ? (
                <Link href={t.link} label={`#${t.id}`} />
              ) : (
                <Text dimColor wrap="truncate-start">
                  {t.link}
                </Text>
              )}
            </Box>
            <Button key="unfocus" label="Close" hotkey="x" onPress={() => toggleFocus(t.id)} />
          </Box>
        </Box>
      )
    }

    const focused = w.focus ? byId.get(w.focus) : undefined
    const tree = (
      <Box flexDirection="column">
        {heading('route', <Text dimColor>{next ? `next: ${cut(next.title, 24)}` : tickets.length ? 'no frontier' : ''}</Text>)}
        <Text wrap="truncate-end">
          <Text color={ACCENT}>◎ </Text>
          <Text bold>{map?.destination ? map.destination : 'destination'}</Text>
        </Text>
        {rows.length === 0 && <Text dimColor>No tickets yet.</Text>}
        {rows.map(routeRow)}
        {rows.length > 0 && !focused && <Text dimColor>1–{Math.min(9, rows.length)} opens a ticket</Text>}
        {(map?.fog.length ?? 0) > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={FOG} bold>
              ≈ not yet specified
            </Text>
            {map?.fog.map((f, i) => (
              <Text key={`fog-${i}`} color={FOG} italic wrap="truncate-end">
                {'  '}≈ {f}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )

    // Steps through the tickets row by row, without giving the graph the keyboard.
    const order = [...tickets].sort((a, b) => depthOf(a) - depthOf(b))
    const step = async (by: number) => {
      const at = order.findIndex(t => t.id === w.focus)
      const t = order[at < 0 ? 0 : Math.min(order.length - 1, Math.max(0, at + by))]
      if (!t) return
      await update($, way, g => ({ ...g, focus: t.id }))
      await quietly(() => fetchAnswer($, t.id))
    }
    const graphProps: GraphProps = {
      nodes: tickets.map(t => ({
        id: t.id,
        title: t.title,
        type: t.type,
        state: stateOf(t),
        layer: depthOf(t) + 1,
        isNext: t === next,
        isMine: t.id === mine,
      })),
      edges: tickets.flatMap(t =>
        t.blockedBy
          .filter(id => byId.has(id) && !byId.get(id)?.isOutOfScope)
          .map(id => [id, t.id] as [string, string]),
      ),
      start: map?.title ?? 'A foggy idea, with no route to it yet',
      destination: map?.destination || 'Not named yet',
      selected: w.focus,
      columns: inner,
    }
    const fog =
      (map?.fog.length ?? 0) > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={FOG} bold>
            ≈ not yet specified
          </Text>
          {map?.fog.map((f, i) => (
            <Text key={`fog-${i}`} color={FOG} italic wrap="truncate-end">
              {'  '}≈ {f}
            </Text>
          ))}
        </Box>
      ) : null
    const route = Client ? (
      <Box flexDirection="column">
        {heading('map', <Text dimColor>{next ? `next: ${cut(next.title, 24)}` : tickets.length ? 'no frontier' : ''}</Text>)}
        <Client key="graph" module="./graph.tsx" props={graphProps} width={inner} />
        {fog}
        {tickets.length > 0 && (
          <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
            <Text dimColor wrap="truncate-end">
              click the map, then ←↑↓→ · ⏎ card
            </Text>
            <Box flexDirection="row" columnGap={1} flexShrink={0}>
              <Button key="prev" label="‹ prev" hotkey="p" onPress={() => step(-1)} />
              <Button key="next" label="next ›" hotkey="n" onPress={() => step(1)} />
            </Box>
          </Box>
        )}
      </Box>
    ) : (
      tree
    )

    const decisions = (
      <Box flexDirection="column">
        {heading('decisions so far', <Text dimColor>{map?.decisions.length ?? 0}</Text>)}
        {!map?.decisions.length && <Text dimColor>None yet: each resolved ticket adds one.</Text>}
        {map?.decisions.map((d, i) => (
          <Box key={`dec-${i}`} flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={STATE_COLOR.resolved}>✓ </Text>
              <Text bold>{d.title}</Text>
            </Text>
            {d.gist && (
              <Text wrap="wrap" dimColor>
                {'  '}
                {d.gist}
              </Text>
            )}
          </Box>
        ))}
        {(map?.outOfScope.length ?? 0) > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {heading('out of scope', <Text dimColor>{map?.outOfScope.length}</Text>)}
            {map?.outOfScope.map((d, i) => (
              <Text key={`oos-${i}`} dimColor wrap="truncate-end">
                ⊘ <Text strikethrough>{d.title}</Text>
                {d.gist ? ` · ${d.gist}` : ''}
              </Text>
            ))}
          </Box>
        )}
        {map?.notes && (
          <Box flexDirection="column" marginTop={1}>
            {heading('notes')}
            <Text wrap="wrap" dimColor>
              {cut(map.notes, inner * 4)}
            </Text>
          </Box>
        )}
      </Box>
    )

    const tab = (key: Tab, label: string, hotkey: string, n?: number) => (
      <Button key={`tab-${key}`} plain hotkey={hotkey} onPress={() => update($, way, g => ({ ...g, tab: key }))}>
        {w.tab === key ? (
          pill(`${label}${n ? ` ${n}` : ''}`, ACCENT, INK, true)
        ) : (
          <Text dimColor>{` ${label}${n ? ` ${n}` : ''} `}</Text>
        )}
      </Button>
    )
    const resolved = count('resolved')

    return (
      <Box flexDirection="column">
        {header(el, PANE, e.props.bodyColumns)}
        {card(
          'map',
          <Box flexDirection="column">
            {heading(
              'wayfinder',
              <Text>
                <Text dimColor>
                  {w.target ? (w.target.source === 'github' ? `map #${w.target.ref}` : w.target.ref.split('/').pop()) : 'no map'}{' '}
                </Text>
                {tickets.length > 0 &&
                  pill(
                    `${resolved}/${tickets.length}`,
                    resolved === tickets.length ? STATE_COLOR.resolved : TRACK,
                    resolved === tickets.length ? INK : 'white',
                    true,
                  )}
              </Text>,
            )}
            {map ? (
              <Text bold wrap="truncate-end">
                {map.title}
              </Text>
            ) : (
              <Text dimColor wrap="wrap">
                {charting.length
                  ? 'Charting: the map is followed once it is created.'
                  : '/waymap finds the map here, or /waymap <issue | .scratch/effort>'}
              </Text>
            )}
            {map?.destination && (
              <Text wrap="wrap">
                <Text color={ACCENT}>◎ </Text>
                {cut(map.destination, inner * 2)}
              </Text>
            )}
            {charting.length > 0 &&
              spineBlock('Spine · charting', charting, 'charting-', tickets.length > 0 && !isChartingLive, !!run && !run.ticket)}
            {tickets.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {bar()}
                <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                  {LEGEND.filter(l => count(l.state) > 0).map(l => (
                    <Text key={`legend-${l.state}`}>
                      <Text color={STATE_COLOR[l.state]}>{STATE_MARK[l.state]} </Text>
                      {l.label} <Text bold>{count(l.state)}</Text>
                    </Text>
                  ))}
                  {(map?.fog.length ?? 0) > 0 && (
                    <Text>
                      <Text color={FOG}>≈ </Text>
                      fog <Text bold>{map?.fog.length}</Text>
                    </Text>
                  )}
                </Box>
              </Box>
            )}
            <Box flexDirection="row" columnGap={1} marginTop={1}>
              {tab('route', 'map', 'm')}
              {tab('decisions', 'decisions', 'd', map?.decisions.length)}
            </Box>
          </Box>,
        )}

        {card(w.tab, w.tab === 'route' ? route : decisions)}
        {w.tab === 'route' && focused && card('ticket', ticketCard(focused))}

        {w.error && <Text color="#e5737b"> {w.target?.source === 'github' ? 'gh' : 'read'}: {w.error}</Text>}
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            {(charting.length > 0 || (w.tab === 'route' && focused && linesOf(w.lines, focused.id).length > 0)) &&
              foldAllButton(el, w.isAllUnfolded, () => update($, way, g => ({ ...g, isAllUnfolded: !g.isAllUnfolded, turned: [] })))}
            <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refresh($)} />
            <Button
              key="clear"
              label="Clear"
              hotkey="c"
              onPress={async () => {
                await update($, way, () => EMPTY)
                await endRun($)
              }}
            />
          </Box>
          {w.refreshedAt !== null && <Text dimColor>↻ {since(w.refreshedAt, now)} ago</Text>}
        </Box>
      </Box>
    )
  })
}

