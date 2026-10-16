// The Spine: what a grilling session leaves, top to bottom, and how it is drawn.
// Shared by grill-map and wayfinder-map, one identical copy in each; scripts/check.sh fails when they differ.

import type { BoxProps, ButtonProps, ElementConstructor, RenderChildren, TextProps } from 'claude-code'

import type { AdrStep, LookupStep, RoundStep, Step, TermStep } from '../types'
import { isWaiting, markOf } from './reply'
import type { Mark } from './reply'

// ── Traces: what a tool call leaves on the Spine ──

const GLOSSARY = /(?:^|\/)(?:CONTEXT|GLOSSARY)\.md$/
const ADR = /(?:^|\/)docs\/adr\/(\d+)-([^/]+)\.md$/
const TERM = /^\s*\*\*([^*\n]+?)\*\*\s*:/gm
// Search tools a build may or may not ship; where it has none, the shell's searches count instead.
const SEARCHES = new Set<string>(['Grep', 'Glob'])
const SHELL_LOOKUP = /^\s*(rg|grep|cat|ls|find|head|tail|tree|sed -n|git (?:log|show|diff|grep|blame))\b/

const plainText = (text: string) =>
  text
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/** What a read or a search looked at, or null for a call that looks nothing up. */
export const lookupOf = (tool: string, input: Record<string, unknown>): string | null => {
  const text = (key: string) => String(input[key] ?? '')
  if (tool === 'Read') return base(text('file_path'))
  if (SEARCHES.has(tool)) return String(input['pattern'] ?? tool)
  if (tool === 'WebFetch') return /^https?:\/\/([^/]+)/.exec(text('url'))?.[1] ?? text('url')
  if (tool === 'WebSearch') return text('query')
  if (tool === 'Bash' && SHELL_LOOKUP.test(text('command')))
    return text('command').split('\n').find(line => line.trim())?.trim() ?? null
  return null
}

/** Whether a `Write` or `Edit` of this path is a glossary or an ADR. */
export const isDocPath = (path: string) => GLOSSARY.test(path) || ADR.test(path)

const termsIn = (text: string) => new Set([...text.matchAll(TERM)].map(m => plainText(m[1] ?? '')).filter(Boolean))

/**
 * The Trace a glossary or ADR write leaves: the ADR, or the terms the write added.
 * `previous` is the file before a `Write` (null when new), or the `old_string` an `Edit` replaced.
 */
