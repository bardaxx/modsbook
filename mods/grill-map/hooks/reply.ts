// How a round is read from the agent's answer, and how the person's reply settles it.
// Shared by grill-map and wayfinder-map, one identical copy in each; scripts/check.sh fails when they differ.

import type { Question, RoundStep, Step, WrapStep } from '../types'

export const firstLine = (text: string) => text.split('\n').find(line => line.trim())?.trim() ?? ''
export const plain = (text: string) =>
  text
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/** `❓ **Q1** - **Title**: body … ➡ recommended`, once per question of the round. */
export const parseRound = (text: string): Question[] =>
  text
    .split(/^[ \t>]*❓️?\s*/m)
    .slice(1)
    .flatMap(chunk => {
      const head = /^\**\s*Q?(\d+)\s*\**\s*[-–—:.]?\s*(?:\*\*([^*]+)\*\*\s*:?)?\s*([\s\S]*)$/i.exec(chunk)
      if (!head) return []
      const rest = (head[3] ?? '').split(/\n\s*---/)[0] ?? ''
      const arrow = rest.search(/➡/)
      const before = arrow < 0 ? rest : rest.slice(0, arrow)
      const recommended = arrow < 0 ? '' : plain(rest.slice(arrow).replace(/^➡️?\s*/, '').split(/\n\s*\n/)[0] ?? '')
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

// ── A yes, and a Reserve ──

// A word ends where no letter or digit follows: `\b` misses one after an accented letter (`sì`).
const END = '(?=$|[^\\p{L}\\p{N}])'
const YES = new RegExp(
  `^(?:y|yes|yep|yeah|ok|okay|sure|agreed|go|lgtm|s[iì]|certo|va bene|confermo|d'accordo|perfetto|esatto|👍)${END}`,
  'iu',
)
const RESERVE = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(?:ma|però|tranne|eccetto|salvo|a parte|invece|solo se|but|except|unless|only if|however)${END}`,
  'iu',
)

/** A reply that opens with a yes, Reserve or not. */
export const isYes = (text: string) => YES.test(text.trim())

/** A yes with a Reserve after it: `sì, ma …`, `yes, unless …`. */
export const hasReserve = (text: string) => {
  const m = YES.exec(text.trim())
  return !!m && RESERVE.test(text.trim().slice(m[0].length))
}

/** A yes with no Reserve: the recommendation taken, the Wrap-up confirmed. */
export const takes = (text: string) => isYes(text) && !hasReserve(text)

// ── Settling a round ──

/** How a question stands: took the recommendation, answered otherwise, answered in an unsplit reply, or open. */
export type Mark = 'took' | 'own' | 'replied' | 'open'

export const markOf = (q: Question, r: RoundStep): Mark =>
  q.answer !== undefined ? (q.isAccepted ? 'took' : 'own') : r.reply !== undefined ? 'replied' : 'open'

export const isWaiting = (r: RoundStep) => r.reply === undefined && r.questions.some(q => q.answer === undefined)

/**
 * Hands the person's reply out to the round's questions: `1. yes`, `Q2: no, …`, or one answer for all.
 * A yes said whole to several questions answers them all, unless a Reserve follows it: the Reserve
 * cannot be pinned to one, so the reply stays unsplit.
 */
export const applyReply = (round: RoundStep, reply: string): RoundStep => {
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
  const forAll = parts.size === 0 && (round.questions.length === 1 || takes(whole)) ? whole : undefined
  return {
    ...round,
    reply: whole,
    questions: round.questions.map(q => {
      const said = parts.get(q.n) ?? forAll
      return said === undefined ? q : { ...q, answer: said, isAccepted: takes(said) }
    }),
  }
}

/** An AskUserQuestion dialog as a Level: the recommended option is the one labelled "(Recommended)". */
export const dialogRound = (
  asked: readonly { question: string; options: readonly { label: string }[] }[],
  result: unknown,
  id: string,
  at: number,
): RoundStep => {
  const { answers = {}, response } = (result ?? {}) as { answers?: Record<string, string>; response?: string }
  const questions: Question[] = asked.map((q, i) => {
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
  return { kind: 'round', id, at, via: 'dialog', questions, reply: response ?? Object.values(answers).join(', ') }
}

// ── The Wrap-up ──

/** The newest Level or Wrap-up: what the person's next reply answers. */
export const lastTurn = (steps: Step[]) =>
  steps.filter((s): s is RoundStep | WrapStep => s.kind === 'round' || s.kind === 'wrap').at(-1)

/**
 * Whether a turn that ends without questions is a Wrap-up: once the newest Level is answered,
 * or after a Wrap-up the person pushed back on.
 */
export const isWrapDue = (steps: Step[]) => {
  const last = lastTurn(steps)
  if (last?.kind === 'round') return last.reply !== undefined
  return last?.kind === 'wrap' && last.reply !== undefined && !last.isConfirmed
}

/** The person's word on a Wrap-up: a yes with no Reserve confirms it. */
export const settleWrap = (wrap: WrapStep, reply: string): WrapStep => ({ ...wrap, reply, isConfirmed: takes(reply) })
