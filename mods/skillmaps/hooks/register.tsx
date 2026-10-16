import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook, Register, RenderChildren } from 'claude-code'

import type {
  AgentRow,
  AgentStep,
  Entry,
  Flow,
  GraphMessage,
  GraphProps,
  Grill,
  GrillBook,
  GrillSkill,
  IntegrationPr,
  Line,
  MapView,
  Question,
  Role,
  RoundStep,
  Run,
  SpecTicket,
  Stage,
  Step,
  Tab,
  Target,
  Ticket,
  TicketType,
  Wayfinder,
  WayfinderRun,
} from '../types'
import { applyReply, dialogRound, firstLine, isWaiting, isWrapDue, lastTurn, markOf, parseRound, plain, settleWrap } from './reply'
import type { Mark } from './reply'
import { FRAME_MS, header, isDrifting, setLegend } from './header'
import type { HeaderState } from './header'
import {
  ACCENT,
  BLUE,
  EDGE,
  FOG,
  GREEN,
  MARK,
  MARK_COLOR,
  TEAL,
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

// skillmaps: one plugin, three panes along the road of the AI Hero skills. grill-map draws a grilling's design tree,
// wayfinder-map a /wayfinder map, spec-map a spec from its tickets to the merge. Each part's hooks are registered
// only when its setting is on. The engine follows `$` only into functions declared at the top of this file, so
// every part lives here, its names prefixed where two parts would clash; what draws without `$` sits beside it.

type Part = 'grill' | 'wayfinder' | 'spec'
const PARTS: Part[] = ['grill', 'wayfinder', 'spec']
const PANE_OF: Record<Part, string> = { grill: 'grill-map', wayfinder: 'wayfinder-map', spec: 'spec-map' }
const PART_OF: Record<string, Part> = { 'grill-map': 'grill', 'wayfinder-map': 'wayfinder', 'spec-map': 'spec' }

/** The parts the settings turned on, as `register` read them. */
let enabledParts: Part[] = PARTS
/** The part whose pane opened last: a bare `/skillmaps` opens it again. */
let lastPart: Part | null = null

/** Whether a part's setting is on. */
const is = (part: Part) => enabledParts.includes(part)

/** Opens a part's pane, titled with its name. */
const openPane = ($: EngineInterface, part: Part) => {
  lastPart = part
  return $.ui.open({ id: PANE_OF[part], title: PANE_OF[part] })
}

/** What a press on the header's legend runs: that part's pane opens. */
const pickPane = ($: EngineInterface) => (name: string) => {
  const part = PART_OF[name]
  if (part && enabledParts.includes(part)) void openPane($, part)
}

/** The `slots` setting: it wins over a cap read from the skill; 0 leaves it to the skill. */
let specConfiguredCap: number | null = null
let specCalls = 0

/** The plugin has one status line: a wayfinder Run's, else a grill's of its own. */
const showStatus = ($: EngineInterface) => $.ui.status(wayShownStatus ?? grillShownStatus)

// ======== grill-map
const GRILL_PANE = 'grill-map'
const GRILL_TITLE = 'grill-map'
const GRILLS_KEPT = 8
const GRILL_STEPS_KEPT = 200

// The modsbook palette: muted pills on a dark track, dark ink on the pills.
const GRILL_INK = '#151515'
const GRILL_TRACK = '#2b2b2b'

const MARKS: Mark[] = ['took', 'own', 'replied', 'open']
const MARK_LABEL: Record<Mark, string> = { took: 'took', own: 'yours', replied: 'in reply', open: 'open' }

const SKILLS = new Set<string>(['grilling', 'grill-me', 'grill-with-docs'])

const GRILL_EMPTY: GrillBook = { grills: [], shown: null, expanded: [], isAllExpanded: false, lastPrompt: '' }
const book = atom({ plugin: 'skillmaps', key: 'book' } as const, GRILL_EMPTY)

// State kept from an older version lacks the fields added since.
const grillCurrent = async ($: EngineInterface): Promise<GrillBook> => ({ ...GRILL_EMPTY, ...(await read($, book)) })

let grillMade = 0
const grillNewId = (prefix: string) => `${prefix}${Date.now().toString(36)}-${grillMade++}`

// ── Inside /wayfinder: wayfinder-map owns the Run, grill-map reads it ──

const RUN = { plugin: 'skillmaps', key: 'run' } as const

/** The Run wayfinder-map is on, or null: none, or no wayfinder-map. */
const grillRunOf = async ($: EngineInterface): Promise<WayfinderRun | null> => (await $.state.get(RUN)).value ?? null

/** Which grill a step belongs to: the Run's claimed ticket, `charting`, or none outside a Run. */
const keyOf = (run: WayfinderRun | null) => (run ? (run.ticket?.id ?? 'charting') : undefined)

// ── The book of grills: the newest one still open is the one being worked ──

const open = ($: EngineInterface) => void openPane($, 'grill')

/** The newest grill, while it is open and belongs where the step goes (the Run's ticket, or no Run). */
const liveFor = (b: GrillBook, key: string | undefined) => {
  const g = b.grills.at(-1)
  return g && !g.isDone && g.run === key ? g : null
}

const withLive = ($: EngineInterface, key: string | undefined, fn: (g: Grill) => Grill) =>
  update($, book, b => {
    const g = liveFor(b, key)
    return g ? { ...b, grills: [...b.grills.slice(0, -1), fn(g)] } : b
  })

const push = (g: Grill, step: Step): Grill => ({ ...g, steps: [...g.steps, step].slice(-GRILL_STEPS_KEPT) })
const mapStep = (g: Grill, id: string, fn: (s: Step) => Step): Grill => ({
  ...g,
  steps: g.steps.map(s => (s.id === id ? fn(s) : s)),
})

const start = async ($: EngineInterface, skill: GrillSkill, subject: string, run?: string) => {
  const grill: Grill = {
    id: grillNewId('g'),
    skill,
    subject: cut(subject, 200),
    startedAt: Date.now(),
    steps: [],
    isDone: false,
    ...(run ? { run } : {}),
  }
  await update($, book, b => ({ ...b, grills: [...b.grills, grill].slice(-GRILLS_KEPT), shown: null, expanded: [] }))
  open($)
}

/**
 * Where a step lands: the live grill, or one opened for it. Outside a Run only a round opens one;
 * inside, a round or a dialog opens the ticket's grill (or the charting one), and any step does once
 * a ticket is claimed. The start of a Run leaves the grill before it behind.
 */
const landing = async ($: EngineInterface, step: 'round' | 'dialog' | 'trace') => {
  const run = await grillRunOf($)
  const key = keyOf(run)
  const b = await grillCurrent($)
  if (liveFor(b, key)) return { key }
  if (run && (step !== 'trace' || run.ticket)) {
    await start($, 'grilling', run.ticket?.title ?? 'charting', key)
    return { key }
  }
  if (!run && step === 'round') {
    await start($, 'grilling', b.lastPrompt)
    return { key }
  }
  return null
}

// A new level takes the focus: every level drawn whole by hand folds again.
const addRound = ($: EngineInterface, key: string | undefined, round: RoundStep) =>
  update($, book, b => {
    const g = liveFor(b, key)
    return g ? { ...b, grills: [...b.grills.slice(0, -1), push(g, round)], expanded: [] } : b
  })

let grillShownStatus: string | undefined

/** The header's word for the grill shown: grilling while the model works, your turn while a round waits. */
const grillHeaderState = (g: Grill | undefined): HeaderState => {
  if (!g) return { state: 'idle', isLive: false }
  if (g.isDone) return { state: 'done', isLive: false }
  const last = g.steps.filter((s): s is RoundStep => s.kind === 'round').at(-1)
  const step = lastTurn(g.steps)
  if ((step?.kind === 'wrap' && step.reply === undefined) || (last && isWaiting(last))) return { state: 'your turn', isLive: false }
  return { state: 'grilling', isLive: true }
}

/** The status line while a grill of its own is open; inside a Run, wayfinder-map's carries it. */
const grillSyncStatus = async ($: EngineInterface) => {
  const run = await grillRunOf($)
  const g = run ? null : liveFor(await grillCurrent($), undefined)
  let text: string | undefined
  if (g) {
    const rounds = g.steps.filter((s): s is RoundStep => s.kind === 'round')
    const last = rounds.at(-1)
    const step = lastTurn(g.steps)
    const left = last ? last.questions.filter(q => markOf(q, last) === 'open').length : 0
    text =
      step?.kind === 'wrap' && step.reply === undefined
        ? 'grill · confirm the shared understanding'
        : last && isWaiting(last)
          ? `grill L${rounds.length} · ${left} open`
          : last
            ? `grill L${rounds.length} · next frontier`
            : 'grill · starting'
  }
  if (text === grillShownStatus) return
  grillShownStatus = text
  showStatus($)
}

// Bookkeeping never fails the call it watches.
const grillQuietly = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch {
    // the pane misses one update; the session goes on
  }
}

