import { expect, mock, test } from 'claude-code/testing'

const HOUR = 3_600_000
const RESETS = new Date(2026, 10, 12, 10, 0).getTime()
const TUESDAY = new Date(2026, 10, 10, 15, 0).getTime()
const MONDAY_MORNING = new Date(2026, 10, 9, 9, 0).getTime()

// Monday spent 8% of the limit; Tuesday 7% with the reading below, so 13.6% of the 28.6% is left.
const TRACKED = {
  since: MONDAY_MORNING,
  days: {
    '2026-11-09': [{ resetsAt: RESETS, low: 30, high: 38 }],
    '2026-11-10': [{ resetsAt: RESETS, low: 38, high: 40 }],
  },
}

const READING = {
  context: { contextWindowSize: 200_000 } as never,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 16, resetsAt: new Date(TUESDAY + 4 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 45, resetsAt: new Date(RESETS).toISOString() },
  ],
  changed: ['rateLimits' as const],
}

const band = (bodyColumns: number, hasSurvey = false) =>
  ({
    plugin: 'usage-pace',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 9 },
      view: {},
    },
  }) as const

const typed = (args: string) => ({
  command: 'usage-pace',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 120 },
})

test('the band words itself shorter and then drops the bars as it narrows', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  mock.store(on, TRACKED)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure(READING)

  const wide = await $.ui.mount(band(120))
  expect(await wide.find({ type: 'Text', text: 'resets in 4h' })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: 'today 13.6% left' })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: /━/ })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: '▸' })).toBeDefined()
  expect(await wide.find({ type: 'Button', key: 'workdays' })).toBeDefined()
  await wide.unmount()

  const narrow = await $.ui.mount(band(44))
  expect(await narrow.find({ type: 'Text', text: '4h' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: '13.6% left' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: 'today 13.6% left' })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /━/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: '▸' })).toBeDefined()
  expect(await narrow.find({ type: 'Button', key: 'workdays' })).toBeDefined()
  await narrow.unmount()

  // Too few cells for the bars and the switch: the switch goes first.
  const narrower = await $.ui.mount(band(42))
  expect(await narrower.find({ type: 'Text', text: /━/ })).toBeDefined()
  expect(await narrower.find({ type: 'Text', text: '▸' })).toBeDefined()
  expect(await narrower.find({ type: 'Button', key: 'workdays' })).toBeUndefined()
  await narrower.unmount()

  const tiny = await $.ui.mount(band(30))
  expect(await tiny.find({ type: 'Text', text: '13.6% left' })).toBeDefined()
  expect(await tiny.find({ type: 'Text', text: /━/ })).toBeUndefined()
  expect(await tiny.find({ type: 'Text', text: '▸' })).toBeUndefined()
  expect(await tiny.find({ type: 'Button', key: 'workdays' })).toBeUndefined()
  await tiny.unmount()
})

test('the band keeps to two lines, with today marked before its day', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  mock.store(on, TRACKED)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure(READING)

  for (const columns of [120, 44, 42, 30]) {
    const ui = await $.ui.mount(band(columns))
    // The band's own Box is the outermost: each element it holds is a line.
    const lines = (await ui.find({ type: 'Box' }))?.children ?? []
    expect(lines.filter(line => typeof line === 'object' && line !== null)).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: '▲' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the band switches between 7 days and 5 workdays, and keeps the choice', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  const store = new Map<string, unknown>(Object.entries(TRACKED))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => (store.set(e.key, e.value), { value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  await $.session.measure(READING)

  for (const columns of [120, 44]) {
    const ui = await $.ui.mount(band(columns))
    // The one in use is lit; the other has no background.
    const lit = async (label: string) => (await ui.find({ type: 'Text', text: label }))?.props.backgroundColor
    expect((await ui.find({ type: 'Button', key: 'week' }))?.text).toBe('7d')
    expect((await ui.find({ type: 'Button', key: 'workdays' }))?.text).toBe('5d')
    expect(await lit('7d')).toBe('success')
    expect(await lit('5d')).toBeUndefined()

    // Monday and Tuesday at a fifth each: 40%, of which 15% is used.
    await ui.press({ key: 'workdays' })
    expect(await ui.find({ type: 'Text', text: /25% left$/ })).toBeDefined()
    expect(await lit('5d')).toBe('success')
    expect(await lit('7d')).toBeUndefined()
    expect(store.get('mode')).toBe('workdays')
    expect(toasts.at(-1)).toBe('Pacing the week over 5 workdays.')

    await ui.press({ key: 'week' })
    expect(await ui.find({ type: 'Text', text: /13\.6% left$/ })).toBeDefined()
    expect(await lit('7d')).toBe('success')
    expect(store.get('mode')).toBe('week')
    expect(toasts.at(-1)).toBe('Pacing the week over 7 days.')
    await ui.unmount()
  }
})

