import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'wayfinder-map',
  props: {
    title: 'Wayfinder',
    isFocused: false,
    bodyColumns: 76,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const DIR = '/repo/.scratch/sync'
const MAP = `# Offline sync

## Destination

A spec for offline sync.

## Decisions so far

## Not yet specified
`
const ticket = (title: string, status: string, extra = '') =>
  `# ${title}\n\nType: grilling\nStatus: ${status}\n${extra}\n## Question\n\n${title}?\n`

const STORAGE = `${DIR}/issues/01-storage.md`
const LOG = `${DIR}/issues/02-log.md`

const CHARTING_ROUND = '❓ **Q1** - **Scope**: Is the sync log in scope?\n\n➡️ Yes, the log is in scope'
const ROUND = [
  '❓ **Q1** - **Storage**: Where do rows live?',
  '- SQLite',
  '- Postgres',
  '',
  '➡️ SQLite, with WAL',
  '',
  '---',
  '',
  '❓ **Q2** - **Sync trigger**: When does a device sync?',
  '',
  '➡️ On every write',
].join('\n')

/** A local map whose files the tool calls change, a store the test reads, the status line kept. */
const stubs = (on: On) => {
  const files: Record<string, string> = {
    [`${DIR}/map.md`]: MAP,
    [STORAGE]: ticket('Pick the storage engine', 'open'),
    [LOG]: ticket('Shape of the sync log', 'open', 'Blocked by: 01\n'),
  }
  const store = new Map<string, unknown>()
  const statuses: (string | undefined)[] = []
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', (_$, e) =>
    e.path === `${DIR}/issues`
      ? {
          value: Object.keys(files)
            .filter(p => p.startsWith(`${DIR}/issues/`))
            .map(p => ({ name: p.split('/').pop() ?? p, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })),
        }
      : { value: [] },
  )
  on('tool.call', (_$, e) => {
    if (e.tool === 'Write') files[e.file_path] = e.content
    if (e.tool === 'Bash') {
      const sed = /s\/Status: open\/Status: claimed\/' (\S+)/.exec(e.command)
      const path = sed?.[1]
      if (path && files[path]) files[path] = files[path].replace('Status: open', 'Status: claimed')
    }
    return { result: { type: 'text', text: '' } as never }
  })
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return { files, store, statuses }
}

