import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'grill-map',
  props: {
    title: 'Grill',
    isFocused: false,
    bodyColumns: 64,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const ROUND_ONE = [
  'Two things first.',
  '',
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

const ROUND_TWO = [
  '❓ **Q3** - **Conflicts**: Where does a conflict surface to the person, if anywhere at all?',
  '',
  '➡️ Last write wins, with a banner',
].join('\n')

const stubs = (on: On) => {
  const statuses: (string | undefined)[] = []
  mock.store(on)
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  return statuses
}

const turn = (answer: string, turnId: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' }) as const
const say = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

test('a /grill-me round hangs from the spine, the next level waits for the person', async ($, on) => {
  const statuses = stubs(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-me', text: 'Run a `/grilling` session.\n\nARGUMENTS: Offline sync' })
  await $.skill.prompt({ skill: 'mattpocock-skills:grilling', text: 'Interview the user relentlessly…' })
  await $.turn.complete(turn(ROUND_ONE, 't1'))
  await $.prompt.submit(say('1. yes\n2. no, every minute'))
  await $.turn.complete(turn(ROUND_TWO, 't2'))
  expect(statuses.at(-1)).toBe('grill L2 · 1 open')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'grill-map', surface, ...PANE })
    const has = async (text: RegExp) => expect(await ui.find({ text }), String(text)).toBeDefined()
    const hasNot = async (text: RegExp) => expect(await ui.find({ text }), String(text)).toBeUndefined()
    await has(/◆ grill-me/)
    await has(/^Offline sync$/)
    await has(/^ 2\/3 $/)
    await has(/✓ took 1/)
    await has(/✎ yours 1/)
    await has(/◌ open 1/)
    await has(/2 levels/)

    // The settled level folds to one line per decision.
    await has(/● L1 · 2\/2 settled ▸/)
    await has(/┃ ✓ Storage → SQLite, with WAL/)
    await has(/┃ ✎ Sync trigger → no, every minute/)

    // The newest level is drawn whole.
    await has(/◆ L2 · waiting for you ▾/)
    await has(/┃ ◌ Q3 Conflicts/)
    await has(/┃ │ Where does a conflict surface/)
    await has(/┃ │ ➡ Last write wins, with a banner/)
    await has(/▼ 1 open · reply by number/)

    // A press on its heading unfolds a level.
    await ui.press({ key: 'level-1' })
    await has(/● L1 · 2\/2 settled ▾/)
    await has(/┃ │ ○ SQLite/)
    await has(/┃ │ ➡ SQLite, with WAL ✓/)
    await has(/┃ │ ✎ no, every minute/)
    await ui.press({ key: 'level-1' })
    await hasNot(/┃ │ ○ SQLite/)
    await ui.unmount()
  }
})

test('grill-with-docs: lookups, glossary terms and ADRs sit on the spine, and the wrap-up closes it', async ($, on) => {
  const statuses = stubs(on)
  on('fs.read', (_$, e) => {
    if (e.path === '/repo/CONTEXT.md') return { value: '# Sync\n\n## Language\n\n**Device**:\nA phone.\n' }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('tool.call', () => ({ result: { type: 'text', text: '' } as never }))

  await $.skill.prompt({ skill: 'grill-with-docs', text: 'Run a `/grilling` session, using the `/domain-modeling` skill.' })
  await $.prompt.submit(say('The offline sync for the field app'))
  await $.tool.call({ tool: 'Agent', description: 'Find the current sync code', prompt: 'Look for it.' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/sync.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/queue.ts' })
  await $.turn.complete(turn(ROUND_ONE, 't1'))
  await $.prompt.submit(say('yes to all'))
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/CONTEXT.md',
    content: '# Sync\n\n## Language\n\n**Device**:\nA phone.\n\n**Sync Log**:\nThe rows not yet sent.\n',
  })
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/docs/adr/0001-sqlite-on-device.md',
    content: '# SQLite on the device\n\nWe keep rows in SQLite with WAL.',
  })
  await $.turn.complete(turn('So: rows live in SQLite with WAL and every write syncs. Is that our shared understanding?', 't2'))

  const ui = await $.ui.mount({ plugin: 'grill-map', surface: 'terminal', ...PANE })
  const has = async (text: RegExp) => expect(await ui.find({ text }), String(text)).toBeDefined()
  await has(/◆ grill-with-docs/)
  await has(/^The offline sync for the field app$/)
  await has(/┃ ⌕ agent · Find the current sync code/)
  await has(/^done$/)
  await has(/┃ ⌕ 2 lookups · queue\.ts/)
  await has(/┃ ≡ CONTEXT\.md · Sync Log$/)
  await has(/┃ ⚑ ADR 0001 · SQLite on the device/)
  await has(/◎ wrap-up · confirm the shared understanding/)
  await has(/So: rows live in SQLite/)
  await has(/≡ terms 1/)
  await has(/⚑ ADRs 1/)
  expect(statuses.at(-1)).toBe('grill · confirm the shared understanding')

  await $.prompt.submit(say('yes'))
  await has(/◉ shared understanding confirmed/)
  await has(/^ done $/)
  expect(statuses.at(-1), 'the status line goes once the grill closes').toBeUndefined()
  await ui.unmount()
})

test('a grill another skill runs takes that skill\'s argument as its subject', async ($, on) => {
  stubs(on)
  await $.prompt.submit(say('ok, confirmed'))
  await $.skill.prompt({ skill: 'mattpocock-skills:wayfinder', text: 'A loose idea has arrived…\n\nARGUMENTS: Offline sync for the field app' })
  await $.skill.prompt({ skill: 'mattpocock-skills:grilling', text: 'Interview the user relentlessly…' })
  const ui = await $.ui.mount({ plugin: 'grill-map', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Offline sync for the field app$/ })).toBeDefined()
  await ui.unmount()
})

