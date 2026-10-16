import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'wayfinder-map',
  props: {
    title: 'Wayfinder',
    isFocused: false,
    bodyColumns: 72,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

const MAP_BODY = `## Destination

A spec for offline sync, ready for /to-spec.

## Notes

Consult domain-modeling.

## Decisions so far

- [Pick the storage engine](https://github.com/o/r/issues/43): SQLite with WAL

## Not yet specified

- How conflicts surface to the person

## Out of scope

- [Mobile app](https://github.com/o/r/issues/47): beyond the destination
`

const label = (name: string) => [{ name: `wayfinder:${name}` }]
const subs = [
  { number: 43, title: 'Pick the storage engine', state: 'closed', body: '## Question\n\nWhich engine?', labels: label('grilling'), assignees: [], html_url: 'https://github.com/o/r/issues/43', issue_dependencies_summary: { total_blocked_by: 0 } },
  { number: 44, title: 'Shape of the sync log', state: 'open', body: '## Question\n\nWhat does a log row hold?', labels: label('prototype'), assignees: [{ login: 'me' }], html_url: 'https://github.com/o/r/issues/44', issue_dependencies_summary: { total_blocked_by: 1 } },
  { number: 45, title: 'Read the CRDT docs', state: 'open', body: '## Question\n\nWhich CRDT fits?', labels: label('research'), assignees: [], html_url: 'https://github.com/o/r/issues/45', issue_dependencies_summary: { total_blocked_by: 0 } },
  { number: 46, title: 'Migration plan', state: 'open', body: 'Blocked by: #44\n\n## Question\n\nHow do rows move?', labels: label('task'), assignees: [], html_url: 'https://github.com/o/r/issues/46' },
  { number: 47, title: 'Mobile app', state: 'closed', state_reason: 'not_planned', body: '## Question\n\nA phone client?', labels: label('grilling'), assignees: [], html_url: 'https://github.com/o/r/issues/47' },
]

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('the route draws the map as a tree of tickets, with the next one on the frontier', async ($, on) => {
  mock.store(on)
  on('process.run', (_$, e) => {
    const call = e.argv.join(' ')
    if (call.includes('issue view 42'))
      return ok(JSON.stringify({ number: 42, title: 'Offline sync', body: MAP_BODY, url: 'https://github.com/o/r/issues/42' }))
    if (call.includes('issues/42/sub_issues')) return ok(JSON.stringify(subs))
    if (call.includes('issues/44/dependencies/blocked_by')) return ok(JSON.stringify([{ number: 43 }]))
    if (call.includes('issue view 43')) return ok(JSON.stringify({ comments: [{ body: 'Resolved: **SQLite** with WAL.' }] }))
    return ok('[]')
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))

  await $.command.run({ command: 'waymap', args: '42', ...RUN })

  // The surfaces with no surface module's region draw the route as an indented tree.
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'wayfinder-map', surface, ...PANE })
    const has = async (text: RegExp) => expect(await ui.find({ type: 'Text', text }), String(text)).toBeDefined()
    await has(/map #42/)
    await has(/^Offline sync$/)
    await has(/A spec for offline sync/)
    await has(/^ 1\/4 $/)
    await has(/├─ ✓ Pick the storage engine/)
    await has(/│  └─ ● Shape of the sync log/)
    await has(/│     └─ ○ Migration plan/)
    await has(/└─ ◇ Read the CRDT docs/)
    await has(/^ next $/)
    await has(/after Shape of the sync…/)
    await has(/≈ How conflicts surface/)
    expect(await ui.find({ type: 'Text', text: /─ .*Mobile app/ }), 'out of scope stays off the route').toBeUndefined()

    await ui.press({ key: 'focus-43' })
    await has(/^Question$/)
    await has(/Resolved: SQLite with WAL\./)
    await has(/unblocks Shape of the sync log/)
    await ui.press({ key: 'unfocus' })

    await ui.press({ key: 'tab-decisions' })
    await has(/✓ Pick the storage engine/)
    await has(/SQLite with WAL/)
    await has(/⊘ Mobile app/)
    await ui.press({ key: 'tab-route' })
    await ui.unmount()
  }

  // The terminal and the desktop draw it as a graph from Start to Destination, walked with the arrows.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'wayfinder-map', surface, ...PANE })
    await ui.resize({ columns: 68, rows: 30, in: 'graph' })
    const inGraph = async (text: RegExp) =>
      expect(await ui.find({ type: 'Text', text, in: 'graph' }), String(text)).toBeDefined()
    const lines = async () =>
      (await ui.findAll({ type: 'Text', in: 'graph' }))
        .filter(t => (t.props as { wrap?: string }).wrap === 'truncate-end')
        .map(t => t.text ?? '')
    await inGraph(/⚑ Start/)
    await inGraph(/Offline sync/)
    await inGraph(/⚑ Destination/)
    await inGraph(/A spec for offline sync/)
    await inGraph(/│ \? │ ✓ Pick the storage/)
    await inGraph(/│ ◫ │ ● Shape of the sync/)
    await inGraph(/│ ⌕ │ ▶ Read the CRDT/)
    await inGraph(/│ ≡ │ ○ Migration plan/)
    await inGraph(/▼/)
    expect((await lines()).some(l => l.includes('Mobile app')), 'out of scope stays off the map').toBe(false)

    // The first arrow selects the next ticket; the card follows the selection along the edges.
    await ui.key({ key: 'down', in: 'graph' })
    await inGraph(/║ ⌕ ║ ▶ Read the CRDT/)
    expect(await ui.find({ type: 'Text', text: /◆ Read the CRDT docs/ }), 'card opened').toBeDefined()
    await ui.key({ key: 'left', in: 'graph' })
    await inGraph(/║ \? ║ ✓ Pick the storage/)
    expect(await ui.find({ type: 'Text', text: /Resolved: SQLite with WAL\./ }), 'answer read on focus').toBeDefined()
    await ui.key({ key: 'down', in: 'graph' })
    await inGraph(/║ ◫ ║ ● Shape of the sync/)
    await ui.key({ key: 'return', in: 'graph' })
    expect(await ui.find({ type: 'Text', text: /^Question$/ }), 'Enter closes the card').toBeUndefined()
    await inGraph(/║ ◫ ║ ● Shape of the sync/)

    // A click on a box selects it; n and p step without the graph holding the keys.
    const drawn = await lines()
    const row = drawn.findIndex(l => l.includes('Read the CRDT'))
    const col = drawn[row]?.indexOf('Read the CRDT') ?? 0
    await ui.pointer({ type: 'down', x: col, y: row, button: 'left' })
    await inGraph(/║ ⌕ ║ ▶ Read the CRDT/)
    await ui.press({ key: 'next' })
    await inGraph(/║ ◫ ║ ● Shape of the sync/)
    await ui.press({ key: 'unfocus' })
    await ui.press({ key: 'tab-decisions' })
    await ui.press({ key: 'tab-route' })
    await ui.unmount()
  }
})