const turn = (answer: string, turnId: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' }) as const
const say = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const
const wayfinder = (args: string) => ({ skill: 'mattpocock-skills:wayfinder', text: `A loose idea has arrived…\n\nARGUMENTS: ${args}` })

test('a claimed ticket\'s Levels, Traces and Wrap-up sit in its card; Charting\'s in the map card', async ($, on) => {
  const { files, statuses } = stubs(on)
  await $.skill.prompt(wayfinder(DIR))
  expect(statuses.at(-1)).toBe('charting · starting')

  // Charting: the map has tickets, so the read to choose one is not kept; the Level is.
  await $.tool.call({ tool: 'Read', file_path: `${DIR}/map.md` })
  await $.turn.complete(turn(CHARTING_ROUND, 't0'))
  await $.prompt.submit(say('sì'))
  expect(statuses.at(-1)).toBe('charting · L1 · next frontier')

  // The claim: every line goes to the ticket now.
  await $.tool.call({ tool: 'Write', file_path: STORAGE, content: ticket('Pick the storage engine', 'claimed') })
  expect(statuses.at(-1)).toBe('Pick the storage engine · starting')
  await $.tool.call({ tool: 'Agent', description: 'Find the current sync code', prompt: 'Look for it.' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/db.ts' })
  await $.turn.complete(turn(ROUND, 't1'))
  expect(statuses.at(-1)).toBe('Pick the storage engine · L1 · 2 open')
  await $.prompt.submit(say('1. lgtm\n2. sì, ma ogni minuto'))
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/GLOSSARY.md',
    content: '# Sync\n\n## Language\n\n**Sync Log**:\nThe rows not yet sent.\n',
  })
  await $.turn.complete(turn('So: SQLite with WAL, a sync every minute. Is that our shared understanding?', 't2'))
  expect(statuses.at(-1)).toBe('Pick the storage engine · confirm the shared understanding')
  // A yes with a Reserve pushes the Wrap-up back; the next one closes it.
  await $.prompt.submit(say('sì, ma aggiungi i conflitti'))
  await $.turn.complete(turn('So: SQLite with WAL, a sync every minute, conflicts last-write-wins. Agreed?', 't3'))
  await $.prompt.submit(say('sì'))

  for (const surface of ['mobile', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'wayfinder-map', surface, ...PANE })
    const has = async (text: RegExp) => expect(await ui.find({ type: 'Text', text }), `${surface} ${text}`).toBeDefined()
    const hasNot = async (text: RegExp) => expect(await ui.find({ type: 'Text', text }), `${surface} ${text}`).toBeUndefined()
    expect(await ui.find({ key: 'tab-decisions' })).toBeDefined()
    expect(await ui.find({ key: 'tab-grill' }), 'the g tab is gone').toBeUndefined()

    // The map card: Charting's Spine, folded once the map has tickets.
    await has(/^Spine · charting$/)
    await has(/● L1 · 1\/1 settled ▸/)
    await has(/┃ ✓ Scope → Yes, the log is in scope/)
    await hasNot(/lookup · map\.md/)

    // The ticket card: tapped open from the tree on mobile, stepped to on the terminal.
    await ui.press({ key: surface === 'mobile' ? 'focus-1' : 'next' })
    await has(/^Question$/)
    await has(/^Spine$/)
    await has(/^1 level$/)
    await has(/┃ ⌕ agent · Find the current sync code/)
    await has(/┃ ⌕ 1 lookup · db\.ts/)
    await has(/┃ ≡ GLOSSARY\.md · Sync Log/)
    await has(/◎ wrap-up, pushed back/)
    await has(/◉ shared understanding confirmed/)
    await hasNot(/grilling round/)
    // The newest Level is whole while the ticket is open: Q1 took the recommendation, Q2 has the person's own answer.
    await has(/┃ ✓ Q1 Storage/)
    await has(/┃ │ ➡ SQLite, with WAL ✓/)
    await has(/┃ ✎ Q2 Sync trigger/)
    await has(/┃ │ ✎ sì, ma ogni minuto/)
    // A Level's heading is a Button a tap presses, with no digit.
    const level = await ui.find({ key: '1-level-1' })
    expect(level).toBeDefined()
    expect(level?.props, 'no hotkey on a Level').not.toHaveProperty('hotkey')
    await ui.press({ key: '1-level-1' })
    await has(/┃ ✎ Sync trigger → sì, ma ogni minuto/)
    await ui.press({ key: '1-level-1' })
    // `a` unfolds every Level of every Spine in the pane.
    const all = await ui.find({ key: 'fold-all' })
    expect(all?.props).toMatchObject({ label: 'Unfold', hotkey: 'a' })
    await ui.press({ key: 'fold-all' })
    await has(/┃ ✓ Q1 Scope/)
    await ui.press({ key: 'fold-all' })
    await ui.press({ key: 'unfocus' })
    await ui.unmount()
  }

  // The ticket closes: its Spine folds whole, and later lines land on Charting until the next claim.
  files[STORAGE] = ticket('Pick the storage engine', 'resolved', '\n## Answer\n\nSQLite.\n')
  await $.tool.call({ tool: 'Write', file_path: STORAGE, content: files[STORAGE] ?? '' })
  expect(statuses.at(-1)).toBe('charting · L1 · next frontier')
  await $.turn.complete(turn(CHARTING_ROUND.replace('Scope', 'Retries'), 't4'))

  const ui = await $.ui.mount({ plugin: 'wayfinder-map', surface: 'mobile', ...PANE })
  const has = async (text: RegExp) => expect(await ui.find({ type: 'Text', text }), String(text)).toBeDefined()
  // Charting is live again: a Level since the last claim, drawn whole.
  await has(/◆ L2 · waiting for you ▾/)
  await ui.press({ key: 'focus-1' })
  await has(/● L1 · 2\/2 settled ▸/)
  await has(/◉ shared understanding confirmed/)
  await ui.unmount()
})

