import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'spec-flow',
  props: {
    title: 'Flow',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const issues = [
  { number: 240, title: 'Track map', state: 'closed', body: '## Blocked by\n\nNone' },
  { number: 241, title: 'feat(web): Popover header', state: 'open', body: '## Blocked by\n\n- #240' },
  { number: 242, title: 'Italian copy', state: 'open', body: '## Blocked by\n\n- #241' },
]

test('the pane shows the spec, its tickets and the implementer working on one', async ($, on) => {
  on('process.run', (_$, e) => {
    const call = e.argv.join(' ')
    const stdout = call.includes('issue view')
      ? JSON.stringify({ title: 'Checks popover: nine changes (a, b, c)' })
      : call.includes('sub_issues')
        ? JSON.stringify(issues)
        : call.includes('pr list')
          ? JSON.stringify([
              {
                number: 243,
                title: 'feat: popover round (#239)',
                body: 'Closes #239',
                state: 'OPEN',
                isDraft: false,
                headRefName: 'feat/popover-239',
              },
            ])
          : call.includes('pr view')
            ? JSON.stringify({
                statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE', state: null }],
              })
            : call.includes('pulls/243/commits')
              ? ['["feat(web): popover header",1]', '["Merge #241: popover header",2]'].join('\n')
              : '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))

  await $.command.run({
    command: 'flow',
    args: 'spec 239',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  await $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'Build ticket #241 with tdd.',
    description: 'Implement #241 popover',
    subagentType: 'general-purpose',
    provider: { plugin: 'test', tier: 'user' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'spec-flow', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /spec #239/ }), String(/spec #239/)).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /^Checks popover$/ }),
      String(/^Checks popover$/),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^implementer$/ }), String(/^implementer$/)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Bash|starting/ }), String(/Bash|starting/)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 implementing/ }), String(/1 implementing/)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 of 3 done/ }), String(/2 of 3 done/)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^closed$/ }), String(/^closed$/)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ready$/ }), String(/^ready$/)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#241 Popover header$/ }), 'prefix stripped').toBeDefined()
    expect(await ui.find({ type: 'Text', text: /feat\(web\)/ }), 'no prefix left').toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ implement $/ }), 'stage pill').toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /PR #243 · open · feat\/popover-239/ }),
      'integration PR',
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CI ✗/ }), 'CI pill').toBeDefined()
    await ui.unmount()
  }
})

test('the slots setting draws the meter against its cap', { options: { slots: 3 } }, async ($, on) => {
  on('process.run', (_$, e) => {
    const call = e.argv.join(' ')
    const stdout = call.includes('issue view')
      ? JSON.stringify({ title: 'Checks popover: nine changes (a, b, c)' })
      : call.includes('sub_issues')
        ? JSON.stringify(issues)
        : call.includes('pr list')
          ? JSON.stringify([
              {
                number: 243,
                title: 'feat: popover round (#239)',
                body: 'Closes #239',
                state: 'OPEN',
                isDraft: false,
                headRefName: 'feat/popover-239',
              },
            ])
          : call.includes('pr view')
            ? JSON.stringify({
                statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE', state: null }],
              })
            : call.includes('pulls/243/commits')
              ? ['["feat(web): popover header",1]', '["Merge #241: popover header",2]'].join('\n')
              : '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))

  await $.command.run({
    command: 'flow',
    args: 'spec 239',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  await $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'Build ticket #241 with tdd.',
    description: 'Implement #241 popover',
    subagentType: 'general-purpose',
    provider: { plugin: 'test', tier: 'user' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

  const ui = await $.ui.mount({ plugin: 'spec-flow', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /1\/3 slots/ })).toBeDefined()
  await ui.unmount()
})