test('a round in the grilling format starts a grill by itself, subject the last prompt', async ($, on) => {
  stubs(on)
  await $.prompt.submit(say('Grill me on the billing rewrite'))
  await $.turn.complete(turn(ROUND_TWO, 't1'))
  const ui = await $.ui.mount({ plugin: 'grill-map', surface: 'terminal', ...PANE })
  const has = async (text: RegExp) => expect(await ui.find({ text }), String(text)).toBeDefined()
  await has(/◆ grilling/)
  await has(/^Grill me on the billing rewrite$/)
  await has(/◆ L1 · waiting for you/)
  await ui.unmount()
})

test('a new level takes the focus: the levels before it fold, even one unfolded by hand', async ($, on) => {
  stubs(on)
  await $.skill.prompt({ skill: 'grill-me', text: 'ARGUMENTS: Offline sync' })
  await $.turn.complete(turn(ROUND_ONE, 't1'))
  const ui = await $.ui.mount({ plugin: 'grill-map', surface: 'terminal', ...PANE })
  const has = async (text: RegExp) => expect(await ui.find({ text }), String(text)).toBeDefined()
  await has(/◆ L1 · waiting for you ▾/)

  await $.prompt.submit(say('yes'))
  await $.turn.complete(turn(ROUND_TWO, 't2'))
  await has(/● L1 · 2\/2 settled ▸/)
  await ui.press({ key: 'level-1' })
  await has(/● L1 · 2\/2 settled ▾/)

  await $.prompt.submit(say('no, it never surfaces'))
  await $.turn.complete(turn(ROUND_TWO.replace('Q3', 'Q4').replace('Conflicts', 'Retries'), 't3'))
  await has(/● L1 · 2\/2 settled ▸/)
  await has(/● L2 · 1\/1 settled ▸/)
  await has(/◆ L3 · waiting for you ▾/)
  await ui.unmount()
})
