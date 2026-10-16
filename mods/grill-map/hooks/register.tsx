import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Grill, GrillBook, GrillSkill, RoundStep, Step, WayfinderRun } from '../types'
import { applyReply, dialogRound, firstLine, isWaiting, isWrapDue, lastTurn, markOf, parseRound, plain, settleWrap } from './reply'
import type { Mark } from './reply'
import { FRAME_MS, header, isDrifting } from './header'
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
  spineHeading,
  spineRows,
  termsFoldInto,
} from './spine'

const PANE = 'grill-map'
const TITLE = 'grill-map'
const GRILLS_KEPT = 8
const STEPS_KEPT = 200

// The modsbook palette: muted pills on a dark track, dark ink on the pills.
const INK = '#151515'
const TRACK = '#2b2b2b'

const MARKS: Mark[] = ['took', 'own', 'replied', 'open']
const MARK_LABEL: Record<Mark, string> = { took: 'took', own: 'yours', replied: 'in reply', open: 'open' }

const SKILLS = new Set<string>(['grilling', 'grill-me', 'grill-with-docs'])

const EMPTY: GrillBook = { grills: [], shown: null, expanded: [], isAllExpanded: false, lastPrompt: '' }
const book = atom({ plugin: 'grill-map', key: 'book' } as const, EMPTY)

// State kept from an older version lacks the fields added since.
const current = async ($: EngineInterface): Promise<GrillBook> => ({ ...EMPTY, ...(await read($, book)) })