export const docTraceOf = (
  path: string,
  written: string,
  previous: string | null,
  isEdit: boolean,
  id: string,
  at: number,
): AdrStep | TermStep | null => {
  const adr = ADR.exec(path)
  if (adr) {
    const slug = (adr[2] ?? '').replace(/[-_]+/g, ' ')
    const title = plainText(/^#[ \t]+(.+)$/m.exec(written)?.[1] ?? slug)
    return { kind: 'adr', id, at, file: path, number: adr[1] ?? '', title, isUpdate: isEdit || previous !== null }
  }
  if (!GLOSSARY.test(path)) return null
  const had = termsIn(previous ?? '')
  return { kind: 'term', id, at, file: path, terms: [...termsIn(written)].filter(t => !had.has(t)) }
}

/** A read folds into the lookup just before it; a sub-agent never does. */
export const foldsInto = (last: Step | undefined): last is LookupStep => last?.kind === 'lookup' && !last.isAgent

/** Terms written to the file the last Trace wrote fold into it. */
export const termsFoldInto = (last: Step | undefined, path: string): last is TermStep =>
  last?.kind === 'term' && last.file === path

// ── Drawing ──

// The modsbook palette.
export const EDGE = '#4a4a4a'
export const ACCENT = '#d97757'
export const FOG = '#8a93a6'
export const GREEN = '#5ccf9f'
export const AMBER = '#e2b867'
const VIOLET = '#b79cf5'
export const TEAL = '#6fd3c8'
export const BLUE = '#7fb4f5'

export const MARK: Record<Mark, string> = { took: '✓', own: '✎', replied: '⏎', open: '◌' }
export const MARK_COLOR: Record<Mark, string> = { took: GREEN, own: ACCENT, replied: FOG, open: AMBER }

export const since = (from: number, to = Date.now()) => {
  const s = Math.max(0, Math.round((to - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}
export const cut = (text: string, room: number) => (text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text)
export const base = (path: string) => path.split('/').pop() ?? path

/** Words laid into lines of `width`, at most `max` of them, the last cut with `…`. */
export const wrapLines = (text: string, width: number, max: number): string[] => {
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

/** The elements a Spine is drawn with, from `$.ui.resolve(e)` on any surface. */
export type SpineElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type SpineView = {
  steps: Step[]
  /** Put before each Level heading's key, so two Spines in one pane press apart. */
  keyPrefix: string
  /** A closed ticket, or a grill whose Wrap-up is confirmed: every Level folded. */
  isClosed: boolean
  /** Lines still arrive here: the tail says what the Spine waits for. */
  isLive: boolean
  isAllUnfolded: boolean
  /** Levels a press turned from how they are drawn by default. */
  turned: string[]
  onTurn: (id: string) => unknown
  /** Cells across. */
  width: number
  now: number
  /** Draws a `started` row first. */
  startedAt?: number
}

const rounds = (steps: Step[]) => steps.filter((s): s is RoundStep => s.kind === 'round')

/** The open questions of the newest Level. */
export const openCount = (steps: Step[]) => {
  const last = rounds(steps).at(-1)
  return last ? last.questions.filter(q => markOf(q, last) === 'open').length : 0
}

/** `Spine` with its count of Levels, and of open questions where the Spine is not closed. */
export const spineHeading = (el: SpineElements, title: string, steps: Step[], isClosed: boolean) => {
  const { Box, Text } = el
  const levels = rounds(steps).length
  const open = isClosed ? 0 : openCount(steps)
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text bold>{title}</Text>
      <Text dimColor>
        {levels} level{levels === 1 ? '' : 's'}
        {open ? ` · ${open} open` : ''}
      </Text>
    </Box>
  )
}

/** `a`: every Level of every Spine in the pane whole, or back to how each is drawn by default. */
export const foldAllButton = (el: SpineElements, isAllUnfolded: boolean, onPress: () => unknown) => {
  const { Button } = el
  return <Button key="fold-all" label={isAllUnfolded ? 'Fold' : 'Unfold'} hotkey="a" onPress={onPress} />
}

/** The Spine's rows: each Level hanging from it, the Traces between, the Wrap-up where it closes. */
export const spineRows = (el: SpineElements, v: SpineView): RenderChildren[] => {
  const { Box, Text, Button } = el
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
  const lines: RenderChildren[] = []
  const room = Math.max(12, v.width - 4)
  const all = rounds(v.steps)
  const lastRound = all.at(-1)

  if (v.startedAt !== undefined)
    lines.push(
      row(
        'start',
        <Text color={VIOLET}>◎ </Text>,
        <Text dimColor>started</Text>,
        <Text dimColor>{since(v.startedAt, v.now)} ago</Text>,
      ),
    )

  let level = 0
  for (const s of v.steps) {
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
          <Text dimColor>{since(s.at, v.now)}</Text>,
        ),
      )
      const isLast = s === v.steps.at(-1)
      wrapLines(s.text, room, s.reply !== undefined || v.isClosed ? 1 : 4).forEach((l, i) =>
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

    // A Level: its questions hanging from the spine; the newest drawn whole, unless the Spine is closed.
    level += 1
    const r = s
    const isNewest = r === lastRound
    const isWhole = isNewest && !v.isClosed
    const isOpen = v.isAllUnfolded || isWhole !== v.turned.includes(r.id)
    const waiting = isNewest && v.isLive && isWaiting(r)
    const marks = r.questions.map(q => markOf(q, r))
    const done = marks.filter(m => m !== 'open').length
    lines.push(row(`${r.id}-gap`, spine(), ''))
    lines.push(
      <Box key={r.id} flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>
          <Button key={`${v.keyPrefix}level-${level}`} plain onPress={() => v.onTurn(r.id)}>
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
          <Text dimColor>{since(r.at, v.now)}</Text>
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

  // Where the Spine goes from here, while lines still arrive.
  if (!v.isLive || v.isClosed) return lines
  const last = v.steps.at(-1)
  const left = openCount(v.steps)
  const tail =
    last?.kind === 'wrap' && last.reply === undefined
      ? null
      : last?.kind === 'wrap' && last.isConfirmed
        ? null
        : lastRound && isWaiting(lastRound)
          ? { color: AMBER, text: `${left} open · reply by number, 1. yes  2. …` }
          : last?.kind === 'lookup' && last.isAgent && !last.isDone
            ? { color: FOG, text: 'looking up a fact…' }
            : all.length
              ? { color: FOG, text: 'the next frontier…' }
              : { color: FOG, text: 'the first round…' }
  if (tail) {
    lines.push(row('tail-gap', spine(), ''))
    lines.push(row('tail', <Text color={tail.color}>▼ </Text>, <Text color={tail.color}>{tail.text}</Text>))
  }
  return lines
}
