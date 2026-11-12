/** How the weekly limit is spread: over all 7 days, or over Monday to Friday. */
export type PaceMode = 'week' | 'workdays'

/** One rate-limit window as last reported: percent used and when it resets. */
export type UsageWindow = { percentUsed: number; resetsAt?: string }

/** The two windows from one reading, and when it was taken. */
export type UsageReading = {
  session: UsageWindow | null
  week: UsageWindow | null
  at: number
}

/**
 * What one local day saw of one weekly window: the percent used when the day
 * started and the most it reached that day.
 */
export type DayMark = { resetsAt: number; low: number; high: number }

/** Each local date's marks, keyed YYYY-MM-DD; two on the day the window resets. */
export type DayMarks = Record<string, DayMark[]>

/**
 * What the days before tracking began spent, estimated from the transcripts:
 * the weekly percent used when tracking began (`since`), shared out over the
 * local dates from the window's start (`from`) by what each one's replies weighed.
 */
export type Estimate = { since: number; from: number; days: Record<string, number> }

declare module 'claude-code' {
  interface PluginState {
    'usage-pace': {
      reading: UsageReading | null
      mode: PaceMode
      now: number
      days: DayMarks
      since: number | null
      estimate: Estimate | null
      isHidden: boolean
    }
  }
}
