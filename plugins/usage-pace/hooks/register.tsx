import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { DayMarks, Estimate, PaceMode, UsageReading, UsageWindow } from '../types'
import {
  clockLabel,
  crossed,
  currentSession,
  currentWeek,
  dateKey,
  duration,
  percent,
  record,
  segmentText,
  spread,
  todayAt,
  weekPace,
  weekSegments,
  windowWeek,
  WEEK,
} from './pace'
import type { Segment } from './pace'

const PANE = 'usage-pace'
const TITLE = 'Usage'
const MINUTE = 60_000
const WIDEST = 72
/** The band's widest: room for five cells a day, a day's name centred with a space either side. */
const BAND_WIDEST = 80
/**
 * The mark for today: under its day in the pane, and before it in the band,
 * which keeps to two lines. Its color is the theme's blue, apart from the
 * bar's green, amber and gray.
 */
const TODAY = '▲'
const TODAY_BEFORE = '▸'
const TODAY_COLOR = 'suggestion'
const LABEL = 8
/** The command, as it is typed. */
const COMMAND = 'usage-pace'
const HIDDEN = `Usage hidden; /${COMMAND} shows it again.`
/** The band's switch, worded short, and the cells it takes after the week's figures: a space before each mode. */
const SHORT = { week: '7d', workdays: '5d' } as const
const SWITCH = 6
/** The cells the × takes after a line: a space, and itself. */
const CLOSE = 2

const reading = atom({ plugin: 'usage-pace', key: 'reading' } as const, null)
const mode = atom({ plugin: 'usage-pace', key: 'mode' } as const, 'week')
const now = atom({ plugin: 'usage-pace', key: 'now' } as const, 0)
const days = atom({ plugin: 'usage-pace', key: 'days' } as const, {})
const since = atom({ plugin: 'usage-pace', key: 'since' } as const, null)
const estimated = atom({ plugin: 'usage-pace', key: 'estimate' } as const, null)
const isHidden = atom({ plugin: 'usage-pace', key: 'isHidden' } as const, false)

let isEstimating = false

/** A band line's figure and the words after it: in full, or cut for a narrow band. */
type Side = { figure: string; long: string; short: string; color?: 'success' | 'warning' }

function modeOf(word: string): PaceMode | null {
  switch (word) {
    case 'week':
    case '7':
      return 'week'
    case 'workdays':
    case '5':
      return 'workdays'
    default:
      return null
  }
}

/** What picking a way to pace the week answers with. */
function pacing(picked: PaceMode): string {
  return `Pacing the week over ${picked === 'week' ? '7 days' : '5 workdays'}.`
}

function windowOf(limits: readonly SessionRateLimit[], kind: string): UsageWindow | null {
  const limit = limits.find(one => one.kind === kind)

  return limit ? { percentUsed: limit.percentUsed, resetsAt: limit.resetsAt } : null
}

function isReading(value: unknown): value is UsageReading {
  return typeof value === 'object' && value !== null && typeof (value as UsageReading).at === 'number'
}

