import type { DayMark, DayMarks, Estimate, PaceMode, UsageWindow } from '../types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
export const WEEK = 7 * DAY
const KEEP_DAYS = 15
const SAME_WINDOW = HOUR

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** One day of a weekly limit's week: its budget and what it spent of the limit. */
export type WeekDay = {
  label: string
  budget: number
  spent: number
  isToday: boolean
  isFuture: boolean
  /** Before tracking began and before what the transcripts could estimate. */
  isUnknown: boolean
  /** Some of what it spent is estimated from the transcripts. */
  isEstimated: boolean
}

/** One segment of the weekly bar. */
export type Segment = {
  label: string
  /** Blank cells before it: none before the first. */
  space: number
  cells: number
  filled: number
  isOver: boolean
  isToday: boolean
  isDim: boolean
  /** A day the pace leaves out, crossed out on the bar: the weekend, by workdays. */
  isOff: boolean
}

function weekday(t: number): string {
  return WEEKDAYS[new Date(t).getDay()] ?? ''
}

function startOfDay(t: number): number {
  const day = new Date(t)
  day.setHours(0, 0, 0, 0)

  return day.getTime()
}

function addDays(t: number, n: number): number {
  const day = new Date(t)
  day.setDate(day.getDate() + n)

  return day.getTime()
}

/** Whether a day mark belongs to the weekly window that resets at `resetsAt`. */
function isOf(mark: DayMark, resetsAt: number): boolean {
  return Math.abs(mark.resetsAt - resetsAt) < SAME_WINDOW
}

/** The local date of `t` as YYYY-MM-DD, the key its marks are kept under. */
export function dateKey(t: number): string {
  const day = new Date(t)
  const month = String(day.getMonth() + 1).padStart(2, '0')
  const date = String(day.getDate()).padStart(2, '0')

  return `${day.getFullYear()}-${month}-${date}`
}

/** A day's budget: a seventh of the weekly limit, or a fifth on a workday and none at the weekend. */
export function budgetOn(t: number, mode: PaceMode): number {
  if (mode === 'week') {
    return 100 / 7
  }
  const day = new Date(t).getDay()

  return day === 0 || day === 6 ? 0 : 20
}

/**
 * Adds one reading of the weekly window to the day marks. A mark keeps the
 * percent the day started from and the most it reached, so readings from
 * several sessions merge in any order. `since` is when tracking began: a
 * window that started after it is counted from 0, an older one from its
 * last mark, or from this reading when there is none.
 */
export function record(
  days: DayMarks,
  used: number,
  resetsAt: number,
  at: number,
  since: number,
): DayMarks {
  const key = dateKey(at)
  const isSame = (mark: DayMark) => isOf(mark, resetsAt)
  const today = days[key] ?? []
  const known = today.find(isSame)
  let marks: DayMark[]
  if (known) {
    marks = today.map(mark => (mark === known ? { ...mark, high: Math.max(mark.high, used) } : mark))
  } else {
    const before = Object.keys(days)
      .filter(other => other < key)
      .sort()
      .reverse()
      .map(other => (days[other] ?? []).find(isSame))
      .find(mark => mark !== undefined)
    const low = before ? before.high : since <= resetsAt - WEEK ? 0 : used
    marks = [...today, { resetsAt, low: Math.min(low, used), high: used }]
  }
  const oldest = dateKey(addDays(at, -KEEP_DAYS))

  return Object.fromEntries([
    ...Object.entries(days).filter(([other]) => other >= oldest && other !== key),
    [key, marks],
  ])
}

/**
 * What one local date spent of the weekly limit, of the window that resets at
 * `resetsAt` when given; 0 when nothing was read that day.
 */
export function spentOn(days: DayMarks, key: string, resetsAt?: number): number {
  return (days[key] ?? [])
    .filter(mark => resetsAt === undefined || isOf(mark, resetsAt))
    .reduce((sum, mark) => sum + Math.max(0, mark.high - mark.low), 0)
}

