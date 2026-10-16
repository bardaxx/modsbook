import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'grill-map',
  props: {
    title: 'Grill',
    isFocused: false,
    bodyColumns: 72,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const TWO = [
  '❓ **Q1** - **Storage**: Where do rows live?',
  '',
  '➡️ SQLite, with WAL',
  '',
  '---',
  '',
  '❓ **Q2** - **Sync trigger**: When does a device sync?',
  '',
  '➡️ On every write',
].join('\n')
const ONE = '❓ **Q1** - **Conflicts**: Where does a conflict surface?\n\n➡️ Last write wins, with a banner'

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

const cases: [string, string, string[]][] = [
  // A plain yes takes the recommendation, `sì` with its accent and `lgtm` included.
  [TWO, 'sì a tutte', ['✓ took 2']],
  [TWO, 'lgtm', ['✓ took 2']],
  [ONE, 'sì, facciamolo', ['✓ took 1']],
  // A yes with a Reserve, said to one question, is the person's own answer.
  [ONE, 'sì, ma più tardi', ['✎ yours 1']],
  [TWO, '1. yes\n2. sì, però ogni minuto', ['✓ took 1', '✎ yours 1']],
  [TWO, '1. ok\n2. yes, unless the device is offline', ['✓ took 1', '✎ yours 1']],
  // Said whole to several questions, the Reserve cannot be pinned to one: the reply stays unsplit.
  [TWO, 'sì a tutte, ma la seconda no', ['⏎ in reply 2']],
  [TWO, 'yes to all, but not every write', ['⏎ in reply 2']],
  // A Reserve is a whole word: `mai` is not `ma`.
  [ONE, 'sì, mai più dubbi', ['✓ took 1']],
]

for (const [round, reply, legend] of cases)
  test(`"${reply.replace(/\n/g, ' / ')}" reads as ${legend.join(', ')}`, async ($, on) => {
    stubs(on)
    await $.skill.prompt({ skill: 'grill-me', text: 'ARGUMENTS: Offline sync' })
    await $.turn.complete(turn(round, 't1'))
    await $.prompt.submit(say(reply))
    const ui = await $.ui.mount({ plugin: 'grill-map', surface: 'terminal', ...PANE })
    const drawn = (await ui.findAll({ type: 'Text', text: /^(✓ took|✎ yours|⏎ in reply|◌ open) \d+$/ })).map(t => t.text)
    expect(drawn).toEqual(legend)
    await ui.unmount()
  })

test('a yes with a Reserve pushes the Wrap-up back; the next Wrap-up closes the grill', async ($, on) => {
  const statuses = stubs(on)
  await $.skill.prompt({ skill: 'grill-me', text: 'ARGUMENTS: Offline sync' })
  await $.turn.complete(turn(ONE, 't1'))
  await $.prompt.submit(say('yes'))
  await $.turn.complete(turn('So: last write wins, with a banner. Is that our shared understanding?', 't2'))
  expect(statuses.at(-1)).toBe('grill · confirm the shared understanding')

  await $.prompt.submit(say('sì, ma aggiungi i retry'))
  const ui = await $.ui.mount({ plugin: 'grill-map', surface: 'terminal', ...PANE })
  const has = async (text: RegExp) => expect(await ui.find({ text }), String(text)).toBeDefined()
  await has(/◎ wrap-up, pushed back/)
  expect(await ui.find({ type: 'Text', text: /^ done $/ }), 'still open').toBeUndefined()

  await $.turn.complete(turn('So: last write wins with a banner, and three retries. Agreed?', 't3'))
  expect(statuses.at(-1)).toBe('grill · confirm the shared understanding')
  await $.prompt.submit(say('sì'))
  await has(/◉ shared understanding confirmed/)
  await has(/^ done $/)
  expect(statuses.at(-1)).toBeUndefined()
  await ui.unmount()
})

test('a Level folds by a press on its heading, never by a digit; `a` is a labelled Button', async ($, on) => {
  stubs(on)
  await $.skill.prompt({ skill: 'grill-me', text: 'ARGUMENTS: Offline sync' })
  await $.turn.complete(turn(TWO, 't1'))
  await $.prompt.submit(say('yes'))
  await $.turn.complete(turn(ONE, 't2'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'grill-map', surface, ...PANE })
    for (const key of ['level-1', 'level-2']) {
      const level = await ui.find({ key })
      expect(level, key).toBeDefined()
      expect(level?.props, key).not.toHaveProperty('hotkey')
    }
    expect((await ui.find({ key: 'fold-all' }))?.props).toMatchObject({ label: 'Unfold', hotkey: 'a' })
    expect(await ui.find({ type: 'Text', text: /folds a level/ }), 'no digit hint').toBeUndefined()
    await ui.press({ key: 'fold-all' })
    expect((await ui.find({ key: 'fold-all' }))?.props).toMatchObject({ label: 'Fold' })
    expect(await ui.find({ text: /● L1 · 2\/2 settled ▾/ })).toBeDefined()
    await ui.press({ key: 'fold-all' })
    await ui.unmount()
  }
})