function isMarks(value: unknown): value is DayMarks {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEstimate(value: unknown): value is Estimate {
  return typeof value === 'object' && value !== null && typeof (value as Estimate).since === 'number'
}

/** The cells a band line's figure and words take. */
function sideWidth(sides: readonly Side[], form: 'long' | 'short'): number {
  return Math.max(...sides.map(side => side.figure.length + (side[form] ? 3 + side[form].length : 0)))
}

async function take($: EngineInterface, limits: readonly SessionRateLimit[]) {
  const at = await $.clock.now()
  const freshSession = windowOf(limits, 'five_hour')
  const week = windowOf(limits, 'seven_day')
  if (!freshSession && !week) {
    return
  }
  // A reading can leave a window out (the 5-hour one right after it resets): keep its last figures.
  const last = await read($, reading)
  const fresh: UsageReading = {
    session: freshSession ?? last?.session ?? null,
    week: week ?? last?.week ?? null,
    at,
  }
  await update($, reading, () => fresh)
  await update($, now, () => at)
  await $.store.set('reading', fresh)

  const resetsAt = week?.resetsAt === undefined ? NaN : Date.parse(week.resetsAt)
  if (!week || Number.isNaN(resetsAt)) {
    return
  }
  const keptSince = await $.store.get('since')
  const began = typeof keptSince === 'number' ? keptSince : at
  if (typeof keptSince !== 'number') {
    await $.store.set('since', began)
    $.clock.after(1_000, () => void estimate($))
  }
  // The store, not this session's state: other sessions add to the same marks.
  const kept = await $.store.get('days')
  const marks = record(isMarks(kept) ? kept : {}, week.percentUsed, resetsAt, at, began)
  await $.store.set('days', marks)
  await update($, days, () => marks)
  await update($, since, () => began)
}

async function pick($: EngineInterface, picked: PaceMode) {
  await update($, mode, () => picked)
  await $.store.set('mode', picked)
}

async function hide($: EngineInterface, value: boolean) {
  await update($, isHidden, () => value)
  await $.store.set('isHidden', value)
}

/**
 * Estimates what the days before tracking began spent: the weekly percent
 * used when it began, shared out by what the transcripts' replies weighed.
 * Made once per tracking start and kept.
 */
async function estimate($: EngineInterface) {
  const began = await $.store.get('since')
  const kept = await $.store.get('estimate')
  if (typeof began !== 'number' || isEstimating) {
    return
  }
  if (isEstimate(kept) && kept.since === began) {
    await update($, estimated, () => kept)

    return
  }
  const marks = await $.store.get('days')
  const first = (isMarks(marks) ? (marks[dateKey(began)] ?? []) : []).find(
    mark => mark.resetsAt - WEEK < began && began < mark.resetsAt,
  )
  if (!first) {
    return
  }
  const from = first.resetsAt - WEEK
  isEstimating = true
  try {
    const script = `${$.plugin.root}/tools/weigh.py`
    // Run from the mod's own folder, not the session's: the script reads only
    // the transcripts, and where a system looks in the working folder first for
    // a program (Windows), a python3 placed in a project must not be the one run.
    const ran = await $.process.run(['python3', '-I', script, String(from), String(began)], {
      cwd: $.plugin.root,
      timeoutMs: 120_000,
    })
    if (ran.exitCode !== 0) {
      $.ui.log(`usage-pace: weighing the transcripts failed: ${ran.stderr.slice(0, 500)}`, { to: 'debug' })

      return
    }
    const fresh: Estimate = { since: began, from, days: spread(JSON.parse(ran.stdout), first.low) }
    await $.store.set('estimate', fresh)
    await update($, estimated, () => fresh)
  } catch (error) {
    $.ui.log(`usage-pace: weighing the transcripts failed: ${String(error)}`, { to: 'debug' })
  } finally {
    isEstimating = false
  }
}

/**
 * Brings the clock, and the reading and day marks other sessions wrote, into
 * this session's state.
 */
async function sync($: EngineInterface) {
  const t = await $.clock.now()
  await update($, now, () => t)
  const stored = await $.store.get('reading')
  const current = await read($, reading)
  if (isReading(stored) && stored.at > (current?.at ?? 0)) {
    await update($, reading, () => stored)
  }
  const kept = await $.store.get('days')
  if (isMarks(kept)) {
    await update($, days, () => kept)
  }
  const keptSince = await $.store.get('since')
  if (typeof keptSince === 'number') {
    await update($, since, () => keptSince)
  }
}

function isSameWindow(a: UsageWindow, b: UsageWindow | null): boolean {
  return a.percentUsed === b?.percentUsed && a.resetsAt === b.resetsAt
}

/**
 * The Update now button. Claude Code learns usage only from its own replies,
 * so this takes the newest figures there are: the engine's (it reports a move
 * under a whole point to no hook), another session's saved reading, the day
 * marks; and it retries the estimate.
 */
async function refresh($: EngineInterface) {
  const held = await read($, reading)
  const limits = (await $.session.usage()).rateLimits
  const session = windowOf(limits, 'five_hour')
  const week = windowOf(limits, 'seven_day')
  const isMoved =
    (session !== null && !isSameWindow(session, held?.session ?? null)) ||
    (week !== null && !isSameWindow(week, held?.week ?? null))
  if (isMoved) {
    await take($, limits)
  }
  await sync($)
  await estimate($)
  const after = await read($, reading)
  $.ui.toast(
    after !== null && after.at !== held?.at
      ? 'Usage updated.'
      : 'Already up to date: Claude Code gets new usage figures with each reply.',
  )
}

/** What the band and the pane draw from, as of the later of the clock and the reading. */
async function figures($: EngineInterface) {
  const r = await read($, reading)
  if (r === null) {
    return null
  }
  const t = Math.max(await read($, now), r.at)
  const tracked = await read($, since)
  const week = r.week ? currentWeek(r.week, t) : null
  const marks = await read($, days)
  const m = await read($, mode)
  const guess = await read($, estimated)
  // The limit's own week, from its last reset to its next.
  const calendar = week ? windowWeek(marks, week.resetsAt, t, m, tracked, guess) : []

  return {
    r,
    t,
    tracked,
    calendar,
    session: r.session ? currentSession(r.session, t) : null,
    week,
    today: calendar.find(day => day.isToday),
    soFar: weekPace(calendar),
  }
}

/**
 * The week's segments in `columns` cells, each day's label on what it filled
 * and what it left, and blank cells after them for what they leave over.
 * With `isPointed`, today's mark takes the blank cell before today; the first
 * day has none, so its mark is the caller's to draw before the bar.
 */
function weekBar(
  Text: ElementTable['Text'],
  segments: readonly Segment[],
  columns: number,
  isPointed = false,
) {
  const drawn = segments.reduce((sum, segment) => sum + segment.space + segment.cells, 0)
  const days = segments.map(segment => {
    const text = segmentText(segment)
    const weight = segment.isToday ? 'bold' : undefined
    const lettered = (part: string) => (segment.isOff ? crossed(part) : part)
    const isMarked = isPointed && segment.isToday && segment.space > 0

    return (
      <Text>
        {' '.repeat(segment.space - (isMarked ? 1 : 0))}
        {isMarked ? <Text color={TODAY_COLOR}>{TODAY_BEFORE}</Text> : ''}
        <Text backgroundColor={segment.isOver ? 'warning' : 'success'} color="inverseText" weight={weight}>
          {lettered(text.slice(0, segment.filled))}
        </Text>
        <Text backgroundColor="subtle" color={segment.isDim ? 'inactive' : 'text'} weight={weight}>
          {lettered(text.slice(segment.filled))}
        </Text>
      </Text>
    )
  })

  return [...days, <Text>{' '.repeat(Math.max(0, columns - drawn))}</Text>]
}

/**
 * A button for each way to pace the week, the one in use lit; a press picks
 * one. In the pane each is a chip, dotted and worded in full; in the band,
 * `isCompact`, two letters, and only the one in use has a background.
 */
function modeSwitch(
  Button: ElementTable['Button'],
  Text: ElementTable['Text'],
  current: PaceMode,
  onPick: (value: PaceMode) => unknown,
  isCompact = false,
) {
  return (['week', 'workdays'] as const).map(value => {
    const isOn = current === value
    const full = value === 'week' ? '7 days' : '5 workdays'

    return (
      <Button key={value} plain onPress={() => onPick(value)}>
        <Text
          backgroundColor={isOn ? 'success' : isCompact ? undefined : 'subtle'}
          color={isOn ? 'inverseText' : 'inactive'}
          weight={isOn ? 'bold' : undefined}
        >
          {isCompact ? SHORT[value] : ` ${isOn ? '●' : '○'} ${full} `}
        </Text>
      </Button>
    )
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show usage above the prompt, with a daily budget that lasts the week (7 days or 5 workdays)',
      argumentHint: '[week|workdays|full|hide]',
    })

    const kept = await $.store.get('mode')
    const keptMode = typeof kept === 'string' ? modeOf(kept) : null
    if (keptMode) {
      await update($, mode, () => keptMode)
    }
    if ((await $.store.get('isHidden')) === true) {
      await update($, isHidden, () => true)
    }
    const keptReading = await $.store.get('reading')
    if (isReading(keptReading) && (await read($, reading)) === null) {
      await update($, reading, () => keptReading)
    }
    await sync($)
    await take($, (await $.session.usage()).rateLimits)

    $.clock.every(MINUTE, () => void sync($))
    $.clock.after(1_000, () => void estimate($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await take($, e.rateLimits)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'full') {
      await $.ui.open({ id: PANE, title: TITLE })

      return { text: 'Usage pane opened.' }
    }
    if (word === 'hide') {
      await hide($, true)

      return { text: HIDDEN }
    }
    const picked = modeOf(word)
    if (word !== '' && picked === null) {
      return { text: `Usage: /${COMMAND} [week|workdays|full|hide]` }
    }
    if (picked) {
      await pick($, picked)
    }
    await hide($, false)

    return { text: picked ? pacing(picked) : 'Usage shown above the prompt.' }
  })

  // Two lines above the prompt, worded shorter and then left without bars as the band narrows.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    // The ×, the last of the `cells` it is given after a line.
    const closer = (cells: number) => (
      <Box marginLeft={cells - 1}>
        <Button
          key="close"
          plain
          label="×"
          role="dismiss"
          dimColor
          onPress={async () => {
            await hide($, true)
            $.ui.toast(HIDDEN)
          }}
        />
      </Box>
    )
    const f = await figures($)
    if (f === null) {
      return (
        <Box paddingTop={1}>
          <Text dimColor>Usage: no reading yet. Claude Code gets one with each reply.</Text>
          {closer(CLOSE)}
        </Box>
      )
    }
    const { r, t, session, week, calendar, soFar } = f

    const left = soFar.left >= 0 ? `${percent(soFar.left)} left` : `${percent(-soFar.left)} over`
    const sessionSide: Side | null =
      session === null
        ? null
        : session.resetsAt === null
          ? { figure: percent(session.used), long: 'starts with your next message', short: 'idle' }
          : {
              figure: percent(session.used),
              long: `resets in ${duration(session.resetsAt - t)}`,
              short: duration(session.resetsAt - t),
            }
    const weekSide: Side | null =
      r.week === null
        ? null
        : week === null
          ? { figure: percent(r.week.percentUsed), long: '', short: '' }
          : week.isRolled
            ? { figure: percent(week.used), long: 'a new week started', short: 'new week' }
            : {
                figure: percent(week.used),
                long: `today ${left}`,
                short: left,
                color: soFar.left >= 0 ? 'success' : 'warning',
              }
    const sides = [sessionSide, weekSide].filter((side): side is Side => side !== null)
    if (sides.length === 0) {
      return next(e)
    }

    // The wording and the bars' cells when `tail` cells are kept after the lines.
    const lay = (tail: number): { form: 'long' | 'short'; bar: number } => {
      const columns = Math.min(BAND_WIDEST, e.props.bodyColumns) - tail
      const room = (form: 'long' | 'short') => columns - LABEL - 1 - sideWidth(sides, form)
      // In full while the seven days keep three letters each, cut while each keeps
      // a cell; the gaps between them take a cell each.
      const form = room('long') >= 7 * 4 - 1 ? 'long' : 'short'

      return { form, bar: room(form) >= 7 * 2 - 1 ? room(form) : 0 }
    }
    // The switch ends the week's line, under the × that ends the first; with no
    // first line the × follows it. It takes its cells from the bars, and where
    // they would be left with too few, it goes and they stay.
    const switched = week ? lay(sessionSide ? SWITCH : SWITCH + CLOSE) : null
    const hasSwitch = switched !== null && switched.bar > 0
    const { form, bar } = switched !== null && switched.bar > 0 ? switched : lay(CLOSE)
    const width = sideWidth(sides, form)

    const words = (side: Side) => {
      const note = side[form]
      const used = side.figure.length + (note ? 3 + note.length : 0)

      return (
        <Text>
          {bar > 0 ? ' '.repeat(1 + width - used) : ''}
          {side.figure}
          {note ? ' · ' : ''}
          <Text color={side.color}>{note}</Text>
        </Text>
      )
    }
    const sessionFilled = session ? Math.round((Math.min(100, session.used) / 100) * bar) : 0
    const segments = weekSegments(calendar, bar)
    const m = await read($, mode)
    // The first day has no blank cell before it: its mark ends the label.
    const isFirstToday = week !== null && bar > 0 && segments[0]?.isToday === true

    return (
      <Box flexDirection="column" paddingTop={1}>
        {sessionSide && (
          <Box>
            <Text mono>
              {'Session'.padEnd(LABEL)}
              <Text color={session !== null && session.used >= 80 ? 'warning' : 'success'}>
                {'━'.repeat(sessionFilled)}
              </Text>
              <Text color="subtle">{'━'.repeat(bar - sessionFilled)}</Text>
              {words(sessionSide)}
            </Text>
            {closer(hasSwitch ? SWITCH : CLOSE)}
          </Box>
        )}
        {weekSide && (
          <Box>
            <Text mono>
              {'Week'.padEnd(LABEL - 1)}
              {isFirstToday ? <Text color={TODAY_COLOR}>{TODAY_BEFORE}</Text> : ' '}
              {bar === 0 ? '' : week ? weekBar(Text, segments, bar, true) : ' '.repeat(bar)}
              {words(weekSide)}
            </Text>
            {hasSwitch &&
              modeSwitch(
                Button,
                Text,
                m,
                async value => {
                  await pick($, value)
                  $.ui.toast(pacing(value))
                },
                true,
              ).map(chip => <Box marginLeft={1}>{chip}</Box>)}
            {sessionSide ? null : closer(CLOSE)}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const m = await read($, mode)
    const f = await figures($)
    const columns = Math.max(16, Math.min(WIDEST, e.props.bodyColumns))

    const row = (label: string, value: string, color?: 'success' | 'warning') => (
      <Box justifyContent="space-between">
        <Text>{label}</Text>
        <Text color={color}>{value}</Text>
      </Box>
    )

    const header = (
      <Box justifyContent="space-between" flexWrap="wrap">
        <Text weight="bold" dimColor>
          USAGE
        </Text>
        <Box>
          {modeSwitch(Button, Text, m, value => pick($, value))}
        </Box>
      </Box>
    )

    const updateNow = <Button key="update" label="Update now" onPress={() => refresh($)} />

    if (f === null) {
      return (
        <Box flexDirection="column" width={columns}>
          {header}
          <Box marginTop={1}>
            <Text dimColor>
              No usage reading yet. Claude Code gets one with each reply on a Pro or Max plan.
            </Text>
          </Box>
          <Box marginTop={1}>{updateNow}</Box>
        </Box>
      )
    }

    const { r, t, tracked, calendar, session, week, today, soFar } = f
    const sessionFilled = session ? Math.round((Math.min(100, session.used) / 100) * columns) : 0
    const segments = weekSegments(calendar, columns)
    const marked = todayAt(segments)
    const hasEstimate = calendar.some(day => day.isEstimated)
    const hasUnknown = calendar.some(day => day.isUnknown && !day.isFuture)
    const perDay = m === 'week' ? 100 / 7 : 20
    const per = m === 'week' ? 'a day' : 'a workday'
    const age = t - r.at

    return (
      <Box flexDirection="column" width={columns}>
        {header}

        {session && (
          <Box flexDirection="column" marginTop={1}>
            <Box justifyContent="space-between">
              <Text weight="bold">Session (5hr)</Text>
              <Text weight="bold">{percent(session.used)}</Text>
            </Box>
            <Text mono>
              <Text color={session.used >= 80 ? 'warning' : 'success'}>
                {'━'.repeat(sessionFilled)}
              </Text>
              <Text color="subtle">{'━'.repeat(columns - sessionFilled)}</Text>
            </Text>
            <Text dimColor>
              {session.resetsAt === null
                ? 'Starts with your next message'
                : `Resets in ${duration(session.resetsAt - t)}`}
            </Text>
          </Box>
        )}

        {week && (
          <Box flexDirection="column" marginTop={1}>
            <Box justifyContent="space-between">
              <Text weight="bold">Weekly (7 day)</Text>
              <Text weight="bold">{percent(week.used)}</Text>
            </Box>
            <Text mono>{weekBar(Text, segments, columns)}</Text>
            {marked !== null && (
              <Text mono>
                {' '.repeat(marked)}
                <Text color={TODAY_COLOR}>{TODAY}</Text>
              </Text>
            )}
            <Text dimColor>
              Resets in {duration(week.resetsAt - t)} · {clockLabel(week.resetsAt)}
            </Text>
          </Box>
        )}

        {week && today && (
          <Box flexDirection="column" marginTop={1}>
            {row(
              today.budget === 0 ? `Today · ${today.label} (day off)` : `Today · ${today.label}`,
              soFar.left >= 0 ? `${percent(soFar.left)} left` : `${percent(-soFar.left)} over`,
              soFar.left >= 0 ? 'success' : 'warning',
            )}
            {row(
              `Since the reset · ${clockLabel(week.resetsAt - WEEK)}`,
              `${percent(soFar.spent)} of ${percent(soFar.budget)}`,
            )}
            {row('Daily budget', `${percent(perDay)} ${per}`)}
          </Box>
        )}

        {week && hasEstimate && tracked !== null && (
          <Box marginTop={1}>
            <Text dimColor>
              ~ Before {clockLabel(tracked)}, estimated from your Claude Code logs.
            </Text>
          </Box>
        )}

        {week && hasUnknown && (
          <Box marginTop={1}>
            <Text dimColor>
              {tracked === null
                ? 'Day tracking starts with the next reply.'
                : `Days are tracked from ${clockLabel(tracked)}; earlier ones show nothing.`}
            </Text>
          </Box>
        )}

        {r.week && !week && (
          <Box marginTop={1}>
            <Text dimColor>Weekly {percent(r.week.percentUsed)}: no reset time to pace by.</Text>
          </Box>
        )}

        <Box marginTop={1} justifyContent="space-between" alignItems="center" flexWrap="wrap">
          <Text dimColor>
            {week?.isRolled
              ? 'A new week started; the next reply brings a fresh reading.'
              : age >= 2 * MINUTE
                ? `Updated ${duration(age)} ago`
                : 'Updated just now'}
          </Text>
          {updateNow}
        </Box>
      </Box>
    )
  })
}