/** grill-map: its hooks, registered when its setting is on. */
const registerGrill = (on: Parameters<Register>[0], options: Parameters<Register>[1]) => {

  on('command.run', { command: 'skillmaps' }, async ($, said, next) => {
    const [word = '', ...rest] = said.args.trim().split(/\s+/)
    if (word !== 'grill') return next(said)
    const e = { ...said, args: rest.join(' ') }
    if (e.args.trim() === 'clear') {
      await update($, book, b => ({ ...GRILL_EMPTY, lastPrompt: b.lastPrompt }))
      await grillQuietly(() => grillSyncStatus($))
      return { text: 'Grill map cleared.' }
    }
    await openPane($, 'grill')
    const { grills } = await grillCurrent($)
    return { text: grills.length ? 'Grill map opened.' : 'Grill map opened: it fills once /grill-me, /grill-with-docs or /grilling runs.' }
  })





  on('ui.render', { component: 'Pane', requestId: GRILL_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const el = { Box, Text, Button }
    const b = await grillCurrent($)
    const now = Date.now()
    const inner = Math.max(24, e.props.bodyColumns - 4)
    const g = b.grills.find(x => x.id === b.shown) ?? b.grills.at(-1)
    const state = grillHeaderState(g)

    const pill = (text: string, bg: string, fg = GRILL_INK, bold = false) => (
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

    if (!g)
      return (
        <Box flexDirection="column">
          {header(el, GRILL_PANE, e.props.bodyColumns, state, pickPane($))}
          {card(
            'empty',
            <Box flexDirection="column">
              {heading('grill map')}
              <Text dimColor wrap="wrap">
                /grill-me, /grill-with-docs or /grilling draws its design tree here, one level per round.
              </Text>
            </Box>,
          )}
        </Box>
      )

    const rounds = g.steps.filter((s): s is RoundStep => s.kind === 'round')
    const all = rounds.flatMap(r => r.questions.map(q => markOf(q, r)))
    const count = (m: Mark) => all.filter(x => x === m).length
    const settled = all.length - count('open')
    const terms = g.steps.reduce((n, s) => n + (s.kind === 'term' ? s.terms.length : 0), 0)
    const adrs = g.steps.filter(s => s.kind === 'adr').length
    const lookups = g.steps.reduce((n, s) => n + (s.kind === 'lookup' ? s.count : 0), 0)
    const at = b.grills.indexOf(g)

    const bar = () => {
      let left = inner
      const cells = MARKS.map((m, i) => {
        const width = i === MARKS.length - 1 ? left : Math.round((count(m) / all.length) * inner)
        left -= width
        return { m, width: Math.max(0, width) }
      })
      return (
        <Box flexDirection="row">
          {cells
            .filter(c => c.width > 0)
            .map(c => (
              <Text key={`bar-${c.m}`} backgroundColor={MARK_COLOR[c.m]}>
                {' '.repeat(c.width)}
              </Text>
            ))}
        </Box>
      )
    }

    const head = card(
      'head',
      <Box flexDirection="column">
        {heading(
          g.skill,
          <Text>
            {b.grills.length > 1 && <Text dimColor>{`${at + 1}/${b.grills.length} `}</Text>}
            {g.isDone
              ? pill('done', GREEN, GRILL_INK, true)
              : all.length > 0
                ? pill(`${settled}/${all.length}`, settled === all.length ? GREEN : GRILL_TRACK, settled === all.length ? GRILL_INK : 'white', true)
                : ''}
          </Text>,
        )}
        {g.subject ? (
          <Text bold wrap="truncate-end">
            {g.subject}
          </Text>
        ) : (
          <Text dimColor>Waiting for what to grill.</Text>
        )}
        {all.length > 0 && <Box marginTop={1}>{bar()}</Box>}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {MARKS.filter(m => count(m) > 0).map(m => (
            <Text key={`legend-${m}`}>
              <Text color={MARK_COLOR[m]}>{MARK[m]} </Text>
              {MARK_LABEL[m]} <Text bold>{count(m)}</Text>
            </Text>
          ))}
          {lookups > 0 && (
            <Text key="legend-lookups">
              <Text color={FOG}>⌕ </Text>
              lookups <Text bold>{lookups}</Text>
            </Text>
          )}
          {terms > 0 && (
            <Text key="legend-terms">
              <Text color={TEAL}>≡ </Text>
              terms <Text bold>{terms}</Text>
            </Text>
          )}
          {adrs > 0 && (
            <Text key="legend-adrs">
              <Text color={BLUE}>⚑ </Text>
              ADRs <Text bold>{adrs}</Text>
            </Text>
          )}
        </Box>
      </Box>,
    )

    // ── The Spine: the design tree top to bottom, one level per round ──
    const toggle = (id: string) =>
      update($, book, x => ({
        ...x,
        expanded: x.expanded.includes(id) ? x.expanded.filter(k => k !== id) : [...x.expanded, id],
      }))
    const tree = card(
      'tree',
      <Box flexDirection="column">
        {spineHeading(el, 'Spine', g.steps, g.isDone)}
        {spineRows(el, {
          steps: g.steps,
          keyPrefix: '',
          isClosed: g.isDone,
          isLive: !g.isDone && g === b.grills.at(-1),
          isAllUnfolded: b.isAllExpanded,
          turned: b.expanded,
          onTurn: toggle,
          width: inner,
          now,
          startedAt: g.startedAt,
        })}
      </Box>,
    )

    const pick = (by: number) =>
      update($, book, x => {
        const i = x.grills.findIndex(k => k.id === (x.shown ?? x.grills.at(-1)?.id))
        const to = x.grills[Math.min(x.grills.length - 1, Math.max(0, i + by))]
        return { ...x, shown: to && to !== x.grills.at(-1) ? to.id : null, expanded: [] }
      })

    return (
      <Box flexDirection="column">
        {header(el, GRILL_PANE, e.props.bodyColumns, state, pickPane($))}
        {head}
        {tree}
        <Box flexDirection="row" columnGap={1} paddingX={1}>
          {foldAllButton(el, b.isAllExpanded, () =>
            update($, book, x => ({ ...x, isAllExpanded: !x.isAllExpanded, expanded: [] })),
          )}
          {b.grills.length > 1 && <Button key="prev" label="Prev" hotkey="p" onPress={() => pick(-1)} />}
          {b.grills.length > 1 && <Button key="next" label="Next" hotkey="n" onPress={() => pick(1)} />}
          <Button key="clear" label="Clear" hotkey="c" onPress={async () => {
              await update($, book, x => ({ ...GRILL_EMPTY, lastPrompt: x.lastPrompt }))
              await grillSyncStatus($)
            }} />
        </Box>
      </Box>
    )
  })
}

const grillSessionStart: Hook<'session.start'> = async ($, e, next) => {
  if ((await grillCurrent($)).grills.length) open($)
  grillShownStatus = undefined
  await grillQuietly(() => grillSyncStatus($))
  return next(e)
}

// The person's reply: the answers to the waiting round, the verdict on a wrap-up, or the subject itself.
const grillPromptSubmit: Hook<'prompt.submit'> = async ($, e, next) => {
  if (!e.command && !e.isMeta && e.text.trim())
    await grillQuietly(async () => {
      const key = keyOf(await grillRunOf($))
      await update($, book, b => {
        const text = e.text.trim()
        const out = { ...b, lastPrompt: cut(firstLine(text), 200) }
        const g = liveFor(b, key)
        if (!g) return out
        const last = lastTurn(g.steps)
        let now = g
        if (last?.kind === 'round' && last.reply === undefined) now = mapStep(g, last.id, () => applyReply(last, text))
        else if (last?.kind === 'wrap' && last.reply === undefined) {
          const wrap = settleWrap(last, text)
          now = { ...mapStep(g, last.id, () => wrap), isDone: wrap.isConfirmed === true }
        } else if (!last && !g.subject) now = { ...g, subject: cut(firstLine(text), 200) }
        return { ...out, grills: [...b.grills.slice(0, -1), now] }
      })
    })
  await grillQuietly(() => grillSyncStatus($))
  return next(e)
}

// The wrappers start a grill of their own; /grilling joins the one they started, or the Run's, or starts its own.
const grillSkillPrompt: Hook<'skill.prompt'> = async ($, e, next) => {
  const name = e.skill.replace(/^.*:/, '')
  // Another skill's argument (`/wayfinder <idea>`) is the subject of a grill it runs.
  const given = plain(/ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? '')
  if (!SKILLS.has(name) && given) await grillQuietly(() => update($, book, b => ({ ...b, lastPrompt: cut(given, 200) })))
  if (SKILLS.has(name))
    await grillQuietly(async () => {
      if (name !== 'grilling') return start($, name as GrillSkill, given)
      if (await grillRunOf($)) {
        await landing($, 'round')
        return open($)
      }
      const b = await grillCurrent($)
      if (liveFor(b, undefined)) {
        if (given) await withLive($, undefined, g => (g.subject ? g : { ...g, subject: cut(given, 200) }))
        return open($)
      }
      await start($, 'grilling', given || b.lastPrompt)
    })
  // Beneath, wayfinder-map starts or ends its Run: the status line follows it.
  const done = await next(e)
  await grillQuietly(() => grillSyncStatus($))
  return done
}

const grillToolCall: Hook<'tool.call'> = async ($, e, next) => {
  if (e.agentId) return next(e)
  const input = e as unknown as Record<string, unknown>
  const path = e.tool === 'Write' || e.tool === 'Edit' ? e.file_path : ''
  const isDoc = isDocPath(path)
  const looked = lookupOf(e.tool, input)
  const isDialog = e.tool === 'AskUserQuestion'
  if (e.tool !== 'Agent' && !isDoc && looked === null && !isDialog) return next(e)
  const at = await landing($, isDialog ? 'dialog' : 'trace')
  if (!at) return next(e)
  const { key } = at

  // A fact the agent sends a sub-agent for: running until the sub-agent reports.
  if (e.tool === 'Agent') {
    const id = grillNewId('l')
    await grillQuietly(() =>
      withLive($, key, x =>
        push(x, { kind: 'lookup', id, at: Date.now(), label: plain(e.description), isAgent: true, count: 1, isDone: false }),
      ),
    )
    const ran = await next(e)
    await grillQuietly(() => withLive($, key, x => mapStep(x, id, s => ({ ...s, isDone: true }))))
    return ran
  }

  const before = e.tool === 'Write' && isDoc ? await $.fs.read(path).catch(() => null) : null

  const ran = await next(e)
  if (('deny' in ran && ran.deny) || ran.isError) return ran

  if (e.tool === 'AskUserQuestion')
    await grillQuietly(async () => {
      await addRound($, key, dialogRound(e.questions, ran.result, grillNewId('r'), Date.now()))
      await grillSyncStatus($)
    })

  // Reads and searches between rounds fold into one lookup.
  if (looked !== null)
    await grillQuietly(() =>
      withLive($, key, x => {
        const last = x.steps.at(-1)
        const label = cut(looked, 60)
        return foldsInto(last)
          ? mapStep(x, last.id, s => (s.kind === 'lookup' ? { ...s, count: s.count + 1, label } : s))
          : push(x, { kind: 'lookup', id: grillNewId('l'), at: Date.now(), label, isAgent: false, count: 1, isDone: true })
      }),
    )

  // grill-with-docs: the glossary's resolved terms and the ADRs, as they are written.
  if (isDoc && (e.tool === 'Write' || e.tool === 'Edit'))
    await grillQuietly(async () => {
      const trace =
        e.tool === 'Write'
          ? docTraceOf(path, e.content, before, false, grillNewId('d'), Date.now())
          : docTraceOf(path, e.new_string, e.old_string, true, grillNewId('d'), Date.now())
      if (!trace) return
      await withLive($, key, x => {
        const last = x.steps.at(-1)
        return trace.kind === 'term' && termsFoldInto(last, path)
          ? mapStep(x, last.id, s => (s.kind === 'term' ? { ...s, terms: [...new Set([...s.terms, ...trace.terms])] } : s))
          : push(x, trace)
      })
    })

  return ran
}

// A round is a main-loop turn that ends on questions; one that ends without them, once answered, is the wrap-up.
const grillTurnComplete: Hook<'turn.complete'> = async ($, e, next) => {
  const done = await next(e)
  if (!e.agentId && e.reason === 'answer')
    await grillQuietly(async () => {
      const questions = parseRound(e.answer)
      if (questions.length) {
        const at = await landing($, 'round')
        if (!at) return
        await addRound($, at.key, { kind: 'round', id: grillNewId('r'), at: Date.now(), via: 'grilling', questions })
        return open($)
      }
      const key = keyOf(await grillRunOf($))
      const g = liveFor(await grillCurrent($), key)
      if (g && isWrapDue(g.steps))
        await withLive($, key, x => push(x, { kind: 'wrap', id: grillNewId('w'), at: Date.now(), text: cut(plain(e.answer), 600) }))
    })
  await grillQuietly(() => grillSyncStatus($))
  return done
}

// ======== wayfinder-map
const WAY_PANE = 'wayfinder-map'
const WAY_TITLE = 'wayfinder-map'
const WAY_POLL_MS = 60_000
// About 800 KB at worst, of the store's 4 MiB in all.
const LINES_KEPT = 400

// The modsbook palette: muted pills on a dark track, dark ink on the pills.
const WAY_INK = '#151515'
const WAY_TRACK = '#2b2b2b'
const WAY_EDGE = '#4a4a4a'
const WAY_ACCENT = '#d97757'
const WAY_FOG = '#8a93a6'
type State = 'resolved' | 'claimed' | 'frontier' | 'blocked'
const WAY_STATE_COLOR: Record<State, string> = {
  resolved: '#5ccf9f',
  claimed: WAY_ACCENT,
  frontier: '#e2b867',
  blocked: '#5a5a5a',
}
const STATE_MARK: Record<State, string> = { resolved: '✓', claimed: '●', frontier: '◇', blocked: '○' }
const WAY_LEGEND: { state: State; label: string }[] = [
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

const WAY_EMPTY: Wayfinder = {
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
const way = atom({ plugin: 'skillmaps', key: 'way' } as const, WAY_EMPTY)
const running = atom({ plugin: 'skillmaps', key: 'run' } as const, null)

// State kept from an older version lacks the fields added since; its `grill` tab is gone.
const wayCurrent = async ($: EngineInterface): Promise<Wayfinder> => {
  const w = { ...WAY_EMPTY, ...(await read($, way)) }
  return w.tab === 'route' || w.tab === 'decisions' ? w : { ...w, tab: 'route' }
}
const wayRunOf = async ($: EngineInterface): Promise<Run | null> => (await read($, running)) ?? null

let wayMade = 0
const wayNewId = (prefix: string) => `${prefix}${Date.now().toString(36)}-${wayMade++}`

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

const wayGh = async ($: EngineInterface, args: string[]) => {
  const run = await $.process.run(['gh', ...args], { timeoutMs: 20_000 })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n')[0] || `gh ${args[0]} failed`)
  return run.stdout
}

type WayGhIssue = {
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

const fromGh = async ($: EngineInterface, issue: WayGhIssue): Promise<Ticket> => {
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
          await wayGh($, ['api', `repos/{owner}/{repo}/issues/${issue.number}/dependencies/blocked_by`]),
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
  const head = JSON.parse(await wayGh($, ['issue', 'view', ref, '--json', 'number,title,body,url'])) as {
    title: string
    body: string
    url: string
  }
  let subs: WayGhIssue[] = []
  try {
    subs = JSON.parse(await wayGh($, ['api', `repos/{owner}/{repo}/issues/${ref}/sub_issues?per_page=100`])) as WayGhIssue[]
  } catch {
    // no sub-issues on this repository: the map's task list names the children
  }
  if (!subs.length) {
    const refs = [...head.body.matchAll(/^\s*[-*]\s*\[[ xX]\]\s*.*?#(\d+)/gm)].map(m => m[1] ?? '')
    subs = await Promise.all(
      refs.map(
        async n =>
          JSON.parse(
            await wayGh($, ['issue', 'view', n, '--json', 'number,title,state,stateReason,body,labels,assignees,url']),
          ) as WayGhIssue,
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

/** The header's word: charting or on a claimed ticket while a Run goes, your turn while its round waits. */
const wayHeaderState = (run: Run | null, lines: Line[], hasMap: boolean): HeaderState => {
  if (!run) return { state: hasMap ? 'mapped' : 'idle', isLive: false }
  const steps = linesOf(lines, run.ticket?.id ?? null)
  const last = steps.filter((s): s is RoundStep => s.kind === 'round').at(-1)
  const step = lastTurn(steps)
  if ((step?.kind === 'wrap' && step.reply === undefined) || (last && isWaiting(last))) return { state: 'your turn', isLive: false }
  return { state: run.ticket ? 'claimed' : 'charting', isLive: true }
}

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
  const { target, lines } = await wayCurrent($)
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

let wayShownStatus: string | undefined

/** Inside a Run, the line the claimed ticket's Spine (or Charting's) stands at; none outside. */
const waySyncStatus = async ($: EngineInterface) => {
  const run = await wayRunOf($)
  let text: string | undefined
  if (run) {
    const steps = linesOf((await wayCurrent($)).lines, run.ticket?.id ?? null)
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
  if (text === wayShownStatus) return
  wayShownStatus = text
  showStatus($)
}

const endRun = async ($: EngineInterface) => {
  await update($, running, () => null)
  await waySyncStatus($)
}

/** A claim seen in the Run: its lines go to that ticket until it closes. */
const claim = async ($: EngineInterface, id: string) => {
  if (!(await wayRunOf($))) return
  const { map } = await wayCurrent($)
  const title = map?.tickets.find(t => t.id === id)?.title ?? `#${id}`
  await update($, running, r => (r ? { ticket: { id, title }, claimedAt: Date.now() } : r))
  await waySyncStatus($)
}

// ── Following a map ──

let refreshing: Promise<void> | null = null
let isPending = false

const wayRefresh = async ($: EngineInterface): Promise<void> => {
  if (refreshing) {
    isPending = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      isPending = false
      const { target } = await wayCurrent($)
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
        const run = await wayRunOf($)
        if (run?.ticket && map.tickets.find(t => t.id === run.ticket?.id)?.isClosed) {
          await update($, running, r => (r ? { ...r, ticket: null } : r))
          await waySyncStatus($)
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
  const was = (await wayCurrent($)).target
  if (was?.source === target.source && was.ref === target.ref) return wayRefresh($)
  const stored = await storedLines($, target)
  await update($, way, w => {
    // Charting held before the map existed joins it; another map's lines stay with that map.
    const carried = w.target ? [] : w.lines
    const ids = new Set(carried.map(l => l.id))
    const lines = [...stored.filter(l => !ids.has(l.id)), ...carried].sort((a, b) => a.at - b.at)
    return { ...w, target, map: null, focus: null, lines, turned: [], error: null }
  })
  await saveLines($)
  void openPane($, 'wayfinder')
  return wayRefresh($)
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
      await wayGh($, ['issue', 'list', '--label', 'wayfinder:map', '--state', 'open', '--limit', '1', '--json', 'number']),
    ) as { number: number }[]
    return open[0] ? { source: 'github', ref: String(open[0].number) } : null
  } catch {
    return null
  }
}

const SCRATCH = /^(.*\.scratch\/[^/]+)\/(?:map\.md|issues\/(\d+)[^/]*\.md)$/

// Bookkeeping never fails the call it watches.
const wayQuietly = async (work: () => Promise<unknown>) => {
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
  const run = await wayRunOf($)
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
  await waySyncStatus($)
  void openPane($, 'wayfinder')
}

const fetchAnswer = async ($: EngineInterface, id: string) => {
  const { target, map } = await wayCurrent($)
  const t = map?.tickets.find(x => x.id === id)
  if (target?.source !== 'github' || !t?.isClosed || t.answer) return
  const view = JSON.parse(await wayGh($, ['issue', 'view', id, '--json', 'comments'])) as { comments: { body: string }[] }
  const answer = plain(view.comments.at(-1)?.body ?? '') || 'Closed with no comment.'
  await update($, way, w =>
    w.map ? { ...w, map: { ...w.map, tickets: w.map.tickets.map(x => (x.id === id ? { ...x, answer } : x)) } } : w,
  )
}

/** wayfinder-map: its hooks, registered when its setting is on. */
const registerWay = (on: Parameters<Register>[0], options: Parameters<Register>[1]) => {

  // `/clear` ends the conversation, and the Run with it; compact, resume and fork keep it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await wayQuietly(() => endRun($))
    return next(e)
  })

  on('command.run', { command: 'skillmaps' }, async ($, said, next) => {
    const [word = '', ...rest] = said.args.trim().split(/\s+/)
    if (word !== 'wayfinder') return next(said)
    const e = { ...said, args: rest.join(' ') }
    const arg = e.args.trim()
    if (arg === 'clear') {
      await update($, way, () => WAY_EMPTY)
      await endRun($)
      return { text: 'Wayfinder pane cleared.' }
    }
    await openPane($, 'wayfinder')
    if (arg === 'refresh' || arg === '') {
      const { target } = await wayCurrent($)
      if (target) {
        await wayRefresh($)
        return { text: 'Wayfinder pane opened.' }
      }
      const found = await discover($)
      if (!found) return { text: 'No wayfinder map found here. /skillmaps wayfinder <issue> or /skillmaps wayfinder .scratch/<effort> names one.' }
      await follow($, found)
      return { text: `Following the map at ${found.source === 'github' ? `#${found.ref}` : found.ref}.` }
    }
    const named = targetIn(arg)
    if (!named) return { text: 'Usage: /skillmaps wayfinder [<issue number or URL> | .scratch/<effort> | refresh | clear]' }
    await follow($, named)
    return { text: `Following the map at ${named.source === 'github' ? `#${named.ref}` : named.ref}.` }
  })





  // The graph moved its selection: the ticket's card follows it.
  on('ui.message', { element: 'graph' }, async ($, e) => {
    const data = e.data as Partial<GraphMessage> | null
    if (data && typeof data === 'object' && 'focus' in data) {
      const focus = typeof data.focus === 'string' ? data.focus : null
      await update($, way, w => ({ ...w, focus }))
      if (focus) await wayQuietly(() => fetchAnswer($, focus))
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: WAY_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    // The graph needs a surface module's region: the terminal and the desktop draw one.
    const Client =
      (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in elements ? elements.Client : undefined
    const el = { Box, Text, Button }
    const w = await wayCurrent($)
    const run = await wayRunOf($)
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

    const pill = (text: string, bg: string, fg = WAY_INK, bold = false) => (
      <Text backgroundColor={bg} color={fg} bold={bold}>
        {` ${text} `}
      </Text>
    )
    const heading = (title: string, right?: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={WAY_ACCENT}>◆ </Text>
          <Text bold>{title}</Text>
        </Text>
        {right}
      </Box>
    )
    const card = (key: string, children: RenderChildren) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={WAY_EDGE} paddingX={1}>
        {children}
      </Box>
    )
    const typeChip = (t: Ticket) =>
      t.type ? <Text color={TYPE_COLOR[t.type]}>{t.type}</Text> : <Text dimColor>untyped</Text>

    const bar = () => {
      if (!tickets.length) return <Text backgroundColor={WAY_TRACK}>{' '.repeat(inner)}</Text>
      let left = inner
      const cells = WAY_LEGEND.map(({ state }, i) => {
        const width = i === WAY_LEGEND.length - 1 ? left : Math.round((count(state) / tickets.length) * inner)
        left -= width
        return { state, width: Math.max(0, width) }
      })
      return (
        <Box flexDirection="row">
          {cells
            .filter(c => c.width > 0)
            .map(c => (
              <Text key={`bar-${c.state}`} backgroundColor={WAY_STATE_COLOR[c.state]}>
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
      await wayQuietly(() => fetchAnswer($, id))
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
          <Box flexShrink={1} flexDirection="row">
            <Text>
              <Text color={WAY_EDGE}>{prefix}</Text>
              <Text color={WAY_STATE_COLOR[s]}>{isFocused ? '◉' : STATE_MARK[s]} </Text>
            </Text>
            <Button
              key={`focus-${t.id}`}
              plain
              {...(digit ? { hotkey: digit } : {})}
              dimColor={s === 'resolved' || s === 'blocked'}
              label={t.title}
              onPress={() => toggleFocus(t.id)}
            />
            {extra > 0 ? <Text dimColor> ⋯{extra}</Text> : null}
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text>
              {typeChip(t)}
              {note === 'next' || note === 'you' ? (
                <Text> {pill(note, WAY_STATE_COLOR[s])}</Text>
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
            <Text color={WAY_STATE_COLOR[s]}>{STATE_MARK[s]} {s}</Text>
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
              <Text bold color={WAY_STATE_COLOR.resolved}>
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
          <Text color={WAY_ACCENT}>◎ </Text>
          <Text bold>{map?.destination ? map.destination : 'destination'}</Text>
        </Text>
        {rows.length === 0 && <Text dimColor>No tickets yet.</Text>}
        {rows.map(routeRow)}
        {rows.length > 0 && !focused && <Text dimColor>1–{Math.min(9, rows.length)} opens a ticket</Text>}
        {(map?.fog.length ?? 0) > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={WAY_FOG} bold>
              ≈ not yet specified
            </Text>
            {map?.fog.map((f, i) => (
              <Text key={`fog-${i}`} color={WAY_FOG} italic wrap="truncate-end">
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
      await wayQuietly(() => fetchAnswer($, t.id))
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
          <Text color={WAY_FOG} bold>
            ≈ not yet specified
          </Text>
          {map?.fog.map((f, i) => (
            <Text key={`fog-${i}`} color={WAY_FOG} italic wrap="truncate-end">
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
              <Text color={WAY_STATE_COLOR.resolved}>✓ </Text>
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
      <Button
        key={`tab-${key}`}
        plain
        hotkey={hotkey}
        dimColor={w.tab !== key}
        label={`${label}${n ? ` ${n}` : ''}`}
        onPress={() => update($, way, g => ({ ...g, tab: key }))}
      />
    )
    const resolved = count('resolved')

    return (
      <Box flexDirection="column">
        {header(el, WAY_PANE, e.props.bodyColumns, wayHeaderState(run, w.lines, map !== null), pickPane($))}
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
                    resolved === tickets.length ? WAY_STATE_COLOR.resolved : WAY_TRACK,
                    resolved === tickets.length ? WAY_INK : 'white',
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
                  : '/skillmaps wayfinder finds the map here, or /skillmaps wayfinder <issue | .scratch/effort>'}
              </Text>
            )}
            {map?.destination && (
              <Text wrap="wrap">
                <Text color={WAY_ACCENT}>◎ </Text>
                {cut(map.destination, inner * 2)}
              </Text>
            )}
            {charting.length > 0 &&
              spineBlock('Spine · charting', charting, 'charting-', tickets.length > 0 && !isChartingLive, !!run && !run.ticket)}
            {tickets.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {bar()}
                <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                  {WAY_LEGEND.filter(l => count(l.state) > 0).map(l => (
                    <Text key={`legend-${l.state}`}>
                      <Text color={WAY_STATE_COLOR[l.state]}>{STATE_MARK[l.state]} </Text>
                      {l.label} <Text bold>{count(l.state)}</Text>
                    </Text>
                  ))}
                  {(map?.fog.length ?? 0) > 0 && (
                    <Text>
                      <Text color={WAY_FOG}>≈ </Text>
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
            <Button key="refresh" label="Refresh" hotkey="r" onPress={() => wayRefresh($)} />
            <Button
              key="clear"
              label="Clear"
              hotkey="c"
              onPress={async () => {
                await update($, way, () => WAY_EMPTY)
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

const waySessionStart: Hook<'session.start'> = async ($, e, next) => {
  $.clock.every(WAY_POLL_MS, () => void wayRefresh($))
  const { target, lines } = await wayCurrent($)
  if (target || lines.length) {
    void openPane($, 'wayfinder')
    void wayRefresh($)
  }
  wayShownStatus = undefined
  await wayQuietly(() => waySyncStatus($))
  return next(e)
}

// The person's reply: the answers to the newest Level still waiting, or their word on the Wrap-up.
const wayPromptSubmit: Hook<'prompt.submit'> = async ($, e, next) => {
  if (!e.command && !e.isMeta && e.text.trim())
    await wayQuietly(async () => {
      const text = e.text.trim()
      await record($, (lines, ticket) => {
        const last = lastTurn(linesOf(lines, ticket))
        if (last?.kind === 'round' && last.reply === undefined)
          return mapLine(lines, last.id, l => ({ ...applyReply(last, text), ticket: l.ticket }))
        if (last?.kind === 'wrap' && last.reply === undefined)
          return mapLine(lines, last.id, l => ({ ...settleWrap(last, text), ticket: l.ticket }))
        return lines
      })
      await waySyncStatus($)
    })
  return next(e)
}

// /wayfinder starts a Run: with a map it works through it; with a loose idea it charts one, found once it is created.
// A grill the person asks for by name ends it.
const waySkillPrompt: Hook<'skill.prompt'> = async ($, e, next) => {
  const name = e.skill.replace(/^.*:/, '')
  if (name === 'wayfinder')
    await wayQuietly(async () => {
      await update($, running, r => r ?? { ticket: null, claimedAt: null })
      const args = /ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? ''
      const named = targetIn(args)
      if (named) await follow($, named)
      else void openPane($, 'wayfinder')
      await waySyncStatus($)
    })
  if (name === 'grill-me' || name === 'grill-with-docs') await wayQuietly(() => endRun($))
  return next(e)
}

const wayToolCall: Hook<'tool.call'> = async ($, e, next) => {
  if (e.agentId) return next(e)
  const isRun = (await wayRunOf($)) !== null

  // A fact the agent sends a sub-agent for: one Trace, running until the sub-agent reports.
  let agent: string | null = null
  if (isRun && e.tool === 'Agent') {
    const id = wayNewId('l')
    agent = id
    await wayQuietly(() =>
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
  const wasClaimed = new Set(((await wayCurrent($)).map?.tickets ?? []).filter(t => t.isClaimed).map(t => t.id))

  const ran = await next(e)
  if (agent) {
    const id = agent
    await wayQuietly(() => record($, lines => mapLine(lines, id, l => (l.kind === 'lookup' ? { ...l, isDone: true } : l))))
  }
  if (('deny' in ran && ran.deny) || ran.isError) return ran

  if (isRun && e.tool === 'AskUserQuestion')
    await wayQuietly(() => addLevel($, dialogRound(e.questions, ran.result, wayNewId('r'), Date.now())))

  // Reads and searches between Levels fold into one lookup.
  const looked = isRun ? lookupOf(e.tool, e as unknown as Record<string, unknown>) : null
  if (looked !== null)
    await wayQuietly(() =>
      record($, (lines, ticket, map) => {
        if (!keepsLookups(ticket, map)) return lines
        const last = lastOf(lines, ticket)
        const label = cut(looked, 60)
        return foldsInto(last)
          ? mapLine(lines, last.id, l => (l.kind === 'lookup' ? { ...l, count: l.count + 1, label } : l))
          : [...lines, { kind: 'lookup', id: wayNewId('l'), at: Date.now(), label, isAgent: false, count: 1, isDone: true, ticket }]
      }),
    )

  // The glossary's resolved terms and the ADRs, as they are written.
  if (isDoc && (e.tool === 'Write' || e.tool === 'Edit'))
    await wayQuietly(async () => {
      const trace =
        e.tool === 'Write'
          ? docTraceOf(path, e.content, before, false, wayNewId('d'), Date.now())
          : docTraceOf(path, e.new_string, e.old_string, true, wayNewId('d'), Date.now())
      if (!trace) return
      await record($, (lines, ticket) => {
        const last = lastOf(lines, ticket)
        return trace.kind === 'term' && termsFoldInto(last, path)
          ? mapLine(lines, last.id, l => (l.kind === 'term' ? { ...l, terms: [...new Set([...l.terms, ...trace.terms])] } : l))
          : [...lines, { ...trace, ticket }]
      })
    })

  if (e.tool === 'Write' || e.tool === 'Edit')
    await wayQuietly(async () => {
      const m = SCRATCH.exec(e.file_path)
      if (!m) return
      const text = e.tool === 'Write' ? e.content : e.new_string
      const id = m[2] ? String(Number(m[2])) : null
      await follow($, { source: 'local', ref: m[1] ?? '' })
      if (id && /^\s*\**status\**:?\**\s*claimed/im.test(text)) await claim($, id)
    })

  if (e.tool === 'Bash')
    await wayQuietly(async () => {
      const cmd = e.command
      const out = JSON.stringify(ran.result ?? '')
      const { target } = await wayCurrent($)
      if (/wayfinder:map/.test(cmd) && /gh issue create/.test(cmd)) {
        const wayMade = /issues\/(\d+)/.exec(out)?.[1]
        if (wayMade) return follow($, { source: 'github', ref: wayMade })
      }
      const claimed = /gh issue edit\s+#?(\d+)[^|;&]*--add-assignee/.exec(cmd)?.[1]
      const touches =
        target?.source === 'github'
          ? /\bgh (issue|api)\b/.test(cmd) && !/gh issue (view|list)\b/.test(cmd)
          : target?.source === 'local' && /\.scratch\//.test(cmd)
      if (!touches) return
      if (target?.source === 'github' && !claimed) return void wayRefresh($)
      await wayRefresh($)
      if (claimed) return claim($, claimed)
      // A local claim made from the shell: a ticket file the command named, claimed now and not before.
      if (target?.source === 'local') {
        const named = new Set([...cmd.matchAll(/issues\/(\d+)/g)].map(n => String(Number(n[1]))))
        const now = (await wayCurrent($)).map?.tickets.find(t => named.has(t.id) && t.isClaimed && !t.isClosed && !wasClaimed.has(t.id))
        if (now) await claim($, now.id)
      }
    })

  return ran
}

// A Level is a main-loop turn that ends on questions; one that ends without them, once answered, is the Wrap-up.
const wayTurnComplete: Hook<'turn.complete'> = async ($, e, next) => {
  const done = await next(e)
  if (!e.agentId && e.reason === 'answer')
    await wayQuietly(async () => {
      const questions = parseRound(e.answer)
      if (questions.length)
        return addLevel($, { kind: 'round', id: wayNewId('r'), at: Date.now(), via: 'grilling', questions })
      await record($, (lines, ticket) =>
        isWrapDue(linesOf(lines, ticket))
          ? [...lines, { kind: 'wrap', id: wayNewId('w'), at: Date.now(), text: cut(plain(e.answer), 600), ticket }]
          : lines,
      )
      await waySyncStatus($)
    })
  return done
}


// ======== spec-map
const SPEC_PANE = 'spec-map'
const SPEC_TITLE = 'spec-map'
const SPEC_POLL_MS = 60_000
// The steps each agent keeps, and how many the focused card lays out.
const SPEC_STEPS_KEPT = 40
const STEPS_SHOWN = 14

// The deck palette: muted pills on a dark track, dark ink on the pills.
const SPEC_INK = '#151515'
const SPEC_TRACK = '#2b2b2b'
const SPEC_EDGE = '#4a4a4a'
const SPEC_ACCENT = '#d97757'
const PAST_BG = '#1f3b31'
type TicketState = 'done' | 'implemented' | 'merging' | 'working' | 'ready' | 'blocked' | 'failed'
const SPEC_STATE_COLOR: Record<TicketState, string> = {
  done: '#5ccf9f',
  implemented: '#7fb4f5',
  merging: '#b79cf5',
  working: SPEC_ACCENT,
  ready: '#e2b867',
  blocked: '#5a5a5a',
  failed: '#e5737b',
}
// Bar order, left to right: what is finished first, what waits last.
const SPEC_LEGEND: { state: TicketState; label: string }[] = [
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
  pass: SPEC_STATE_COLOR.done,
  fail: SPEC_STATE_COLOR.failed,
  running: SPEC_STATE_COLOR.ready,
  none: SPEC_EDGE,
}

// The states someone is acting on get a pill; the rest stay plain text.
const ACTIVE = new Set<TicketState>(['working', 'merging', 'implemented', 'failed'])
const ROLE_COLOR: Record<Role, string> = {
  implementer: SPEC_ACCENT,
  merger: SPEC_STATE_COLOR.merging,
  reviewer: SPEC_STATE_COLOR.implemented,
  explorer: SPEC_STATE_COLOR.ready,
  agent: '#9a9a9a',
}

const SPEC_EMPTY: Flow = {
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
const flow = atom({ plugin: 'skillmaps', key: 'flow' } as const, SPEC_EMPTY)

// A row an older version kept lacks the step log.
const upgrade = (a: AgentRow): AgentRow => ({ ...a, steps: a.steps ?? [], tools: a.tools ?? 0, errors: a.errors ?? 0 })

// State a session kept from an older version of the mod lacks the fields added since.
const specCurrent = async ($: EngineInterface): Promise<Flow> => {
  const f = { ...SPEC_EMPTY, ...(await read($, flow)) }
  return { ...f, agents: f.agents.map(upgrade) }
}

// Changes one agent's row, if the pane knows the agent.
const withAgent = (f: Flow, id: string, change: (a: AgentRow) => AgentRow): Flow =>
  f.agents.some(a => a.id === id)
    ? { ...f, agents: f.agents.map(a => (a.id === id ? change(upgrade(a)) : a)) }
    : f

const specFirstLine = (text: string) => text.split('\n').find(line => line.trim())?.trim() ?? ''

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

const specSince = (from: number, to = Date.now()) => {
  const s = Math.max(0, Math.round((to - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}

const specGh = async ($: EngineInterface, args: string[]) => {
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
    await specGh($, [
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
  const lines = await specGh($, [
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

type SpecGhIssue = { number: number; title: string; state: string; body: string | null }

// "## Blocked by" (GitHub tickets) or "**Blocked by:**" (local tickets); null when absent.
const blockersInBody = (body: string): number[] | null => {
  const m = /blocked by[:*\s]*([\s\S]*?)(?:\n#{1,6}\s|\n\*\*|$)/i.exec(body)
  return m ? refsIn(m[1] ?? '') : null
}

const specRefresh = async ($: EngineInterface) => {
  const { spec } = await specCurrent($)
  if (!spec) return
  try {
    const head = JSON.parse(await specGh($, ['issue', 'view', String(spec.number), '--json', 'title'])) as {
      title: string
    }
    const subs = JSON.parse(
      await specGh($, ['api', `repos/{owner}/{repo}/issues/${spec.number}/sub_issues?per_page=100`]),
    ) as SpecGhIssue[]
    const tickets: SpecTicket[] = []
    for (const sub of subs) {
      let blockedBy = blockersInBody(sub.body ?? '')
      if (blockedBy === null) {
        // to-tickets omits the section when it set native blocking edges.
        try {
          const deps = JSON.parse(
            await specGh($, ['api', `repos/{owner}/{repo}/issues/${sub.number}/dependencies/blocked_by`]),
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
    const found = await findPr($, spec.number, (await specCurrent($)).pr)
    if (found) {
      const view = JSON.parse(
        await specGh($, ['pr', 'view', String(found.number), '--json', 'statusCheckRollup']),
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
  await specRefresh($)
}

// Bookkeeping never fails the call it watches.
const specQuietly = async (work: () => Promise<unknown>) => {
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
  if (stage) void openPane($, 'spec')
  const spec = issueIn(args)
  if (spec !== null && (name === 'implement-spec' || name === 'to-tickets')) await setSpec($, spec)
}

/** spec-map: its hooks, registered when its setting is on. */
const registerSpec = (on: Parameters<Register>[0], options: Parameters<Register>[1]) => {
  // The `slots` setting wins over a cap read from the skill; 0 leaves it to the skill.


  on('command.run', { command: 'skillmaps' }, async ($, said, next) => {
    const [word = '', ...rest] = said.args.trim().split(/\s+/)
    if (word !== 'spec') return next(said)
    // `/skillmaps spec <n>` follows spec #n.
    const e = { ...said, args: /^#?\d+$/.test(rest[0] ?? '') ? `spec ${rest.join(' ')}` : rest.join(' ') }
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'clear') {
      await update($, flow, () => SPEC_EMPTY)
      return { text: 'Spec map cleared.' }
    }
    if (verb === 'spec') {
      const n = issueIn(arg)
      if (n === null) return { text: 'Usage: /skillmaps spec <issue number>' }
      await openPane($, 'spec')
      await setSpec($, n)
      return { text: `Following spec #${n}.` }
    }
    await openPane($, 'spec')
    if (verb === 'refresh') await specRefresh($)
    return { text: 'Spec map opened.' }
  })



  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if ('deny' in started && started.deny) return started
    await specQuietly(async () => {
      const id = started.agentId ?? e.tool_use_id
      const spec = (await specCurrent($)).spec?.number
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


  // What an agent writes between its tools: why it runs the next one, what it found.
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    const id = e.agentId
    const said = specFirstLine(step.answer)
    if (id && said) {
      const row: AgentStep = {
        kind: 'say',
        id: `say-${step.turnId}-${step.index}`,
        text: said.slice(0, 300),
        status: 'ok',
        at: Date.now(),
      }
      await specQuietly(() =>
        update($, flow, f => withAgent(f, id, a => ({ ...a, steps: [...a.steps, row].slice(-SPEC_STEPS_KEPT) }))),
      )
    }
    return step
  })


  on('ui.render', { component: 'Pane', requestId: SPEC_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const f = await specCurrent($)
    const now = Date.now()
    const inner = Math.max(20, e.props.bodyColumns - 4)
    const merged = new Set(
      f.agents.filter(a => a.role === 'merger' && a.status === 'done').flatMap(a => a.tickets),
    )
    const isDone = (n: number) =>
      merged.has(n) || f.tickets.some(t => t.number === n && (t.isClosed || t.isMerged))
    const stateOf = (t: SpecTicket): { state: TicketState; note: string } => {
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
    // Followed with /skillmaps spec, no skill set the stage: the tickets say where the work stands.
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
    const cap = specConfiguredCap ?? f.slotCap

    const pill = (text: string, bg: string, fg = SPEC_INK, bold = false) => (
      <Text backgroundColor={bg} color={fg} bold={bold}>
        {` ${text} `}
      </Text>
    )
    const heading = (title: string, right?: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={SPEC_ACCENT}>◆ </Text>
          <Text bold>{title}</Text>
        </Text>
        {right}
      </Box>
    )
    const card = (key: string, children: RenderChildren) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={SPEC_EDGE} paddingX={1}>
        {children}
      </Box>
    )

    // One cell row split by ticket state, like the context bar.
    const bar = () => {
      if (!tickets.length) return <Text backgroundColor={SPEC_TRACK}>{' '.repeat(inner)}</Text>
      let left = inner
      const cells = SPEC_LEGEND.map(({ state }, i) => {
        const n = count(state)
        const width = i === SPEC_LEGEND.length - 1 ? left : Math.round((n / tickets.length) * inner)
        left -= width
        return { state, width: Math.max(0, width) }
      })
      return (
        <Box flexDirection="row">
          {cells
            .filter(c => c.width > 0)
            .map(c => (
              <Text key={`bar-${c.state}`} backgroundColor={SPEC_STATE_COLOR[c.state]}>
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
        {a.tools} tools{a.errors ? <Text color={SPEC_STATE_COLOR.failed}> · {a.errors} ✗</Text> : ''}
      </Text>
    )

    const agentRow = (a: AgentRow) => {
      const color = ROLE_COLOR[a.role]
      const refs = a.tickets.map(n => `#${n}`).join(' ')
      const age = specSince(a.startedAt, a.endedAt ?? now)
      const label = ` ${a.activity.slice(0, inner - 3)}${a.activity.length > inner - 3 ? '…' : ''} `
      const digit = String(listed.indexOf(a) + 1)
      const isFocused = a.id === f.focus
      if (a.status !== 'running') {
        return (
          <Box key={`agent-${a.id}`} flexDirection="row" justifyContent="space-between">
            <Box flexShrink={1} flexDirection="row">
              <Button key={`focus-${a.id}`} plain hotkey={digit} dimColor={!isFocused} label={`${a.role}${refs ? ` ${refs}` : ''}`} onPress={() => toggleFocus(a.id)} />
              <Text dimColor={!isFocused} bold={isFocused} wrap="truncate-end">
                {' '}
                <Text color={a.status === 'done' ? SPEC_STATE_COLOR.done : SPEC_STATE_COLOR.failed}>{a.status === 'done' ? '✓' : '✗'}</Text>
                {' · '}
                {a.report || a.description}
              </Text>
            </Box>
            <Text dimColor> {age}</Text>
          </Box>
        )
      }
      return (
        <Box key={`agent-${a.id}`} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexShrink={1} flexDirection="row">
              <Button key={`focus-${a.id}`} plain hotkey={digit} label={a.role} onPress={() => toggleFocus(a.id)} />
              <Text wrap="truncate-end">
                <Text color={color}>{isFocused ? ' ◉' : ' ●'}</Text>
                {refs ? <Text color={color}> {refs}</Text> : ''}
                <Text dimColor> · {a.description}</Text>
              </Text>
            </Box>
            <Text>
              {counts(a)}
              <Text dimColor> ↻ {age}</Text>
            </Text>
          </Box>
          <Text>
            <Text backgroundColor={color} color={SPEC_INK}>
              {label}
            </Text>
            <Text backgroundColor={SPEC_TRACK}>{' '.repeat(inner - label.length)}</Text>
          </Text>
        </Box>
      )
    }

    const STEP_MARK: Record<AgentStep['status'], { mark: string; color: string }> = {
      running: { mark: '●', color: SPEC_ACCENT },
      ok: { mark: '✓', color: SPEC_STATE_COLOR.done },
      error: { mark: '✗', color: SPEC_STATE_COLOR.failed },
    }
    const stepRow = (s: AgentStep) => {
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
            <Text dimColor> {s.status === 'running' ? `↻ ${specSince(s.at, now)}` : specSince(s.at, s.at + (s.ms ?? 0))}</Text>
          </Box>
          {s.error && (
            <Text color={SPEC_STATE_COLOR.failed} dimColor wrap="truncate-end">
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
              <Text dimColor> · {specSince(a.startedAt, a.endedAt ?? now)}</Text>
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
              <Text color={a.status === 'done' ? SPEC_STATE_COLOR.done : SPEC_STATE_COLOR.failed}>⏎ </Text>
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
        {header({ Box, Text, Button }, SPEC_PANE, e.props.bodyColumns, {
          // The stage the spec stands at; the strip drifts while an agent works on it.
          state: stage ?? 'idle',
          isLive: f.agents.some(a => a.status === 'running'),
        }, pickPane($))}
        {card(
          'flow',
          <Box flexDirection="column">
            {heading(
              'flow',
              <Text>
                <Text dimColor>{f.spec ? `spec #${f.spec.number}` : 'no spec'} </Text>
                {pill(
                  `${percent}%`,
                  percent === 100 ? SPEC_STATE_COLOR.done : SPEC_TRACK,
                  percent === 100 ? SPEC_INK : 'white',
                  true,
                )}
              </Text>,
            )}
            {f.spec?.title ? (
              <Text bold wrap="truncate-end">
                {headline(f.spec.title)}
              </Text>
            ) : (
              !f.spec && <Text dimColor>/skillmaps spec &lt;n&gt; to follow one</Text>
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
                  {i > 0 ? <Text color={SPEC_EDGE}>▸</Text> : ''}
                  {i === at
                    ? pill(s.label, SPEC_ACCENT, SPEC_INK, true)
                    : i < at
                      ? pill(s.label, PAST_BG, SPEC_STATE_COLOR.done)
                      : pill(s.label, SPEC_TRACK, 'gray')}
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
                  <Text key={`slot-${i}`} color={i < slots ? ROLE_COLOR.implementer : SPEC_EDGE}>
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
              {SPEC_LEGEND.filter(l => count(l.state) > 0).map(l => (
                <Text key={`legend-${l.state}`}>
                  <Text color={SPEC_STATE_COLOR[l.state]}>■ </Text>
                  {l.label} <Text bold>{count(l.state)}</Text>
                </Text>
              ))}
            </Box>
            {tickets.length > 0 && <Text> </Text>}
            {tickets.map(t => (
              <Box key={`ticket-${t.number}`} flexDirection="row" justifyContent="space-between">
                <Box flexShrink={1}>
                  <Text wrap="truncate-end" dimColor={t.state === 'done' || t.state === 'blocked'}>
                    <Text color={SPEC_STATE_COLOR[t.state]}>■ </Text>
                    <Text bold>#{t.number}</Text> {shortTitle(t.title)}
                  </Text>
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                  {ACTIVE.has(t.state) ? (
                    pill(t.note, SPEC_STATE_COLOR[t.state])
                  ) : (
                    <Text
                      color={t.state === 'blocked' ? undefined : SPEC_STATE_COLOR[t.state]}
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

        {f.error && <Text color={SPEC_STATE_COLOR.failed}> gh: {f.error}</Text>}
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            <Button key="refresh" label="Refresh" hotkey="r" onPress={() => specRefresh($)} />
            <Button key="clear" label="Clear" hotkey="c" onPress={() => update($, flow, () => SPEC_EMPTY)} />
          </Box>
          {f.refreshedAt !== null && <Text dimColor>↻ {specSince(f.refreshedAt, now)} ago</Text>}
        </Box>
      </Box>
    )
  })
}

const specSessionStart: Hook<'session.start'> = async ($, e, next) => {
  $.clock.every(SPEC_POLL_MS, () => void specRefresh($))
  const { spec, stage } = await specCurrent($)
  if (spec || stage) void openPane($, 'spec')

  return next(e)
}

// A skill typed as /name args.
const specPromptSubmit: Hook<'prompt.submit'> = async ($, e, next) => {
  const m = /^\/([\w:-]+)\s*([\s\S]*)$/.exec(e.text.trim())
  if (m) await specQuietly(() => enterSkill($, m[1] ?? '', m[2] ?? ''))
  return next(e)
}

// Every skill the model or the person runs, whatever route it came by.
const specSkillPrompt: Hook<'skill.prompt'> = async ($, e, next) => {
  const args = /ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? ''
  await specQuietly(() => enterSkill($, e.skill, args))
  const cap = STAGE_OF[e.skill.replace(/^.*:/, '')] === 'implement' ? slotCapIn(e.text) : null
  if (cap !== null) await specQuietly(() => update($, flow, f => ({ ...f, slotCap: cap })))
  return next(e)
}

const specToolCall: Hook<'tool.call'> = async ($, e, next) => {
  const id = e.agentId
  const stepId = e.tool_use_id ?? `call-${++specCalls}`
  const at = Date.now()
  if (id) {
    const activity = activityOf(e)
    const step: AgentStep = { kind: 'tool', id: stepId, text: activity, status: 'running', at }
    await specQuietly(() =>
      update($, flow, f =>
        withAgent(f, id, a => ({
          ...a,
          activity,
          tools: a.tools + 1,
          steps: [...a.steps, step].slice(-SPEC_STEPS_KEPT),
        })),
      ),
    )
  }
  const ran = await next(e)
  if (id) {
    const failure = 'deny' in ran && ran.deny ? ran.deny : ran.isError ? (ran.text ?? 'error') : null
    const error = failure === null ? undefined : specFirstLine(failure).slice(0, 200)
    await specQuietly(() =>
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
  if (e.tool === 'Skill' && !id) await specQuietly(() => enterSkill($, e.skill, e.args ?? ''))
  if (e.tool === 'Bash')
    await specQuietly(async () => {
      const out = `${JSON.stringify(ran.result ?? '')}`
      const cmd = e.command
      const pr = /pull\/(\d+)/.exec(out)?.[1] ?? /pr:wait\s+(\d+)/.exec(cmd)?.[1]
      if (pr) await update($, flow, f => ({ ...f, pr: Number(pr) }))
      if (/gh pr merge/.test(cmd)) await update($, flow, f => ({ ...f, stage: 'ship' as const }))
      const { stage, spec } = await specCurrent($)
      if (/gh issue create/.test(cmd)) {
        const made = issueIn(out)
        if (stage === 'spec' && made !== null) await setSpec($, made)
        else if (spec) void specRefresh($)
      }
    })

  return ran
}

const specTurnComplete: Hook<'turn.complete'> = async ($, e, next) => {
  const done = await next(e)
  const id = e.agentId
  if (id)
    await specQuietly(async () => {
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
      const row = (await specCurrent($)).agents.find(a => a.id === id)
      if (row?.role === 'merger' || row?.role === 'implementer') void specRefresh($)
    })

  return done
}


const mainSessionStart: Hook<'session.start'> = async ($, e, next) => {
  await $.command.register({
    name: 'skillmaps',
    description: enabledParts.length
      ? `Show a skill map pane: ${enabledParts.map(p => PANE_OF[p]).join(', ')}`
      : 'skillmaps: every map is turned off in its settings',
    argumentHint: enabledParts.length ? `[${enabledParts.join(' | ')}]` : '',
  })
  // The header's strip drifts while a part works: a redraw each frame, and none at rest.
  $.clock.every(FRAME_MS, () => {
    if (isDrifting()) $.ui.invalidate('ui.render')
  })
  return next(e)
}

const USAGE: Record<Part, string> = {
  grill: '/skillmaps grill [clear]',
  wayfinder: '/skillmaps wayfinder [<map> | refresh | clear]',
  spec: '/skillmaps spec [<n> | refresh | clear]',
}

export const register: Register = (on, options) => {
  enabledParts = PARTS.filter(p => options[p] !== false)
  specConfiguredCap = typeof options.slots === 'number' && options.slots > 0 ? options.slots : null
  setLegend(enabledParts.map(p => PANE_OF[p]))


  // A word an enabled part answers goes to it; a bare /skillmaps opens the pane used last, or the first one on.
  on('command.run', { command: 'skillmaps' }, async ($, e, next) => {
    const [word = ''] = e.args.trim().split(/\s+/)
    if ((enabledParts as string[]).includes(word)) return next(e)
    const part = word === '' ? (lastPart ?? enabledParts[0]) : undefined
    if (part) {
      await openPane($, part)
      return { text: `${PANE_OF[part]} opened.` }
    }
    if (!enabledParts.length) return { text: 'Every skill map is turned off: turn one on in /plugin, under skillmaps.' }
    const off = PARTS.filter(p => !enabledParts.includes(p) && p === word)
    return {
      text: off.length
        ? `${PANE_OF[word as Part]} is turned off: turn it on in /plugin, under skillmaps.`
        : ['Usage:', ...enabledParts.map(p => `  ${USAGE[p]}`)].join('\n'),
    }
  })

  // One hook per event the parts share: each enabled part in turn, then the plugins beneath. Each step is a
  // `next` of its own, carrying what the engine's carries.
  on('session.start', ($, e, next) => {
    const toSpec = Object.assign((x: typeof e) => (is('spec') ? specSessionStart($, x, next) : next(x)), next)
    const toWay = Object.assign((x: typeof e) => (is('wayfinder') ? waySessionStart($, x, toSpec) : toSpec(x)), next)
    const toGrill = Object.assign((x: typeof e) => (is('grill') ? grillSessionStart($, x, toWay) : toWay(x)), next)
    return mainSessionStart($, e, toGrill)
  })
  on('prompt.submit', ($, e, next) => {
    const toSpec = Object.assign((x: typeof e) => (is('spec') ? specPromptSubmit($, x, next) : next(x)), next)
    const toWay = Object.assign((x: typeof e) => (is('wayfinder') ? wayPromptSubmit($, x, toSpec) : toSpec(x)), next)
    const toGrill = Object.assign((x: typeof e) => (is('grill') ? grillPromptSubmit($, x, toWay) : toWay(x)), next)
    return toGrill(e)
  })
  on('skill.prompt', ($, e, next) => {
    const toSpec = Object.assign((x: typeof e) => (is('spec') ? specSkillPrompt($, x, next) : next(x)), next)
    const toWay = Object.assign((x: typeof e) => (is('wayfinder') ? waySkillPrompt($, x, toSpec) : toSpec(x)), next)
    const toGrill = Object.assign((x: typeof e) => (is('grill') ? grillSkillPrompt($, x, toWay) : toWay(x)), next)
    return toGrill(e)
  })
  on('tool.call', ($, e, next) => {
    const toSpec = Object.assign((x: typeof e) => (is('spec') ? specToolCall($, x, next) : next(x)), next)
    const toWay = Object.assign((x: typeof e) => (is('wayfinder') ? wayToolCall($, x, toSpec) : toSpec(x)), next)
    const toGrill = Object.assign((x: typeof e) => (is('grill') ? grillToolCall($, x, toWay) : toWay(x)), next)
    return toGrill(e)
  })
  on('turn.complete', ($, e, next) => {
    const toSpec = Object.assign((x: typeof e) => (is('spec') ? specTurnComplete($, x, next) : next(x)), next)
    const toWay = Object.assign((x: typeof e) => (is('wayfinder') ? wayTurnComplete($, x, toSpec) : toSpec(x)), next)
    const toGrill = Object.assign((x: typeof e) => (is('grill') ? grillTurnComplete($, x, toWay) : toWay(x)), next)
    return toGrill(e)
  })

  if (enabledParts.includes('grill')) registerGrill(on, options)
  if (enabledParts.includes('wayfinder')) registerWay(on, options)
  if (enabledParts.includes('spec')) registerSpec(on, options)
}