test('by 5 workdays the bar crosses out Saturday and Sunday', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  mock.store(on, TRACKED)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.measure(READING)

  const stroke = String.fromCharCode(0x0336)
  const crossedOut = (day: string) => ` ${[...day].map(letter => letter + stroke).join('')} `
  const ui = await $.ui.mount(band(120))
  expect(await ui.find({ type: 'Text', text: ' Sat ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' Sun ' })).toBeDefined()

  await ui.press({ key: 'workdays' })
  expect(await ui.find({ type: 'Text', text: crossedOut('Sat') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: crossedOut('Sun') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' Sat ' })).toBeUndefined()
  // Thursday is before tracking began and Wednesday is still to come: neither is crossed out.
  expect(await ui.find({ type: 'Text', text: ' Thu ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' Wed ' })).toBeDefined()

  await ui.press({ key: 'week' })
  expect(await ui.find({ type: 'Text', text: ' Sat ' })).toBeDefined()
  await ui.unmount()
})

test('a reading another session saved reaches the band within a minute', async ($, on) => {
  const clock = mock.clock(on, { now: TUESDAY })
  // The store every session shares, which the test writes to as another session.
  const store = new Map<string, unknown>(Object.entries(TRACKED))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => (store.set(e.key, e.value), { value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: TUESDAY, context: READING.context, rateLimits: READING.rateLimits },
  }))
  on('process.run', () => ({ deny: 'no python in tests' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  // Another session's reply, saved half a minute in, moved the week on to 52%.
  const week = { percentUsed: 52, resetsAt: new Date(RESETS).toISOString() }
  store.set('reading', { session: null, week, at: TUESDAY + 30_000 })
  await clock.advance(60_000)

  const ui = await $.ui.mount(band(80))
  expect(await ui.find({ type: 'Text', text: /52%/ })).toBeDefined()
  await ui.unmount()
})

test('/usage-pace hide hides the band, /usage-pace shows it, and a survey has the band to itself', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  mock.store(on, TRACKED)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // Stands for the engine's own band beneath the plugin: nothing to draw.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  await $.session.measure(READING)

  expect((await $.command.run(typed('hide'))).text).toMatch(/hidden/)
  const hidden = await $.ui.mount(band(80))
  expect(await hidden.find({ type: 'Text', text: /45%/ })).toBeUndefined()
  await hidden.unmount()

  expect((await $.command.run(typed(''))).text).toBe('Usage shown above the prompt.')
  const shown = await $.ui.mount(band(80))
  expect(await shown.find({ type: 'Text', text: /45%/ })).toBeDefined()
  await shown.unmount()

  const survey = await $.ui.mount(band(80, true))
  expect(await survey.find({ type: 'Text', text: /45%/ })).toBeUndefined()
  await survey.unmount()
})

test('the × closes the band and says how to bring it back', async ($, on) => {
  mock.clock(on, { now: TUESDAY })
  mock.store(on, TRACKED)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  await $.session.measure(READING)

  const ui = await $.ui.mount(band(80))
  expect(await ui.find({ type: 'Text', text: /45%/ })).toBeDefined()
  await ui.press({ key: 'close' })
  expect(await ui.find({ type: 'Text', text: /45%/ })).toBeUndefined()
  expect(toasts).toEqual(['Usage hidden; /usage-pace shows it again.'])
  await ui.unmount()
})
