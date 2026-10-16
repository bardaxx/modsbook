import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { WayfinderRun } from '../types'

const PANE = {
  component: 'Pane',
  requestId: 'grill-map',
  props: {
    title: 'grill-map',
    isFocused: false,
    bodyColumns: 72,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const ROUND = '❓ **Q1** - **Fallback**: Does the card under the tree carry the Spine unchanged?\n\n➡️ Yes, unchanged'

/** wayfinder-map's Run as grill-map reads it: the test moves it, as wayfinder-map would. */
const stubs = (on: On) => {
  const world = { run: null as WayfinderRun | null, statuses: [] as (string | undefined)[] }
  mock.store(on)
  on('state.get', ($, e, next) =>
    e.plugin === 'skillmaps' && e.key === 'run' ? { value: { value: world.run, version: 1 } } : next(e),
  )
  on('ui.status', (_$, e) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('skill.prompt', (_$, e) => {
    const name = e.skill.replace(/^.*:/, '')
    if (name === 'wayfinder') world.run = world.run ?? { ticket: null, claimedAt: null }
    if (name === 'grill-me' || name === 'grill-with-docs') world.run = null
    return { text: e.text }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: { type: 'text', text: '' } as never }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  return world
}

const turn = (answer: string, turnId: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' }) as const
const say = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

// wayfinder-map's part turned off: the test moves the Run itself, as wayfinder-map would.
test('inside a Run: no status line of its own, one grill per claimed ticket, a charting grill before', { options: { wayfinder: false } }, async ($, on) => {
  const world = stubs(on)

  // A grill of its own: its status line, until the Run starts.
  await $.skill.prompt({ skill: 'grill-me', text: 'ARGUMENTS: Something else' })
  await $.turn.complete(turn(ROUND, 't0'))
  expect(world.statuses.at(-1)).toBe('grill L1 · 1 open')
  await $.skill.prompt({ skill: 'mattpocock-skills:wayfinder', text: 'ARGUMENTS: .scratch/nested-spine' })
  expect(world.statuses.at(-1), 'wayfinder-map carries the status line').toBeUndefined()

  // Before a claim, a round goes to the charting grill; a read opens none.
  await $.tool.call({ tool: 'Read', file_path: '/repo/.scratch/nested-spine/map.md' })
  await $.turn.complete(turn(ROUND, 't1'))
  await $.prompt.submit(say('sì'))

  // A claim: the next step opens the ticket's grill, its name the subject.
  world.run = { ticket: { id: '4', title: 'The Spine under the tree fallback' }, claimedAt: Date.now() }
  await $.tool.call({ tool: 'Read', file_path: '/repo/mods/wayfinder-map/hooks/register.tsx' })
  await $.turn.complete(turn(ROUND, 't2'))
  expect(world.statuses.at(-1)).toBeUndefined()

  const ui = await $.ui.mount({ plugin: 'skillmaps', surface: 'terminal', ...PANE })
  const has = async (text: RegExp) => expect(await ui.find({ text }), String(text)).toBeDefined()
  await has(/^The Spine under the tree fallback$/)
  await has(/^3\/3 $/)
  await has(/┃ ⌕ 1 lookup · register\.tsx/)
  await has(/◆ L1 · waiting for you/)
  await ui.press({ key: 'prev' })
  await has(/^charting$/)
  await has(/● L1 · 1\/1 settled/)
  expect(await ui.find({ type: 'Text', text: /map\.md/ }), 'the read before the claim opened no grill').toBeUndefined()
  await ui.unmount()

  // /grill-me ends the Run: a grill of its own again, with its status line.
  await $.skill.prompt({ skill: 'grill-me', text: 'ARGUMENTS: Billing rewrite' })
  expect(world.run).toBeNull()
  expect(world.statuses.at(-1)).toBe('grill · starting')
})

test('with no wayfinder-map, a /wayfinder grill is a grill of its own, status line included', { options: { wayfinder: false } }, async ($, on) => {
  const statuses: (string | undefined)[] = []
  mock.store(on)
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.skill.prompt({ skill: 'mattpocock-skills:wayfinder', text: 'ARGUMENTS: Offline sync' })
  await $.turn.complete(turn(ROUND, 't1'))
  expect(statuses.at(-1)).toBe('grill L1 · 1 open')
})
