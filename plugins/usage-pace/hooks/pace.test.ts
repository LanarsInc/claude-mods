import { describe, expect, test } from 'claude-code/testing'

import {
  crossed,
  currentSession,
  currentWeek,
  duration,
  percent,
  record,
  segmentText,
  spentOn,
  todayAt,
  spread,
  weekPace,
  weekSegments,
  windowWeek,
  WEEK,
} from './pace'

// Local times in a week with no clock change: the weekly limit runs Thu 5 Nov
// 10:00 to Thu 12 Nov 10:00, so its week is Thursday to Wednesday.
const at = (date: number, hour: number) => new Date(2026, 10, date, hour, 0).getTime()
const RESETS = at(12, 10)
const NEXT_RESETS = RESETS + WEEK
const TUESDAY = at(10, 15)

describe('the week', () => {
  test('runs the seven days of the limit, from the day it resets on', async () => {
    const week = windowWeek({}, RESETS, TUESDAY, 'week', at(5, 12))
    expect(week.map(day => day.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'])
    expect(week.map(day => day.isToday)).toEqual([false, false, false, false, false, true, false])
    expect(week.filter(day => day.isFuture).map(day => day.label)).toEqual(['Wed'])
    expect(percent(week[0]?.budget ?? 0)).toBe('14.3%')
  })

  test('starts on the next day when the limit resets after noon', async () => {
    const week = windowWeek({}, at(12, 17), TUESDAY, 'week', at(5, 18))
    expect(week.map(day => day.label)).toEqual(['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
    // Thursday evening, before the first day's date, counts to the first day.
    expect(windowWeek({}, at(12, 17), at(5, 20), 'week', at(5, 18))[0]?.isToday).toBe(true)
  })

  test('gives workdays a fifth each and the weekend nothing', async () => {
    const week = windowWeek({}, RESETS, TUESDAY, 'workdays', at(5, 12))
    expect(week.map(day => day.budget)).toEqual([20, 20, 0, 0, 20, 20, 20])
  })

  test('marks the days before tracking began as unknown', async () => {
    const week = windowWeek({}, RESETS, TUESDAY, 'week', at(10, 10))
    expect(week.map(day => day.isUnknown)).toEqual([true, true, true, true, true, false, false])
  })
})

describe('day marks', () => {
  test('count each day from where the day before left off', async () => {
    let days = record({}, 30, RESETS, at(9, 9), at(9, 9))
    days = record(days, 38, RESETS, at(9, 18), at(9, 9))
    days = record(days, 40, RESETS, at(10, 10), at(9, 9))
    days = record(days, 45, RESETS, at(10, 15), at(9, 9))
    // Another session's older reading arrives late and changes nothing.
    days = record(days, 43, RESETS, at(10, 12), at(9, 9))
    expect(spentOn(days, '2026-11-09')).toBe(8)
    expect(spentOn(days, '2026-11-10')).toBe(7)
  })

  test('keep both limits apart on the day one resets', async () => {
    let days = record({}, 90, RESETS, at(11, 20), at(9, 9))
    days = record(days, 95, RESETS, at(12, 8), at(9, 9))
    days = record(days, 3, NEXT_RESETS, at(12, 12), at(9, 9))
    expect(spentOn(days, '2026-11-12')).toBe(8)
    expect(spentOn(days, '2026-11-12', RESETS)).toBe(5)
    expect(spentOn(days, '2026-11-12', NEXT_RESETS)).toBe(3)
  })

  test('drop dates more than two weeks old', async () => {
    const days = record({ '2026-10-01': [{ resetsAt: 0, low: 0, high: 5 }] }, 30, RESETS, TUESDAY, at(9, 9))
    expect(Object.keys(days)).toEqual(['2026-11-10'])
  })
})

describe('the weekly bar', () => {
  const tracked = at(9, 9)

  test('runs reset to reset over all seven days, the weekend gray by workdays', async () => {
    const segments = weekSegments(windowWeek({}, RESETS, TUESDAY, 'workdays', at(5, 12)), 48)
    expect(segments.map(s => s.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'])
    expect(segments.map(s => s.isDim)).toEqual([false, false, true, true, false, false, false])
    expect(segments.map(s => s.cells)).toEqual([5, 5, 5, 5, 5, 5, 5])
  })

  test('crosses out the weekend by workdays, and no day by all seven', async () => {
    const byWorkdays = weekSegments(windowWeek({}, RESETS, TUESDAY, 'workdays', at(5, 12)), 48)
    expect(byWorkdays.map(s => s.isOff)).toEqual([false, false, true, true, false, false, false])
    const byWeek = weekSegments(windowWeek({}, RESETS, TUESDAY, 'week', at(5, 12)), 48)
    expect(byWeek.map(s => s.isOff)).toEqual([false, false, false, false, false, false, false])

    // A line through each letter, drawn over it: the text keeps its cells.
    const stroke = String.fromCharCode(0x0336)
    expect(crossed(' Sat ')).toBe(` S${stroke}a${stroke}t${stroke} `)
    expect(crossed(' Sat ').replaceAll(stroke, '')).toBe(' Sat ')
  })

  test('gives every day as many cells, an odd number, and spreads the rest between them', async () => {
    const week = windowWeek({}, RESETS, TUESDAY, 'week', at(5, 12))
    // 54 cells: 6 a day would fit, so 5, centring 'Thu'; 3 between each and 1 after the last.
    const segments = weekSegments(week, 54)
    expect(segments.map(s => s.cells)).toEqual([5, 5, 5, 5, 5, 5, 5])
    expect(segments.map(s => s.space)).toEqual([0, 3, 3, 3, 3, 3, 3])
    expect(segmentText(segments[0] ?? { label: '', space: 0, cells: 0, filled: 0, isOver: false, isToday: false, isDim: false, isOff: false })).toBe(' Thu ')
    // 39 cells: 4 a day would fit, so 3, with 3 between each.
    expect(weekSegments(week, 39).map(s => [s.cells, s.space])).toEqual([[3, 0], [3, 3], [3, 3], [3, 3], [3, 3], [3, 3], [3, 3]])
  })

  test("marks today under the middle of its name, at any width", async () => {
    const week = windowWeek({}, RESETS, TUESDAY, 'week', at(5, 12))
    for (const columns of [54, 39, 20, 13]) {
      const segments = weekSegments(week, columns)
      const drawn = segments.map(s => ' '.repeat(s.space) + segmentText(s)).join('')
      // Today is Tuesday: its middle letter, or all it shows of it.
      expect(drawn[todayAt(segments) ?? -1]).toBe(columns > 13 ? 'u' : 'T')
    }
    expect(todayAt(weekSegments(windowWeek({}, RESETS, at(13, 9), 'week', at(5, 12)), 54))).toBeNull()
  })

  test('fills an unused Monday with what Tuesday used before Tuesday fills', async () => {
    const days = { '2026-11-10': [{ resetsAt: RESETS, low: 30, high: 50 }] }
    const week = windowWeek(days, RESETS, TUESDAY, 'week', tracked)
    // Tuesday used 20%: Monday's 14.3% first, then 5.7% of Tuesday's.
    expect(weekSegments(week, 48).map(s => s.filled)).toEqual([0, 0, 0, 0, 5, 2, 0])
    expect(percent(weekPace(week).left)).toBe('8.6%')
  })

  test('carries what Monday left over into Tuesday', async () => {
    const days = { '2026-11-09': [{ resetsAt: RESETS, low: 30, high: 35 }] }
    const week = windowWeek(days, RESETS, TUESDAY, 'week', tracked)
    // Monday spent 5% of its 14.3%, so Tuesday may spend its own and Monday's 9.3%.
    expect(percent(weekPace(week).left)).toBe('23.6%')
    expect(weekSegments(week, 48).map(s => s.filled)).toEqual([0, 0, 0, 0, 2, 0, 0])
    expect(weekSegments(week, 48).map(segmentText)[4]).toBe(' Mon ')
  })

  test('marks the days ahead that the spending has reached', async () => {
    const days = {
      '2026-11-07': [{ resetsAt: RESETS, low: 10, high: 13 }],
      '2026-11-10': [{ resetsAt: RESETS, low: 13, high: 95 }],
    }
    // Saturday's 3% counts against the workdays too: 85% against 80% by Tuesday.
    const week = windowWeek(days, RESETS, TUESDAY, 'workdays', at(5, 12))
    const segments = weekSegments(week, 48)
    expect(segments.map(s => s.filled)).toEqual([5, 5, 0, 0, 5, 5, 1])
    expect(segments.map(s => s.isOver)).toEqual([false, false, false, false, false, false, true])
    expect(percent(-weekPace(week).left)).toBe('5%')
  })

  test('leaves the days before tracking out of the budget', async () => {
    const week = windowWeek({}, RESETS, TUESDAY, 'week', at(10, 10))
    expect(percent(weekPace(week).left)).toBe('14.3%')
    expect(weekSegments(week, 48)[0]?.isDim).toBe(true)
    expect(weekSegments(week, 48)[0]?.isOff).toBe(false)
  })

  test("paces the limit's own week, not what the last one spent", async () => {
    // A heavy Tuesday and Wednesday, then the limit resets Thursday at 10:00.
    let days = record({}, 40, RESETS, at(10, 9), at(9, 9))
    days = record(days, 70, RESETS, at(10, 20), at(9, 9))
    days = record(days, 95, RESETS, at(11, 20), at(9, 9))
    days = record(days, 3, NEXT_RESETS, at(12, 15), at(9, 9))
    const week = windowWeek(days, NEXT_RESETS, at(12, 15), 'week', at(9, 9))
    expect(week.map(day => day.spent)).toEqual([3, 0, 0, 0, 0, 0, 0])
    expect(percent(weekPace(week).left)).toBe('11.3%')
  })
})

describe('the estimate from the transcripts', () => {
  const since = at(10, 10)

  test('shares the percent used out by what each day weighed', async () => {
    const minutes = { [at(6, 12)]: 7, [at(9, 11)]: 1, [at(10, 9)]: 1, [at(10, 9) + 60_000]: 1 }
    expect(spread(minutes, 50)).toEqual({ '2026-11-06': 35, '2026-11-09': 5, '2026-11-10': 10 })
  })

  test('fills the days before tracking and marks them', async () => {
    const estimate = { since, from: RESETS - WEEK, days: { '2026-11-09': 5, '2026-11-10': 3 } }
    const days = { '2026-11-10': [{ resetsAt: RESETS, low: 40, high: 42 }] }
    const week = windowWeek(days, RESETS, TUESDAY, 'week', since, estimate)
    expect(week.map(day => day.spent).slice(4)).toEqual([5, 5, 0])
    expect(week.map(day => day.isEstimated).slice(4)).toEqual([true, true, false])
    expect(week[0]?.isUnknown).toBe(false)
    expect(weekSegments(week, 48).map(segmentText).slice(4, 6)).toEqual(['~Mon ', '~Tue '])
    expect(weekPace(week).spent).toBe(10)
  })

  test('is ignored when it was made for another tracking start', async () => {
    const estimate = { since: since - 1, from: RESETS - WEEK, days: { '2026-11-09': 5 } }
    const week = windowWeek({}, RESETS, TUESDAY, 'week', since, estimate)
    expect(week[4]).toMatchObject({ spent: 0, isUnknown: true, isEstimated: false })
  })

  test('leaves the pace once its limit has reset', async () => {
    const estimate = { since, from: RESETS - WEEK, days: { '2026-11-10': 5 } }
    const week = windowWeek({}, NEXT_RESETS, at(12, 15), 'week', since, estimate)
    expect(week.some(day => day.spent > 0 || day.isEstimated)).toBe(false)
  })
})

describe('stale readings', () => {
  test('a week read before its reset counts as a fresh, unused week', async () => {
    const week = currentWeek({ percentUsed: 80, resetsAt: new Date(RESETS - WEEK).toISOString() }, TUESDAY)
    expect(week).toEqual({ used: 0, resetsAt: RESETS, isRolled: true })
  })

  test('a 5-hour window past its reset is empty', async () => {
    const session = currentSession({ percentUsed: 40, resetsAt: new Date(TUESDAY - 1).toISOString() }, TUESDAY)
    expect(session).toEqual({ used: 0, resetsAt: null })
  })
})

test('durations read as the screenshot words them', async () => {
  expect(duration(4 * 3_600_000)).toBe('4h')
  expect(duration(6 * 86_400_000 + 3 * 3_600_000)).toBe('6d 3h')
  expect(duration(9 * 60_000 + 1)).toBe('10m')
})