/**
 * Shares out `used` percent over the local dates of `minutes`, a weight per
 * minute start, in proportion to the weights.
 */
export function spread(minutes: Record<string, unknown>, used: number): Record<string, number> {
  const weights = Object.entries(minutes).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0,
  )
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  const days: Record<string, number> = {}
  for (const [minute, weight] of weights) {
    const key = dateKey(Number(minute))
    days[key] = (days[key] ?? 0) + (used * weight) / total
  }

  return days
}

/**
 * The 7 days the weekly window that resets at `resetsAt` is paced over, from
 * the date it starts on (the next one when it starts after noon): each day's
 * budget and what it spent of this window alone, with the estimate for the
 * time before tracking began when it was made for this window and this start.
 * The hours of the window before the first day's date count to the first day,
 * those after the last day's date (up to the reset) to the last.
 */
export function windowWeek(
  days: DayMarks,
  resetsAt: number,
  now: number,
  mode: PaceMode,
  since: number | null,
  estimate: Estimate | null = null,
): WeekDay[] {
  const start = resetsAt - WEEK
  const first = startOfDay(start + 12 * HOUR)
  const firstKey = dateKey(first)
  const lastKey = dateKey(addDays(first, 6))
  const keys = Array.from({ length: 7 }, (_, i) => dateKey(addDays(first, i)))
  const dayOf = (key: string) => (key <= firstKey ? 0 : key >= lastKey ? 6 : keys.indexOf(key))
  const isInWindow = (key: string) => key >= dateKey(start) && key <= dateKey(resetsAt)
  const guess =
    since !== null && estimate?.since === since && Math.abs(estimate.from - start) < SAME_WINDOW
      ? estimate
      : null
  const knownFrom = since === null ? null : Math.min(since, guess?.from ?? since)

  const spent = keys.map(() => 0)
  for (const key of Object.keys(days).filter(isInWindow)) {
    spent[dayOf(key)] = (spent[dayOf(key)] ?? 0) + spentOn(days, key, resetsAt)
  }
  for (const [key, share] of Object.entries(guess?.days ?? {}).filter(([key]) => isInWindow(key))) {
    spent[dayOf(key)] = (spent[dayOf(key)] ?? 0) + share
  }

  return keys.map((_, i) => {
    const date = addDays(first, i)
    const from = i === 0 ? start : date
    const to = i === 6 ? resetsAt : addDays(first, i + 1)

    return {
      label: weekday(date),
      budget: budgetOn(date, mode),
      spent: spent[i] ?? 0,
      isToday: from <= now && now < to,
      isFuture: from > now,
      isUnknown: knownFrom === null || to <= knownFrom,
      isEstimated: guess !== null && since !== null && from < since && to > guess.from,
    }
  })
}

/** A day that has a budget to fill: a counted day since tracking began. */
function isBudgeted(day: WeekDay): boolean {
  return day.budget > 0 && !day.isUnknown
}

/**
 * Where the week stands: what it spent so far, and the budget of every
 * budgeted day up to and including today. A day that spent less leaves the
 * rest to the days after it, so `left` is what today may still spend.
 */
export function weekPace(week: WeekDay[]): { spent: number; budget: number; left: number } {
  const spent = week.reduce((sum, day) => sum + day.spent, 0)
  const budget = week
    .filter(day => isBudgeted(day) && !day.isFuture)
    .reduce((sum, day) => sum + day.budget, 0)

  return { spent, budget, left: budget - spent }
}

/**
 * A limit's week in up to `columns` cells, reset to reset: a segment for each
 * of its seven days, all as wide and an odd number of cells, so a three-letter
 * day sits centred, with as many blank cells between each; the cells left over
 * go after the last. What the week spent fills the days with a budget from the
 * first on, so a day that spent less is topped up before the next one fills; a
 * day with no budget (the weekend, by workdays) stays gray.
 */
