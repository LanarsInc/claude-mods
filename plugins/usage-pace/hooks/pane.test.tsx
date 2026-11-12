import { expect, mock, test } from 'claude-code/testing'

const HOUR = 3_600_000
const RESETS = new Date(2026, 10, 12, 10, 0).getTime()
const TUESDAY = new Date(2026, 10, 10, 15, 0).getTime()
const MONDAY_MORNING = new Date(2026, 10, 9, 9, 0).getTime()

// Monday spent 8% of the limit; Tuesday has spent 2% so far, 5% more with the reading below.
const TRACKED = {
  since: MONDAY_MORNING,
  days: {
    '2026-11-09': [{ resetsAt: RESETS, low: 30, high: 38 }],
    '2026-11-10': [{ resetsAt: RESETS, low: 38, high: 40 }],
  },
}

const PANE = {
  component: 'Pane',
  requestId: 'usage-pace',
  props: {
    title: 'Usage',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const READING = {
  context: { contextWindowSize: 200_000 } as never,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 16, resetsAt: new Date(TUESDAY + 4 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 45, resetsAt: new Date(RESETS).toISOString() },
  ],
  changed: ['rateLimits' as const],
}

test('the pane shows both windows and switches between 7 days and 5 workdays', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  mock.store(on, TRACKED)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure(READING)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-pace', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: 'Session (5hr)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Resets in 4h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '13.6% left' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '15% of 28.6%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '14.3% a day' })).toBeDefined()
    // The limit's week began on Thursday, before tracking did.
    expect(await ui.find({ type: 'Text', text: 'Days are tracked from Mon 09:00; earlier ones show nothing.' })).toBeDefined()

    await ui.press({ key: 'workdays' })
    expect(await ui.find({ type: 'Text', text: '25% left' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '15% of 40%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '20% a workday' })).toBeDefined()

    await ui.press({ key: 'week' })
    expect(await ui.find({ type: 'Text', text: '14.3% a day' })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane says when there is no reading yet', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  mock.store(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-pace', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /No usage reading yet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane says which days were before tracking began', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  mock.store(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure(READING)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: 'Days are tracked from Tue 15:00; earlier ones show nothing.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '14.3% left' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0% of 14.3%' })).toBeDefined()
  await ui.unmount()
})

test('the pane estimates the days before tracking from the transcripts', async ($, on) => {
  const clock = mock.clock(on, { now: TUESDAY })
  mock.store(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // The weekly limit stood at 45% when tracking began: 35% on Friday, 5% on Monday and Tuesday each.
  const minutes = {
    [new Date(2026, 10, 6, 12, 0).getTime()]: 7,
    [new Date(2026, 10, 9, 11, 0).getTime()]: 1,
    [new Date(2026, 10, 10, 9, 0).getTime()]: 1,
  }
  const runs: (readonly string[])[] = []
  on('process.run', ($, e) => {
    runs.push(e.argv)

    const stdout = JSON.stringify(minutes)

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.measure(READING)
  await clock.advance(1_000)

  expect(runs).toHaveLength(1)
  expect(runs[0]?.slice(3)).toEqual([String(RESETS - 7 * 24 * HOUR), String(TUESDAY)])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-pace', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: '~Mon' })).toBeDefined()
    // Friday is in the limit's week too (Thursday to Wednesday): all 45% against six days' budget.
    expect(await ui.find({ type: 'Text', text: '45% of 85.7%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '40.7% left' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /estimated from your Claude Code logs/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Update now takes figures the engine has and no hook was told of', async ($, on) => {
  const clock = mock.clock(on, { now: TUESDAY })
  mock.store(on, TRACKED)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: TUESDAY,
      context: READING.context,
      rateLimits: [{ kind: 'seven_day', percentUsed: 45.6, resetsAt: new Date(RESETS).toISOString() }],
    },
  }))
  on('process.run', () => ({ deny: 'no python in tests' }))
  await $.session.measure(READING)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...PANE })
  await clock.advance(5 * 60_000)
  await ui.press({ key: 'update' })
  expect(toasts.at(-1)).toBe('Usage updated.')
  expect(await ui.find({ type: 'Text', text: '45.6%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Session (5hr)' })).toBeDefined()

  await ui.press({ key: 'update' })
  expect(toasts.at(-1)).toMatch(/Already up to date/)
  await ui.unmount()
})