test('a claim made from the shell is seen once the map shows it', async ($, on) => {
  const { statuses } = stubs(on)
  await $.skill.prompt(wayfinder(DIR))
  await $.tool.call({
    tool: 'Bash',
    command: `cd /repo/.scratch/sync && sed -i '' 's/Status: open/Status: claimed/' ${STORAGE}`,
  })
  expect(statuses.at(-1)).toBe('Pick the storage engine · starting')
})

test('outside a Run, a map followed by hand keeps no Spine', async ($, on) => {
  const { store, statuses } = stubs(on)
  await $.command.run({
    command: 'waymap',
    args: DIR,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  await $.turn.complete(turn(ROUND, 't1'))
  expect(store.get(`spine:local:${DIR}`)).toEqual([])
  expect(statuses.filter(s => s !== undefined)).toEqual([])
})

test('/grill-me ends the Run: the status line goes, and later rounds stay off the map', async ($, on) => {
  const { store, statuses } = stubs(on)
  await $.skill.prompt(wayfinder(DIR))
  await $.skill.prompt({ skill: 'grill-me', text: 'ARGUMENTS: Something else' })
  expect(statuses.at(-1)).toBeUndefined()
  await $.turn.complete(turn(ROUND, 't1'))
  expect(store.get(`spine:local:${DIR}`)).toEqual([])
})

test('a map kept before the Spine has its rounds moved over, once', async ($, on) => {
  const { store } = stubs(on)
  store.set(`rounds:local:${DIR}`, [
    {
      id: 'r1',
      ticket: '1',
      at: 1,
      kind: 'grilling',
      questions: [{ n: '1', title: 'Storage', recommended: 'SQLite', options: [], answer: 'yes', isAccepted: true }],
      reply: 'yes',
    },
  ])
  await $.skill.prompt(wayfinder(DIR))
  expect(store.has(`rounds:local:${DIR}`)).toBe(false)
  expect(store.get(`spine:local:${DIR}`)).toEqual([
    {
      kind: 'round',
      id: 'r1',
      at: 1,
      via: 'grilling',
      questions: [{ n: '1', title: 'Storage', recommended: 'SQLite', options: [], answer: 'yes', isAccepted: true, body: '' }],
      reply: 'yes',
      ticket: '1',
    },
  ])
})

test('past 400 lines the lookups go first, then a closed ticket\'s oldest lines; never the open ticket\'s', async ($, on) => {
  const { files, store } = stubs(on)
  const lines = () => (store.get(`spine:local:${DIR}`) ?? []) as { ticket: string | null; kind: string }[]
  const level = (n: number) => `❓ **Q1** - **Step ${n}**: Go on?\n\n➡️ Yes`
  await $.skill.prompt(wayfinder(DIR))
  await $.tool.call({ tool: 'Write', file_path: STORAGE, content: ticket('Pick the storage engine', 'claimed') })
  await $.tool.call({ tool: 'Agent', description: 'One', prompt: '.' })
  await $.tool.call({ tool: 'Agent', description: 'Two', prompt: '.' })
  await $.turn.complete(turn(level(0), 'a0'))
  files[STORAGE] = ticket('Pick the storage engine', 'resolved')
  await $.tool.call({ tool: 'Write', file_path: STORAGE, content: files[STORAGE] ?? '' })
  await $.tool.call({ tool: 'Write', file_path: LOG, content: ticket('Shape of the sync log', 'claimed', 'Blocked by: 01\n') })
  for (let n = 1; n <= 397; n++) await $.turn.complete(turn(level(n), `b${n}`))
  expect(lines()).toHaveLength(400)
  expect(lines().filter(l => l.kind === 'lookup')).toHaveLength(2)

  await $.turn.complete(turn(level(398), 'c1'))
  expect(lines()).toHaveLength(400)
  expect(lines().filter(l => l.kind === 'lookup'), 'the lookups went first').toHaveLength(1)

  await $.turn.complete(turn(level(399), 'c2'))
  await $.turn.complete(turn(level(400), 'c3'))
  expect(lines().filter(l => l.ticket === '1'), 'then the closed ticket\'s oldest lines').toHaveLength(0)
  expect(lines().filter(l => l.ticket === '2')).toHaveLength(400)
})
