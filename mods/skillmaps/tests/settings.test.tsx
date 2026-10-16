import { expect, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const pane = (requestId: string) =>
  ({
    component: 'Pane',
    requestId,
    props: {
      title: requestId,
      isFocused: false,
      bodyColumns: 70,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  }) as const

test('every map is on by default: the legend lists the three and a press on one opens its pane', async ($, on) => {
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  const ui = await $.ui.mount({ plugin: 'skillmaps', surface: 'terminal', ...pane('grill-map') })
  expect(await ui.find({ text: /^SKILLMAPS · GRILL-MAP IDLE$/ })).toBeDefined()
  expect(await ui.find({ text: /■ grill-map {2}■ wayfinder-map {2}■ spec-map/ })).toBeDefined()
  await ui.press({ key: 'map-spec-map' })
  expect(opened).toEqual(['spec-map'])
  await ui.unmount()
})

test('a map turned off answers no word and leaves the legend', { options: { spec: false } }, async ($, on) => {
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  const off = await $.command.run({ command: 'skillmaps', args: 'spec 239', ...RUN })
  expect(off?.text).toMatch(/spec-map is turned off/)
  expect(opened).toEqual([])

  // A bare /skillmaps opens the pane used last.
  await $.command.run({ command: 'skillmaps', args: 'grill', ...RUN })
  await $.command.run({ command: 'skillmaps', args: '', ...RUN })
  expect(opened).toEqual(['grill-map', 'grill-map'])

  const usage = await $.command.run({ command: 'skillmaps', args: 'nope', ...RUN })
  expect(usage?.text).toMatch(/\/skillmaps grill/)
  expect(usage?.text).not.toMatch(/\/skillmaps spec/)

  const ui = await $.ui.mount({ plugin: 'skillmaps', surface: 'terminal', ...pane('grill-map') })
  expect(await ui.find({ text: /■ grill-map {2}■ wayfinder-map/ })).toBeDefined()
  expect(await ui.find({ key: 'map-spec-map' })).toBeUndefined()
  await ui.unmount()
})
