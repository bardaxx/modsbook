import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Grill, GrillBook, GrillSkill, Question, RoundStep, Step } from '../types'

const PANE = 'grill-map'
const TITLE = 'Grill'
const GRILLS_KEPT = 8
const STEPS_KEPT = 200

// The modsbook palette: muted pills on a dark track, dark ink on the pills.
const INK = '#151515'
const TRACK = '#2b2b2b'
const EDGE = '#4a4a4a'
const ACCENT = '#d97757'
const FOG = '#8a93a6'
const GREEN = '#5ccf9f'
const AMBER = '#e2b867'
const VIOLET = '#b79cf5'
const TEAL = '#6fd3c8'
const BLUE = '#7fb4f5'

/** How a question stands: took the recommendation, answered otherwise, answered in an unsplit reply, or open. */
type Mark = 'took' | 'own' | 'replied' | 'open'
const MARK: Record<Mark, string> = { took: '✓', own: '✎', replied: '⏎', open: '◌' }
const MARK_COLOR: Record<Mark, string> = { took: GREEN, own: ACCENT, replied: FOG, open: AMBER }
const MARKS: Mark[] = ['took', 'own', 'replied', 'open']
const MARK_LABEL: Record<Mark, string> = { took: 'took', own: 'yours', replied: 'in reply', open: 'open' }

const SKILLS = new Set<string>(['grilling', 'grill-me', 'grill-with-docs'])
const GLOSSARY = /(?:^|\/)(?:CONTEXT|GLOSSARY)\.md$/
const ADR = /(?:^|\/)docs\/adr\/(\d+)-([^/]+)\.md$/
const TERM = /^\s*\*\*([^*\n]+?)\*\*\s*:/gm
// Search tools a build may or may not ship; where it has none, the shell's searches count instead.
const SEARCHES = new Set<string>(['Grep', 'Glob'])
const SHELL_LOOKUP = /^\s*(rg|grep|cat|ls|find|head|tail|tree|sed -n|git (?:log|show|diff|grep|blame))\b/

const EMPTY: GrillBook = { grills: [], shown: null, expanded: [], isAllExpanded: false, lastPrompt: '' }
const book = atom({ plugin: 'grill-map', key: 'book' } as const, EMPTY)

// State kept from an older version lacks the fields added since.
const current = async ($: EngineInterface): Promise<GrillBook> => ({ ...EMPTY, ...(await read($, book)) })

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
const base = (path: string) => path.split('/').pop() ?? path

/** Words laid into lines of `width`, at most `max` of them, the last cut with `…`. */
const wrapLines = (text: string, width: number, max: number): string[] => {
  const lines: string[] = []
  let line = ''
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const word = cut(raw, width)
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  const last = kept[max - 1] ?? ''
  kept[max - 1] = last.length >= width ? `${last.slice(0, width - 1)}…` : `${last}…`
  return kept
}

