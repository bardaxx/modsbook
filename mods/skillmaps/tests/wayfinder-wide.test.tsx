import { expect, mock, test } from 'claude-code/testing'

// The article's own picture: one grilling up top, three branches, two that merge, then the destination.
const MAP = '## Destination\n\nAll tasks on the map are complete.\n'
const t = (n: number, title: string, type: string, state: string, blockedBy: number[]) => ({
  number: n,
  title,
  state,
  body: `${blockedBy.length ? `Blocked by: ${blockedBy.map(b => `#${b}`).join(', ')}\n\n` : ''}## Question\n\n${title}?`,
  labels: [{ name: `wayfinder:${type}` }],
  assignees: [],
  html_url: `https://github.com/o/r/issues/${n}`,
})
const subs = [
  t(1, 'Who is it for', 'grilling', 'closed', []),
  t(2, 'Stand up the sandbox', 'task', 'open', [1]),
  t(3, 'Pricing model', 'grilling', 'open', [1]),
  t(4, 'Competitor APIs', 'research', 'open', [1]),
  t(5, 'Onboarding flow sketch', 'prototype', 'open', [2, 3]),
  t(6, 'Launch scope', 'grilling', 'open', [3, 4]),
]

test('a map shaped like the article draws as a graph that fans out and merges', async ($, on) => {
  mock.store(on)
  on('process.run', (_$, e) => {
    const call = e.argv.join(' ')
    const stdout = call.includes('issue view 9')
      ? JSON.stringify({ number: 9, title: 'A foggy idea, with no idea how to get there', body: MAP, url: 'u' })
      : call.includes('sub_issues')
        ? JSON.stringify(subs)
        : '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.command.run({
    command: 'skillmaps',
    args: 'wayfinder 9',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  for (const columns of [86, 50]) {
    const ui = await $.ui.mount({
      plugin: 'skillmaps',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'wayfinder-map',
      props: { title: 'Wayfinder', isFocused: false, bodyColumns: columns + 4, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    await ui.resize({ columns, rows: 40, in: 'graph' })
    const lines = (await ui.findAll({ type: 'Text', in: 'graph' }))
      .filter(x => (x.props as { wrap?: string }).wrap === 'truncate-end')
      .map(x => x.text ?? '')
    // One box fans out to three, the three merge into two, the two into the destination.
    expect(lines.some(l => /╭─+┼─+╮/.test(l)), 'fan-out').toBe(true)
    expect(lines.filter(l => (l.match(/▼/g) ?? []).length === 3)).toHaveLength(1)
    expect(lines.filter(l => (l.match(/╭───┬/g) ?? []).length === 3)).toHaveLength(1)
    expect(lines.some(l => l.includes('⚑ Destination'))).toBe(true)
    expect(lines.some(l => l.includes('Launch scope')), 'titles shorten in a narrow pane').toBe(columns > 60)
    expect(lines.every(l => l.length <= columns), 'fits the pane').toBe(true)
    await ui.unmount()
  }
})