test('a local map is read from .scratch, and a claim there marks the ticket as yours', async ($, on) => {
  mock.store(on)
  const files: Record<string, string> = {
    '/repo/.scratch/sync/map.md': `# Offline sync\n\n${MAP_BODY.replace(/https:\/\/github.com\/o\/r\/issues\/43/, 'issues/01-storage.md')}`,
    '/repo/.scratch/sync/issues/01-storage.md': '# Pick the storage engine\n\nType: grilling\nStatus: resolved\n\n## Question\n\nWhich engine?\n\n## Answer\n\nSQLite.',
    '/repo/.scratch/sync/issues/02-log.md': '# Shape of the sync log\n\nType: prototype\nStatus: claimed\nBlocked by: 01\n\n## Question\n\nWhat does a row hold?',
  }
  on('fs.read', (_$, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', (_$, e) =>
    e.path === '/repo/.scratch/sync/issues'
      ? {
          value: ['01-storage.md', '02-log.md'].map(name => ({
            name,
            kind: 'file' as const,
            size: 1,
            mtimeMs: 1,
            isLink: false,
          })),
        }
      : { value: [] },
  )
  on('tool.call', () => ({ result: { type: 'update', filePath: '', content: '' } as never }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))

  // A claim counts inside a Run, the stretch /wayfinder starts.
  await $.skill.prompt({ skill: 'mattpocock-skills:wayfinder', text: 'A loose idea has arrived…\n\nARGUMENTS: ' })
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/.scratch/sync/issues/02-log.md',
    content: files['/repo/.scratch/sync/issues/02-log.md'] ?? '',
  })

  const ui = await $.ui.mount({ plugin: 'wayfinder-map', surface: 'terminal', ...PANE })
  const has = async (text: RegExp) => expect(await ui.find({ type: 'Text', text }), String(text)).toBeDefined()
  await has(/^sync $/)
  const inGraph = async (text: RegExp) =>
    expect(await ui.find({ type: 'Text', text, in: 'graph' }), String(text)).toBeDefined()
  await inGraph(/│ \? │ ✓ Pick the storage/)
  await inGraph(/│ ◫ │ ● Shape of the sync/)
  await ui.key({ key: 'up', in: 'graph' })
  await inGraph(/║ ◫ ║ ● Shape of the sync/)
  await ui.key({ key: 'up', in: 'graph' })
  await has(/^SQLite\.$/)
  await ui.unmount()
})
