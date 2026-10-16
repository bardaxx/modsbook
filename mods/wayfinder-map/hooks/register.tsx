import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type {
  Entry,
  GraphMessage,
  GraphProps,
  MapView,
  Question,
  Round,
  Tab,
  Target,
  Ticket,
  TicketType,
  Wayfinder,
} from '../types'

const PANE = 'wayfinder-map'
const TITLE = 'Wayfinder'
const POLL_MS = 60_000
const ROUNDS_KEPT = 60

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
  working: null,
  rounds: [],
  tab: 'route',
  focus: null,
  error: null,
  refreshedAt: null,
}
const way = atom({ plugin: 'wayfinder-map', key: 'way' } as const, EMPTY)

// State kept from an older version lacks the fields added since.
const current = async ($: EngineInterface): Promise<Wayfinder> => ({ ...EMPTY, ...(await read($, way)) })

const firstLine = (text: string) => text.split('\n').find(line => line.trim())?.trim() ?? ''
const plain = (text: string) =>
  text
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
const since = (from: number, to = Date.now()) => {
  const s = Math.max(0, Math.round((to - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}
const cut = (text: string, room: number) => (text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text)

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

// ── Grilling rounds: the design tree the grilling skill works in rounds ──

/** `❓ **Q1** - **Title**: body … ➡ recommended`, once per question of the round. */
const parseRound = (text: string): Question[] =>
  text
    .split(/^[ \t>]*❓\s*/m)
    .slice(1)
    .flatMap(chunk => {
      const head = /^\**\s*Q?(\d+)\s*\**\s*[-–—:.]?\s*(?:\*\*([^*]+)\*\*\s*:?)?\s*([\s\S]*)$/i.exec(chunk)
      if (!head) return []
      const rest = (head[3] ?? '').split(/\n\s*---/)[0] ?? ''
      const arrow = rest.search(/➡/)
      const before = arrow < 0 ? rest : rest.slice(0, arrow)
      const recommended = arrow < 0 ? '' : plain(rest.slice(arrow).replace(/^➡\uFE0F?\s*/, '').split(/\n\s*\n/)[0] ?? '')
      const options = before
        .split('\n')
        .map(line => /^\s*(?:[-*]|\(?[a-zA-Z0-9]\)|[A-Za-z]\.)\s+(.+)$/.exec(line)?.[1])
        .filter((o): o is string => Boolean(o))
        .map(plain)
        .slice(0, 6)
      const title = plain(head[2] ?? firstLine(before))
      return title ? [{ n: head[1] ?? '', title, recommended, options }] : []
    })

const YES = /^(y|yes|yep|yeah|ok|okay|sure|agreed|go|s[iì]|certo|va bene|confermo|d'accordo|perfetto|esatto|👍)\b/i

/** Hands the person's reply out to the round's questions: `1. yes`, `Q2: no, …`, or one answer for all. */
const applyReply = (round: Round, reply: string): Round => {
  const known = new Set(round.questions.map(q => q.n))
  const parts = new Map<string, string>()
  let at: string | null = null
  for (const line of reply.split('\n')) {
    const m = /^\s*\**Q?(\d+)\**(?:\s*[).:\-–—]|\s+)\s*(.*)$/i.exec(line)
    if (m && known.has(m[1] ?? '')) {
      at = m[1] ?? null
      if (at) parts.set(at, (m[2] ?? '').trim())
    } else if (at && line.trim()) parts.set(at, `${parts.get(at) ?? ''} ${line.trim()}`.trim())
  }
  const whole = reply.trim()
  const forAll = parts.size === 0 && (round.questions.length === 1 || YES.test(whole)) ? whole : undefined
  return {
    ...round,
    reply: whole,
    questions: round.questions.map(q => {
      const said = parts.get(q.n) ?? forAll
      return said === undefined ? q : { ...q, answer: said, isAccepted: YES.test(said) }
    }),
  }
}

const storeKey = (t: Target) => `rounds:${t.source}:${t.ref}`

const saveRounds = async ($: EngineInterface) => {
  const { target, rounds } = await current($)
  if (target) await $.store.set(storeKey(target), rounds.slice(-ROUNDS_KEPT))
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
  const stored = ((await $.store.get(storeKey(target))) as Round[] | undefined) ?? []
  await update($, way, w => {
    const ids = new Set(w.rounds.map(r => r.id))
    const rounds = [...stored.filter(r => !ids.has(r.id)), ...w.rounds].sort((a, b) => a.at - b.at)
    return { ...w, target, map: null, focus: null, working: null, rounds, error: null }
  })
  await saveRounds($)
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

const addRound = async ($: EngineInterface, round: Omit<Round, 'ticket' | 'id'>) => {
  await update($, way, w => ({
    ...w,
    rounds: [...w.rounds, { ...round, id: `r${round.at}-${w.rounds.length}`, ticket: w.working }].slice(-ROUNDS_KEPT),
  }))
  await saveRounds($)
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
    const { target, rounds } = await current($)
    if (target || rounds.length) {
      void $.ui.open({ id: PANE, title: TITLE })
      void refresh($)
    }

    return next(e)
  })

  on('command.run', { command: 'waymap' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'clear') {
      await update($, way, () => EMPTY)
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

  // /wayfinder with a map works through it; with a loose idea it charts one, found once it is created.
  on('skill.prompt', async ($, e, next) => {
    const name = e.skill.replace(/^.*:/, '')
    if (name === 'wayfinder')
      await quietly(async () => {
        const args = /ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? ''
        const named = targetIn(args)
        if (named) await follow($, named)
        else void $.ui.open({ id: PANE, title: TITLE })
      })
    return next(e)
  })

  // The person's answer to the newest round still waiting for one.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && e.text.trim())
      await quietly(async () => {
        const { rounds } = await current($)
        const last = rounds.at(-1)
        if (!last || last.kind !== 'grilling' || last.reply !== undefined) return
        await update($, way, w => ({
          ...w,
          rounds: w.rounds.map(r => (r.id === last.id ? applyReply(r, e.text) : r)),
        }))
        await saveRounds($)
      })
    return next(e)
  })

  // A grilling round is the end of a main-loop turn: the questions, then a wait for the person.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.reason === 'answer')
      await quietly(async () => {
        const questions = parseRound(e.answer)
        if (questions.length) await addRound($, { at: Date.now(), kind: 'grilling', questions })
      })
    return done
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || ('deny' in ran && ran.deny)) return ran

    if (e.tool === 'AskUserQuestion' && !ran.isError)
      await quietly(async () => {
        const answers = ((ran.result as { answers?: Record<string, string> } | undefined)?.answers ?? {}) as Record<
          string,
          string
        >
        const questions: Question[] = e.questions.map((q, i) => {
          const answer = answers[q.question]
          return {
            n: String(i + 1),
            title: plain(q.question),
            recommended: '',
            options: q.options.map(o => o.label),
            ...(answer ? { answer } : {}),
          }
        })
        const response = (ran.result as { response?: string } | undefined)?.response
        await addRound($, { at: Date.now(), kind: 'dialog', questions, ...(response ? { reply: response } : {}) })
      })

    if (e.tool === 'Write' || e.tool === 'Edit')
      await quietly(async () => {
        const m = SCRATCH.exec(e.file_path)
        if (!m) return
        const text = e.tool === 'Write' ? e.content : e.new_string
        const id = m[2] ? String(Number(m[2])) : null
        await follow($, { source: 'local', ref: m[1] ?? '' })
        if (id && /^\s*\**status\**:?\**\s*claimed/im.test(text)) await update($, way, w => ({ ...w, working: id }))
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
        if (claimed && target?.source === 'github') await update($, way, w => ({ ...w, working: claimed }))
        const touches =
          target?.source === 'github'
            ? /\bgh (issue|api)\b/.test(cmd) && !/gh issue (view|list)\b/.test(cmd)
            : target?.source === 'local' && /\.scratch\//.test(cmd)
        if (touches) void refresh($)
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
    const w = await current($)
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

    const toggleFocus = async (id: string) => {
      await update($, way, g => ({ ...g, focus: g.focus === id ? null : id }))
      await quietly(() => fetchAnswer($, id))
    }
    const noteOf = (t: Ticket, s: State) => {
      if (s === 'claimed') return t.id === w.working ? 'you' : 'claimed'
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
      const rounds = w.rounds.filter(r => r.ticket === t.id)
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
          {rounds.length > 0 && (
            <Text dimColor>
              {rounds.length} grilling round{rounds.length > 1 ? 's' : ''}, g shows them
            </Text>
          )}
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
        isMine: t.id === w.working,
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

    // ── grill: each round's questions as branches, the recommendation and what the person chose ──
    const subject = (id: string | null) => (id === null ? (map?.destination ? 'destination' : 'charting') : name(id))
    const shownRounds = (() => {
      const mine = w.focus ? w.rounds.filter(r => r.ticket === w.focus) : w.rounds
      return mine.slice(-6)
    })()
    const questionRows = (r: Round) =>
      r.questions.map((q, qi) => {
        const isLast = qi === r.questions.length - 1
        const lead = isLast ? '   ' : '│  '
        const waiting = q.answer === undefined && r.reply === undefined
        const branches: RenderChildren[] = []
        const leaves: { key: string; text: RenderChildren }[] = []
        for (const [oi, o] of q.options.entries()) {
          const isChosen = q.answer !== undefined && q.answer.split(/,\s*/).includes(o)
          leaves.push({
            key: `o${oi}`,
            text: (
              <Text dimColor={!isChosen} bold={isChosen}>
                <Text color={isChosen ? STATE_COLOR.resolved : EDGE}>{isChosen ? '● ' : '○ '}</Text>
                {o}
              </Text>
            ),
          })
        }
        if (q.recommended)
          leaves.push({
            key: 'rec',
            text: (
              <Text bold={q.isAccepted === true} dimColor={q.answer !== undefined && !q.isAccepted}>
                <Text color={STATE_COLOR.frontier}>➡ </Text>
                {q.recommended}
                {q.isAccepted ? <Text color={STATE_COLOR.resolved}> ✓</Text> : ''}
              </Text>
            ),
          })
        if (q.answer !== undefined && !q.isAccepted && r.kind === 'grilling')
          leaves.push({
            key: 'ans',
            text: (
              <Text bold>
                <Text color={ACCENT}>✎ </Text>
                {q.answer}
              </Text>
            ),
          })
        if (q.answer !== undefined && r.kind === 'dialog' && !q.options.includes(q.answer))
          leaves.push({
            key: 'ans',
            text: (
              <Text bold>
                <Text color={ACCENT}>✎ </Text>
                {q.answer}
              </Text>
            ),
          })
        leaves.forEach((l, li) =>
          branches.push(
            <Text key={`${r.id}-${q.n}-${l.key}`} wrap="truncate-end">
              <Text color={EDGE}>
                {lead}
                {li === leaves.length - 1 ? '└─ ' : '├─ '}
              </Text>
              {l.text}
            </Text>,
          ),
        )
        return (
          <Box key={`${r.id}-${q.n}`} flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={EDGE}>{isLast ? '└─ ' : '├─ '}</Text>
              <Text color={waiting ? STATE_COLOR.frontier : q.answer !== undefined ? STATE_COLOR.resolved : FOG}>
                {waiting ? '❓' : q.answer !== undefined ? '✓' : '·'}{' '}
              </Text>
              <Text bold>Q{q.n}</Text> {q.title}
            </Text>
            {branches}
          </Box>
        )
      })
    const grill = (
      <Box flexDirection="column">
        {heading(
          'design tree',
          <Text dimColor>{w.focus ? cut(subject(w.focus), 28) : `${w.rounds.length} rounds`}</Text>,
        )}
        {shownRounds.length === 0 && (
          <Text dimColor>No grilling yet: each round of questions shows here, with the answers.</Text>
        )}
        {shownRounds.map((r, ri) => (
          <Box key={r.id} flexDirection="column" marginTop={ri ? 1 : 0}>
            <Text wrap="truncate-end">
              <Text color={TYPE_COLOR.grilling}>◇ </Text>
              <Text bold>{subject(r.ticket)}</Text>
              <Text dimColor>
                {' '}
                · {r.kind === 'dialog' ? 'dialog' : 'round'} · {r.questions.length}q · {since(r.at, now)} ago
              </Text>
            </Text>
            {questionRows(r)}
            {r.reply !== undefined && r.questions.every(q => q.answer === undefined) && (
              <Text dimColor italic wrap="truncate-end">
                {'   '}⏎ {r.reply}
              </Text>
            )}
          </Box>
        ))}
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
                {w.rounds.length
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
              {tab('grill', 'grill', 'g', w.rounds.length)}
            </Box>
          </Box>,
        )}

        {card(w.tab, w.tab === 'route' ? route : w.tab === 'decisions' ? decisions : grill)}
        {w.tab === 'route' && focused && card('ticket', ticketCard(focused))}

        {w.error && <Text color="#e5737b"> {w.target?.source === 'github' ? 'gh' : 'read'}: {w.error}</Text>}
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refresh($)} />
            <Button key="clear" label="Clear" hotkey="c" onPress={() => update($, way, () => EMPTY)} />
          </Box>
          {w.refreshedAt !== null && <Text dimColor>↻ {since(w.refreshedAt, now)} ago</Text>}
        </Box>
      </Box>
    )
  })
}