let made = 0
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}-${made++}`

// ── Inside /wayfinder: wayfinder-map owns the Run, grill-map reads it ──

const RUN = { plugin: 'wayfinder-map', key: 'run' } as const

/** The Run wayfinder-map is on, or null: none, or no wayfinder-map. */
const runOf = async ($: EngineInterface): Promise<WayfinderRun | null> => (await $.state.get(RUN)).value ?? null

/** Which grill a step belongs to: the Run's claimed ticket, `charting`, or none outside a Run. */
const keyOf = (run: WayfinderRun | null) => (run ? (run.ticket?.id ?? 'charting') : undefined)

// ── The book of grills: the newest one still open is the one being worked ──

const open = ($: EngineInterface) => void $.ui.open({ id: PANE, title: TITLE })

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

const push = (g: Grill, step: Step): Grill => ({ ...g, steps: [...g.steps, step].slice(-STEPS_KEPT) })
const mapStep = (g: Grill, id: string, fn: (s: Step) => Step): Grill => ({
  ...g,
  steps: g.steps.map(s => (s.id === id ? fn(s) : s)),
})

const start = async ($: EngineInterface, skill: GrillSkill, subject: string, run?: string) => {
  const grill: Grill = {
    id: newId('g'),
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
  const run = await runOf($)
  const key = keyOf(run)
  const b = await current($)
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

let shownStatus: string | undefined

/** The header's word for the grill shown: grilling while the model works, your turn while a round waits. */
const headerState = (g: Grill | undefined): HeaderState => {
  if (!g) return { state: 'idle', isLive: false }
  if (g.isDone) return { state: 'done', isLive: false }
  const last = g.steps.filter((s): s is RoundStep => s.kind === 'round').at(-1)
  const step = lastTurn(g.steps)
  if ((step?.kind === 'wrap' && step.reply === undefined) || (last && isWaiting(last))) return { state: 'your turn', isLive: false }
  return { state: 'grilling', isLive: true }
}

/** The status line while a grill of its own is open; inside a Run, wayfinder-map's carries it. */
const syncStatus = async ($: EngineInterface) => {
  const run = await runOf($)
  const g = run ? null : liveFor(await current($), undefined)
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
  if (text === shownStatus) return
  shownStatus = text
  $.ui.status(text)
}

// Bookkeeping never fails the call it watches.
const quietly = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch {
    // the pane misses one update; the session goes on
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The header's strip drifts while the mod works: a redraw each frame, and none at rest.
    $.clock.every(FRAME_MS, () => {
      if (isDrifting()) $.ui.invalidate('ui.render')
    })
    await $.command.register({
      name: 'grillmap',
      description: 'Show the grill map pane: the design tree of /grilling, /grill-me and /grill-with-docs (/grillmap clear)',
      argumentHint: '[clear]',
    })
    if ((await current($)).grills.length) open($)
    shownStatus = undefined
    await quietly(() => syncStatus($))
    return next(e)
  })

  on('command.run', { command: 'grillmap' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, book, b => ({ ...EMPTY, lastPrompt: b.lastPrompt }))
      await quietly(() => syncStatus($))
      return { text: 'Grill map cleared.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    const { grills } = await current($)
    return { text: grills.length ? 'Grill map opened.' : 'Grill map opened: it fills once /grill-me, /grill-with-docs or /grilling runs.' }
  })

  // The wrappers start a grill of their own; /grilling joins the one they started, or the Run's, or starts its own.
  on('skill.prompt', async ($, e, next) => {
    const name = e.skill.replace(/^.*:/, '')
    // Another skill's argument (`/wayfinder <idea>`) is the subject of a grill it runs.
    const given = plain(/ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? '')
    if (!SKILLS.has(name) && given) await quietly(() => update($, book, b => ({ ...b, lastPrompt: cut(given, 200) })))
    if (SKILLS.has(name))
      await quietly(async () => {
        if (name !== 'grilling') return start($, name as GrillSkill, given)
        if (await runOf($)) {
          await landing($, 'round')
          return open($)
        }
        const b = await current($)
        if (liveFor(b, undefined)) {
          if (given) await withLive($, undefined, g => (g.subject ? g : { ...g, subject: cut(given, 200) }))
          return open($)
        }
        await start($, 'grilling', given || b.lastPrompt)
      })
    // Beneath, wayfinder-map starts or ends its Run: the status line follows it.
    const done = await next(e)
    await quietly(() => syncStatus($))
    return done
  })

  // The person's reply: the answers to the waiting round, the verdict on a wrap-up, or the subject itself.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && e.text.trim())
      await quietly(async () => {
        const key = keyOf(await runOf($))
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
    await quietly(() => syncStatus($))
    return next(e)
  })

  // A round is a main-loop turn that ends on questions; one that ends without them, once answered, is the wrap-up.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.reason === 'answer')
      await quietly(async () => {
        const questions = parseRound(e.answer)
        if (questions.length) {
          const at = await landing($, 'round')
          if (!at) return
          await addRound($, at.key, { kind: 'round', id: newId('r'), at: Date.now(), via: 'grilling', questions })
          return open($)
        }
        const key = keyOf(await runOf($))
        const g = liveFor(await current($), key)
        if (g && isWrapDue(g.steps))
          await withLive($, key, x => push(x, { kind: 'wrap', id: newId('w'), at: Date.now(), text: cut(plain(e.answer), 600) }))
      })
    await quietly(() => syncStatus($))
    return done
  })

  on('tool.call', async ($, e, next) => {
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
      const id = newId('l')
      await quietly(() =>
        withLive($, key, x =>
          push(x, { kind: 'lookup', id, at: Date.now(), label: plain(e.description), isAgent: true, count: 1, isDone: false }),
        ),
      )
      const ran = await next(e)
      await quietly(() => withLive($, key, x => mapStep(x, id, s => ({ ...s, isDone: true }))))
      return ran
    }

    const before = e.tool === 'Write' && isDoc ? await $.fs.read(path).catch(() => null) : null

    const ran = await next(e)
    if (('deny' in ran && ran.deny) || ran.isError) return ran

    if (e.tool === 'AskUserQuestion')
      await quietly(async () => {
        await addRound($, key, dialogRound(e.questions, ran.result, newId('r'), Date.now()))
        await syncStatus($)
      })

    // Reads and searches between rounds fold into one lookup.
    if (looked !== null)
      await quietly(() =>
        withLive($, key, x => {
          const last = x.steps.at(-1)
          const label = cut(looked, 60)
          return foldsInto(last)
            ? mapStep(x, last.id, s => (s.kind === 'lookup' ? { ...s, count: s.count + 1, label } : s))
            : push(x, { kind: 'lookup', id: newId('l'), at: Date.now(), label, isAgent: false, count: 1, isDone: true })
        }),
      )

    // grill-with-docs: the glossary's resolved terms and the ADRs, as they are written.
    if (isDoc && (e.tool === 'Write' || e.tool === 'Edit'))
      await quietly(async () => {
        const trace =
          e.tool === 'Write'
            ? docTraceOf(path, e.content, before, false, newId('d'), Date.now())
            : docTraceOf(path, e.new_string, e.old_string, true, newId('d'), Date.now())
        if (!trace) return
        await withLive($, key, x => {
          const last = x.steps.at(-1)
          return trace.kind === 'term' && termsFoldInto(last, path)
            ? mapStep(x, last.id, s => (s.kind === 'term' ? { ...s, terms: [...new Set([...s.terms, ...trace.terms])] } : s))
            : push(x, trace)
        })
      })

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const el = { Box, Text, Button }
    const b = await current($)
    const now = Date.now()
    const inner = Math.max(24, e.props.bodyColumns - 4)
    const g = b.grills.find(x => x.id === b.shown) ?? b.grills.at(-1)
    const state = headerState(g)

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

    if (!g)
      return (
        <Box flexDirection="column">
          {header(el, PANE, e.props.bodyColumns, state)}
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
              ? pill('done', GREEN, INK, true)
              : all.length > 0
                ? pill(`${settled}/${all.length}`, settled === all.length ? GREEN : TRACK, settled === all.length ? INK : 'white', true)
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
        {header(el, PANE, e.props.bodyColumns, state)}
        {head}
        {tree}
        <Box flexDirection="row" columnGap={1} paddingX={1}>
          {foldAllButton(el, b.isAllExpanded, () =>
            update($, book, x => ({ ...x, isAllExpanded: !x.isAllExpanded, expanded: [] })),
          )}
          {b.grills.length > 1 && <Button key="prev" label="Prev" hotkey="p" onPress={() => pick(-1)} />}
          {b.grills.length > 1 && <Button key="next" label="Next" hotkey="n" onPress={() => pick(1)} />}
          <Button key="clear" label="Clear" hotkey="c" onPress={async () => {
              await update($, book, x => ({ ...EMPTY, lastPrompt: x.lastPrompt }))
              await syncStatus($)
            }} />
        </Box>
      </Box>
    )
  })
}