export function weekSegments(week: WeekDay[], columns: number): Segment[] {
  const widest = Math.max(1, Math.floor((columns - (week.length - 1)) / week.length))
  const cells = widest > 3 && widest % 2 === 0 ? widest - 1 : widest
  const gap = Math.max(1, Math.floor((columns - week.length * cells) / Math.max(1, week.length - 1)))
  const { spent } = weekPace(week)
  let from = 0

  return week.map((day, i) => {
    const isCounted = isBudgeted(day)
    const part = isCounted ? Math.min(1, Math.max(0, (spent - from) / day.budget)) : 0
    if (isCounted) {
      from += day.budget
    }
    const filled = Math.round(part * cells)

    return {
      label: day.isEstimated ? `~${day.label}` : day.label,
      space: i === 0 ? 0 : gap,
      cells,
      filled,
      isOver: day.isFuture && filled > 0,
      isToday: day.isToday,
      isDim: !isCounted,
      isOff: day.budget === 0,
    }
  })
}

/**
 * The weekly window as of `now`. A reading taken before its reset stands for a
 * window that has since started over, so it counts as fresh and unused.
 */
export function currentWeek(
  week: UsageWindow,
  now: number,
): { used: number; resetsAt: number; isRolled: boolean } | null {
  const resetsAt = week.resetsAt === undefined ? NaN : Date.parse(week.resetsAt)
  if (Number.isNaN(resetsAt)) {
    return null
  }
  if (resetsAt > now) {
    return { used: week.percentUsed, resetsAt, isRolled: false }
  }
  const weeks = Math.floor((now - resetsAt) / WEEK) + 1

  return { used: 0, resetsAt: resetsAt + weeks * WEEK, isRolled: true }
}

/** The 5-hour window as of `now`: once it has reset, nothing is used until the next message. */
export function currentSession(
  session: UsageWindow,
  now: number,
): { used: number; resetsAt: number | null } {
  const resetsAt = session.resetsAt === undefined ? NaN : Date.parse(session.resetsAt)
  if (Number.isNaN(resetsAt)) {
    return { used: session.percentUsed, resetsAt: null }
  }

  return resetsAt > now ? { used: session.percentUsed, resetsAt } : { used: 0, resetsAt: null }
}

/** The label centred in a segment's cells, cut to fit. */
export function segmentText(segment: Segment): string {
  const label = segment.label.slice(0, segment.cells)
  const before = Math.floor((segment.cells - label.length) / 2)

  return ' '.repeat(before) + label + ' '.repeat(segment.cells - label.length - before)
}

/** Drawn over the letter before it, taking no cell of its own: a line through that letter. */
const STROKE = String.fromCharCode(0x0336)

/**
 * `text` with a line through each of its letters, as many cells wide as it
 * was. The line is a character and not the strikethrough style, which some
 * terminals (Apple's) leave out.
 */
export function crossed(text: string): string {
  return text.replace(/\S/gu, letter => letter + STROKE)
}

/**
 * The cell, counted from the bar's start, under the middle of today's name:
 * where the mark for today goes on the row below. Null when no segment is today.
 */
export function todayAt(segments: readonly Segment[]): number | null {
  let at = 0
  for (const segment of segments) {
    at += segment.space
    if (segment.isToday) {
      const label = segment.label.slice(0, segment.cells)

      return at + Math.floor((segment.cells - label.length) / 2) + Math.floor(label.length / 2)
    }
    at += segment.cells
  }

  return null
}

/** A percentage with at most one decimal: 14.3%, 20%. */
export function percent(n: number): string {
  const rounded = Math.round(n * 10) / 10

  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

/** A span of time as the screenshot words it: 6d 3h, 4h 12m, 9m. */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }
  if (hours > 0) {
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
  }

  return `${rest}m`
}

/** The local weekday and time of `t`: Thu 10:00. */
export function clockLabel(t: number): string {
  const at = new Date(t)
  const hh = String(at.getHours()).padStart(2, '0')
  const mm = String(at.getMinutes()).padStart(2, '0')

  return `${weekday(t)} ${hh}:${mm}`
}