let made = 0
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}-${made++}`

// ── A round, as the grilling skill lays one out ──

/** `❓ **Q1** - **Title**: body … ➡ recommended`, once per question of the round. */
const parseRound = (text: string): Question[] =>
  text
    .split(/^[ \t>]*❓\uFE0F?\s*/m)
    .slice(1)
    .flatMap(chunk => {
      const head = /^\**\s*Q?(\d+)\s*\**\s*[-–—:.]?\s*(?:\*\*([^*]+)\*\*\s*:?)?\s*([\s\S]*)$/i.exec(chunk)
      if (!head) return []
      const rest = (head[3] ?? '').split(/\n\s*---/)[0] ?? ''
      const arrow = rest.search(/➡/)
      const before = arrow < 0 ? rest : rest.slice(0, arrow)
      const recommended = arrow < 0 ? '' : plain(rest.slice(arrow).replace(/^➡\uFE0F?\s*/, '').split(/\n\s*\n/)[0] ?? '')
      const option = (line: string) => /^\s*(?:[-*]|\(?[a-zA-Z0-9]\)|[A-Za-z]\.)\s+(.+)$/.exec(line)?.[1]
      const lines = before.split('\n')
      const options = lines
        .map(option)
        .filter((o): o is string => Boolean(o))
        .map(plain)
        .slice(0, 6)
      const title = plain(head[2] ?? firstLine(before))
      const body = plain(lines.filter(line => !option(line)).join('\n'))
      return title ? [{ n: head[1] ?? '', title, body: head[2] ? body : '', options, recommended }] : []
    })

const YES = /^(y|yes|yep|yeah|ok|okay|sure|agreed|go|lgtm|s[iì]|certo|va bene|confermo|d'accordo|perfetto|esatto|👍)\b/i

/** Hands the person's reply out to the round's questions: `1. yes`, `Q2: no, …`, or one answer for all. */
const applyReply = (round: RoundStep, reply: string): RoundStep => {
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

const markOf = (q: Question, r: RoundStep): Mark =>
  q.answer !== undefined ? (q.isAccepted ? 'took' : 'own') : r.reply !== undefined ? 'replied' : 'open'

const isWaiting = (r: RoundStep) => r.reply === undefined && r.questions.some(q => q.answer === undefined)

// ── The book of grills: the newest one still open is the one being worked ──

const open = ($: EngineInterface) => void $.ui.open({ id: PANE, title: TITLE })

const live = (b: GrillBook) => {
  const g = b.grills.at(-1)
  return g && !g.isDone ? g : null
}

const withLive = ($: EngineInterface, fn: (g: Grill) => Grill) =>
  update($, book, b => {
    const g = live(b)
    return g ? { ...b, grills: [...b.grills.slice(0, -1), fn(g)] } : b
  })

const push = (g: Grill, step: Step): Grill => ({ ...g, steps: [...g.steps, step].slice(-STEPS_KEPT) })
const mapStep = (g: Grill, id: string, fn: (s: Step) => Step): Grill => ({
  ...g,
  steps: g.steps.map(s => (s.id === id ? fn(s) : s)),
})

const start = async ($: EngineInterface, skill: GrillSkill, subject: string) => {
  const grill: Grill = { id: newId('g'), skill, subject: cut(subject, 200), startedAt: Date.now(), steps: [], isDone: false }
  await update($, book, b => ({ ...b, grills: [...b.grills, grill].slice(-GRILLS_KEPT), shown: null, expanded: [] }))
  open($)
}

// A new level takes the focus: every level drawn whole by hand folds again.
const addRound = ($: EngineInterface, round: RoundStep) =>
  update($, book, b => {
    const g = live(b)
    return g ? { ...b, grills: [...b.grills.slice(0, -1), push(g, round)], expanded: [] } : b
  })

let shownStatus: string | undefined

/** The status line while a grill is open: its level and what waits on the person; none once it closes. */
const syncStatus = async ($: EngineInterface) => {
  const g = live(await current($))
  let text: string | undefined
  if (g) {
    const rounds = g.steps.filter((s): s is RoundStep => s.kind === 'round')
    const last = rounds.at(-1)
    const step = g.steps.filter(s => s.kind === 'round' || s.kind === 'wrap').at(-1)
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

const termsIn = (text: string) => new Set([...text.matchAll(TERM)].map(m => plain(m[1] ?? '')).filter(Boolean))

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

  // The wrappers start a grill; /grilling joins the one they started, or starts its own.
  on('skill.prompt', async ($, e, next) => {
    const name = e.skill.replace(/^.*:/, '')
    // Another skill's argument (`/wayfinder <idea>`) is the subject of a grill it runs.
    const given = plain(/ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? '')
    if (!SKILLS.has(name) && given) await quietly(() => update($, book, b => ({ ...b, lastPrompt: cut(given, 200) })))
    if (SKILLS.has(name))
      await quietly(async () => {
        const args = plain(/ARGUMENTS:\s*(.*)$/m.exec(e.text)?.[1] ?? '')
        const b = await current($)
        if (name === 'grilling' && live(b)) {
          if (args) await withLive($, g => (g.subject ? g : { ...g, subject: cut(args, 200) }))
          return open($)
        }
        await start($, name as GrillSkill, args || (name === 'grilling' ? b.lastPrompt : ''))
      })
    await quietly(() => syncStatus($))
    return next(e)
  })

  // The person's reply: the answers to the waiting round, the verdict on a wrap-up, or the subject itself.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && e.text.trim())
      await quietly(() =>
        update($, book, b => {
          const text = e.text.trim()
          const out = { ...b, lastPrompt: cut(firstLine(text), 200) }
          const g = live(b)
          if (!g) return out
          const last = g.steps.filter(s => s.kind === 'round' || s.kind === 'wrap').at(-1)
          let now = g
          if (last?.kind === 'round' && last.reply === undefined) now = mapStep(g, last.id, () => applyReply(last, text))
          else if (last?.kind === 'wrap' && last.reply === undefined) {
            const isConfirmed = YES.test(text)
            now = { ...mapStep(g, last.id, () => ({ ...last, reply: text, isConfirmed })), isDone: isConfirmed }
          } else if (!last && !g.subject) now = { ...g, subject: cut(firstLine(text), 200) }
          return { ...out, grills: [...b.grills.slice(0, -1), now] }
        }),
      )
    await quietly(() => syncStatus($))
    return next(e)
  })

  // A round is a main-loop turn that ends on questions; one that ends without them, once answered, is the wrap-up.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.reason === 'answer')
      await quietly(async () => {
        const questions = parseRound(e.answer)
        const b = await current($)
        if (questions.length) {
          if (!live(b)) await start($, 'grilling', b.lastPrompt)
          await addRound($, { kind: 'round', id: newId('r'), at: Date.now(), via: 'grilling', questions })
          return open($)
        }
        const g = live(b)
        const last = g?.steps.filter(s => s.kind === 'round' || s.kind === 'wrap').at(-1)
        if (last?.kind === 'round' && last.reply !== undefined)
          await withLive($, x => push(x, { kind: 'wrap', id: newId('w'), at: Date.now(), text: cut(plain(e.answer), 600) }))
      })
    await quietly(() => syncStatus($))
    return done
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const g = live(await current($))
    if (!g) return next(e)

    // A fact the agent sends a sub-agent for: running until the sub-agent reports.
    if (e.tool === 'Agent') {
      const id = newId('l')
      await quietly(() =>
        withLive($, x =>
          push(x, { kind: 'lookup', id, at: Date.now(), label: plain(e.description), isAgent: true, count: 1, isDone: false }),
        ),
      )
      const ran = await next(e)
      await quietly(() => withLive($, x => mapStep(x, id, s => ({ ...s, isDone: true }))))
      return ran
    }

    const path = e.tool === 'Write' || e.tool === 'Edit' ? e.file_path : ''
    const isDoc = GLOSSARY.test(path) || ADR.test(path)
    const before = e.tool === 'Write' && isDoc ? await $.fs.read(path).catch(() => null) : null

    const ran = await next(e)
    if (('deny' in ran && ran.deny) || ran.isError) return ran

    if (e.tool === 'AskUserQuestion')
      await quietly(async () => {
        const answers = ((ran.result as { answers?: Record<string, string> } | undefined)?.answers ?? {}) as Record<
          string,
          string
        >
        const questions: Question[] = e.questions.map((q, i) => {
          const answer = answers[q.question]
          const recommended = q.options.find(o => /\(recommended\)/i.test(o.label))?.label ?? ''
          return {
            n: String(i + 1),
            title: plain(q.question),
            body: '',
            options: q.options.map(o => o.label),
            recommended,
            ...(answer ? { answer, isAccepted: answer === recommended && !!recommended } : {}),
          }
        })
        const response = (ran.result as { response?: string } | undefined)?.response
        await addRound($, {
          kind: 'round',
          id: newId('r'),
          at: Date.now(),
          via: 'dialog',
          questions,
          reply: response ?? Object.values(answers).join(', '),
        })
        await syncStatus($)
      })

    // Reads and searches between rounds fold into one lookup.
    const target =
      e.tool === 'Read'
        ? base(e.file_path)
        : SEARCHES.has(e.tool)
          ? String((e as { pattern?: unknown }).pattern ?? e.tool)
          : e.tool === 'WebFetch'
            ? (/^https?:\/\/([^/]+)/.exec(e.url)?.[1] ?? e.url)
            : e.tool === 'WebSearch'
              ? e.query
              : e.tool === 'Bash' && SHELL_LOOKUP.test(e.command)
                ? firstLine(e.command)
                : null
    if (target !== null)
      await quietly(() =>
        withLive($, x => {
          const last = x.steps.at(-1)
          const label = cut(target, 60)
          return last?.kind === 'lookup' && !last.isAgent
            ? mapStep(x, last.id, s => (s.kind === 'lookup' ? { ...s, count: s.count + 1, label } : s))
            : push(x, { kind: 'lookup', id: newId('l'), at: Date.now(), label, isAgent: false, count: 1, isDone: true })
        }),
      )

    // grill-with-docs: the glossary's resolved terms and the ADRs, as they are written.
    if (isDoc && (e.tool === 'Write' || e.tool === 'Edit'))
      await quietly(async () => {
        const written = e.tool === 'Write' ? e.content : e.new_string
        const adr = ADR.exec(path)
        if (adr) {
          const slug = (adr[2] ?? '').replace(/[-_]+/g, ' ')
          const title = plain(/^#[ \t]+(.+)$/m.exec(written)?.[1] ?? slug)
          const isUpdate = e.tool === 'Edit' || before !== null
          return withLive($, x =>
            push(x, { kind: 'adr', id: newId('a'), at: Date.now(), file: path, number: adr[1] ?? '', title, isUpdate }),
          )
        }
        const had = termsIn(e.tool === 'Write' ? (before ?? '') : e.old_string)
        const terms = [...termsIn(written)].filter(t => !had.has(t))
        await withLive($, x => {
          const last = x.steps.at(-1)
          return last?.kind === 'term' && last.file === path
            ? mapStep(x, last.id, s => (s.kind === 'term' ? { ...s, terms: [...new Set([...s.terms, ...terms])] } : s))
            : push(x, { kind: 'term', id: newId('t'), at: Date.now(), file: path, terms })
        })
      })

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b = await current($)
    const now = Date.now()
    const inner = Math.max(24, e.props.bodyColumns - 4)
    const g = b.grills.find(x => x.id === b.shown) ?? b.grills.at(-1)

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
    /** One row of the spine: what it hangs from on the left, a note on the right. */
    const row = (key: string, lead: RenderChildren, body: RenderChildren, right?: RenderChildren) => (
      <Box key={key} flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            {lead}
            {body}
          </Text>
        </Box>
        {right !== undefined && (
          <Box flexShrink={0} marginLeft={1}>
            {right}
          </Box>
        )}
      </Box>
    )
    const spine = (rest = '') => <Text color={EDGE}>┃ {rest}</Text>

    if (!g)
      return card(
        'empty',
        <Box flexDirection="column">
          {heading('grill map')}
          <Text dimColor wrap="wrap">
            /grill-me, /grill-with-docs or /grilling draws its design tree here, one level per round.
          </Text>
        </Box>,
      )

    const rounds = g.steps.filter((s): s is RoundStep => s.kind === 'round')
    const all = rounds.flatMap(r => r.questions.map(q => markOf(q, r)))
    const count = (m: Mark) => all.filter(x => x === m).length
    const settled = all.length - count('open')
    const terms = g.steps.reduce((n, s) => n + (s.kind === 'term' ? s.terms.length : 0), 0)
    const adrs = g.steps.filter(s => s.kind === 'adr').length
    const lookups = g.steps.reduce((n, s) => n + (s.kind === 'lookup' ? s.count : 0), 0)
    const lastRound = rounds.at(-1)
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

    // ── The spine: the design tree top to bottom, one level per round ──
    const lines: RenderChildren[] = []
    const room = Math.max(12, inner - 4)
    const toggle = (id: string) =>
      update($, book, x => ({
        ...x,
        expanded: x.expanded.includes(id) ? x.expanded.filter(k => k !== id) : [...x.expanded, id],
      }))

    lines.push(
      row(
        'start',
        <Text color={VIOLET}>◎ </Text>,
        <Text dimColor>started</Text>,
        <Text dimColor>{since(g.startedAt, now)} ago</Text>,
      ),
    )

    let level = 0
    for (const s of g.steps) {
      if (s.kind === 'lookup') {
        lines.push(
          row(
            s.id,
            spine(),
            <Text dimColor>
              <Text color={FOG}>⌕ </Text>
              {s.isAgent ? `agent · ${s.label}` : `${s.count} ${s.count === 1 ? 'lookup' : 'lookups'} · ${s.label}`}
            </Text>,
            s.isAgent ? s.isDone ? <Text dimColor>done</Text> : <Text color={AMBER}>running</Text> : undefined,
          ),
        )
        continue
      }
      if (s.kind === 'term') {
        lines.push(
          row(
            s.id,
            spine(),
            <Text>
              <Text color={TEAL}>≡ </Text>
              <Text dimColor>{base(s.file)} · </Text>
              {s.terms.length ? s.terms.join(', ') : <Text dimColor>updated</Text>}
            </Text>,
          ),
        )
        continue
      }
      if (s.kind === 'adr') {
        lines.push(
          row(
            s.id,
            spine(),
            <Text>
              <Text color={BLUE}>⚑ </Text>
              <Text dimColor>ADR {s.number} · </Text>
              {s.title}
            </Text>,
            s.isUpdate ? <Text dimColor>updated</Text> : undefined,
          ),
        )
        continue
      }
      if (s.kind === 'wrap') {
        const color = s.isConfirmed ? GREEN : s.reply !== undefined ? FOG : AMBER
        const label = s.isConfirmed
          ? 'shared understanding confirmed'
          : s.reply !== undefined
            ? 'wrap-up, pushed back'
            : 'wrap-up · confirm the shared understanding'
        lines.push(row(`${s.id}-gap`, spine(), ''))
        lines.push(
          row(
            s.id,
            <Text color={color}>{s.isConfirmed ? '◉ ' : '◎ '}</Text>,
            <Text bold>{label}</Text>,
            <Text dimColor>{since(s.at, now)}</Text>,
          ),
        )
        const isLast = s === g.steps.at(-1)
        wrapLines(s.text, room, s.reply !== undefined ? 1 : 4).forEach((l, i) =>
          lines.push(row(`${s.id}-t${i}`, isLast ? <Text>{'  '}</Text> : spine(), <Text dimColor>{l}</Text>)),
        )
        if (s.reply !== undefined && !s.isConfirmed)
          lines.push(
            row(`${s.id}-reply`, isLast ? <Text>{'  '}</Text> : spine(), <Text>
              <Text color={ACCENT}>✎ </Text>
              {s.reply}
            </Text>),
          )
        continue
      }

      // A round: a level of the tree, its questions hanging from the spine.
      level += 1
      const r = s
      const isNewest = r === lastRound
      const isOpen = b.isAllExpanded || isNewest !== b.expanded.includes(r.id)
      const waiting = isNewest && isWaiting(r) && !g.isDone
      const marks = r.questions.map(q => markOf(q, r))
      const done = marks.filter(m => m !== 'open').length
      const digit = level <= 9 ? String(level) : undefined
      lines.push(row(`${r.id}-gap`, spine(), ''))
      lines.push(
        <Box key={r.id} flexDirection="row" justifyContent="space-between">
          <Box flexShrink={1}>
            <Button key={`level-${level}`} plain {...(digit ? { hotkey: digit } : {})} onPress={() => toggle(r.id)}>
              <Text wrap="truncate-end">
                <Text color={waiting ? AMBER : done === marks.length ? GREEN : FOG}>{waiting ? '◆ ' : '● '}</Text>
                <Text bold>L{level}</Text>
                <Text dimColor>
                  {' · '}
                  {r.via === 'dialog' ? 'dialog · ' : ''}
                  {waiting ? '' : `${done}/${marks.length} settled`}
                </Text>
                {waiting ? <Text color={AMBER}>waiting for you</Text> : ''}
                <Text color={EDGE}>{isOpen ? ' ▾' : ' ▸'}</Text>
              </Text>
            </Button>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text dimColor>{since(r.at, now)}</Text>
          </Box>
        </Box>,
      )

      r.questions.forEach((q, qi) => {
        const m = marks[qi] ?? 'open'
        const key = `${r.id}-${q.n}-${qi}`
        const sign = <Text color={MARK_COLOR[m]}>{MARK[m]} </Text>
        if (!isOpen) {
          const said =
            m === 'took'
              ? q.recommended || q.answer || ''
              : m === 'own'
                ? (q.answer ?? '')
                : m === 'replied'
                  ? 'in the reply'
                  : q.recommended
                    ? `➡ ${q.recommended}`
                    : ''
          lines.push(
            row(key, spine(), <Text>
              {sign}
              <Text bold={m === 'open'}>{q.title}</Text>
              {said ? <Text dimColor> → {said}</Text> : ''}
            </Text>),
          )
          return
        }
        const sub = (k: string, body: RenderChildren) => lines.push(row(`${key}-${k}`, spine('│ '), body))
        lines.push(
          row(key, spine(), <Text>
            {sign}
            <Text dimColor>Q{q.n} </Text>
            <Text bold>{q.title}</Text>
          </Text>),
        )
        wrapLines(q.body, room - 2, 4).forEach((l, i) => sub(`b${i}`, <Text dimColor>{l}</Text>))
        q.options.forEach((o, oi) => {
          const isChosen = q.answer !== undefined && (q.answer === o || q.answer.split(/,\s*/).includes(o))
          sub(
            `o${oi}`,
            <Text dimColor={!isChosen} bold={isChosen}>
              <Text color={isChosen ? GREEN : EDGE}>{isChosen ? '● ' : '○ '}</Text>
              {o}
            </Text>,
          )
        })
        if (q.recommended)
          wrapLines(q.recommended, room - 4, 3).forEach((l, i) =>
            sub(
              `rec${i}`,
              <Text bold={m === 'took'} dimColor={m === 'own'}>
                <Text color={AMBER}>{i ? '  ' : '➡ '}</Text>
                {l}
                {m === 'took' && i === 0 ? <Text color={GREEN}> ✓</Text> : ''}
              </Text>,
            ),
          )
        if (m === 'own' && q.answer !== undefined && !(r.via === 'dialog' && q.options.includes(q.answer)))
          wrapLines(q.answer, room - 4, 3).forEach((l, i) =>
            sub(
              `ans${i}`,
              <Text bold>
                <Text color={ACCENT}>{i ? '  ' : '✎ '}</Text>
                {l}
              </Text>,
            ),
          )
      })
      if (r.reply !== undefined && marks.includes('replied'))
        wrapLines(r.reply, room - 2, isOpen ? 4 : 1).forEach((l, i) =>
          lines.push(
            row(`${r.id}-reply${i}`, spine(), <Text dimColor italic>
              {i ? '  ' : '⏎ '}
              {l}
            </Text>),
          ),
        )
    }

    // Where the tree goes from here.
    const last = g.steps.at(-1)
    const openCount = lastRound ? lastRound.questions.filter(q => markOf(q, lastRound) === 'open').length : 0
    const tail = g.isDone
      ? null
      : last?.kind === 'wrap' && last.reply === undefined
        ? null
        : lastRound && isWaiting(lastRound)
          ? { color: AMBER, text: `${openCount} open · reply by number, 1. yes  2. …` }
          : last?.kind === 'lookup' && last.isAgent && !last.isDone
            ? { color: FOG, text: 'looking up a fact…' }
            : rounds.length
              ? { color: FOG, text: 'the next frontier…' }
              : { color: FOG, text: 'the first round…' }
    if (tail) {
      lines.push(row('tail-gap', spine(), ''))
      lines.push(row('tail', <Text color={tail.color}>▼ </Text>, <Text color={tail.color}>{tail.text}</Text>))
    }

    const tree = card(
      'tree',
      <Box flexDirection="column">
        {heading(
          'design tree',
          <Text dimColor>
            {rounds.length} level{rounds.length === 1 ? '' : 's'}
          </Text>,
        )}
        {lines}
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
        {head}
        {tree}
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            <Button
              key="expand"
              label={b.isAllExpanded ? 'Fold' : 'Unfold'}
              hotkey="a"
              onPress={() => update($, book, x => ({ ...x, isAllExpanded: !x.isAllExpanded, expanded: [] }))}
            />
            {b.grills.length > 1 && <Button key="prev" label="Prev" hotkey="p" onPress={() => pick(-1)} />}
            {b.grills.length > 1 && <Button key="next" label="Next" hotkey="n" onPress={() => pick(1)} />}
            <Button key="clear" label="Clear" hotkey="c" onPress={async () => {
                await update($, book, x => ({ ...EMPTY, lastPrompt: x.lastPrompt }))
                await syncStatus($)
              }} />
          </Box>
          {rounds.length > 0 && <Text dimColor>1–{Math.min(9, rounds.length)} folds a level</Text>}
        </Box>
      </Box>
    )
  })
}
