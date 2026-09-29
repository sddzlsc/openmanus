/**
 * Minimal cron support for automatons: 5-field expressions plus the usual
 * shorthands. Fields are evaluated in the automation's own timezone, so a
 * "每天 09:00" job in Asia/Shanghai fires at 09:00 local time regardless of the
 * server's timezone.
 *
 * Supported: `*`, `a`, `a-b`, `*​/n`, `a-b/n`, comma lists, `@hourly`, `@daily`,
 * `@weekly`, `@monthly`. Not supported (deliberately): seconds, `L`, `W`, `#`.
 */

export interface ParsedCron {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
  /** true when the expression used `*` for day-of-month / day-of-week */
  domRestricted: boolean
  dowRestricted: boolean
}

const SHORTHANDS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
}

export function parseCron(expression: string): ParsedCron {
  const raw = expression.trim().toLowerCase()
  const normalized = SHORTHANDS[raw] ?? raw
  const fields = normalized.split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`cron 表达式需要 5 个字段（分 时 日 月 周），收到：${expression}`)
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]
  return {
    minutes: expand(minute, 0, 59),
    hours: expand(hour, 0, 23),
    daysOfMonth: expand(dom, 1, 31),
    months: expand(month, 1, 12),
    daysOfWeek: expand(dow.replace(/\b7\b/g, '0'), 0, 6),
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  }
}

function expand(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText ? Number(stepText) : 1
    if (!Number.isInteger(step) || step <= 0) throw new Error(`cron 步长非法：${part}`)
    let start = min
    let end = max
    if (range && range !== '*') {
      const [a, b] = range.split('-')
      start = Number(a)
      end = b === undefined ? start : Number(b)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
        throw new Error(`cron 区间非法：${part}`)
      }
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  if (values.size === 0) throw new Error(`cron 字段无有效取值：${field}`)
  return values
}

interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone)
  if (existing) return existing
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  })
  formatters.set(timeZone, formatter)
  return formatter
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(instant)
  const lookup: Record<string, string> = {}
  for (const part of parts) lookup[part.type] = part.value
  const hour = Number(lookup.hour === '24' ? '0' : lookup.hour)
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour,
    minute: Number(lookup.minute),
    weekday: WEEKDAYS[lookup.weekday ?? 'Sun'] ?? 0,
  }
}

/** Convert a wall-clock time in `timeZone` to the matching UTC instant. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  // offset = local wall clock at that instant − the instant, i.e. +8h for
  // Asia/Shanghai. Subtracting it converts wall clock back to UTC.
  const firstOffset = utcFromLocalParts(year, month, day, hour, minute, timeZone, guess) - guess
  let candidate = guess - firstOffset
  // Recompute the offset at the candidate instant (DST boundaries differ).
  const secondOffset = utcFromLocalParts(year, month, day, hour, minute, timeZone, candidate) - candidate
  if (secondOffset !== firstOffset) candidate = guess - secondOffset
  return new Date(candidate)
}

function utcFromLocalParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
  instant: number,
): number {
  const parts = localParts(new Date(instant), timeZone)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
}

export function matches(parsed: ParsedCron, parts: LocalParts): boolean {
  if (!parsed.minutes.has(parts.minute)) return false
  if (!parsed.hours.has(parts.hour)) return false
  if (!parsed.months.has(parts.month)) return false
  const domMatch = parsed.daysOfMonth.has(parts.day)
  const dowMatch = parsed.daysOfWeek.has(parts.weekday)
  // Standard cron semantics: when both day fields are restricted, either may match.
  if (parsed.domRestricted && parsed.dowRestricted) return domMatch || dowMatch
  if (parsed.domRestricted) return domMatch
  if (parsed.dowRestricted) return dowMatch
  return true
}

/** Next instant strictly after `from` that satisfies the expression. */
export function nextRun(expression: string, timeZone: string, from: Date = new Date()): Date {
  const parsed = parseCron(expression)
  const start = localParts(new Date(from.getTime() + 60_000), timeZone)
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day))
  for (let dayOffset = 0; dayOffset <= 366; dayOffset += 1) {
    const dayDate = new Date(cursor.getTime() + dayOffset * 86_400_000)
    const year = dayDate.getUTCFullYear()
    const month = dayDate.getUTCMonth() + 1
    const day = dayDate.getUTCDate()
    if (!parsed.months.has(month)) continue
    const weekday = dayDate.getUTCDay()
    const domMatch = parsed.daysOfMonth.has(day)
    const dowMatch = parsed.daysOfWeek.has(weekday)
    const dayMatches =
      parsed.domRestricted && parsed.dowRestricted
        ? domMatch || dowMatch
        : parsed.domRestricted
          ? domMatch
          : parsed.dowRestricted
            ? dowMatch
            : true
    if (!dayMatches) continue

    for (const hour of [...parsed.hours].sort((a, b) => a - b)) {
      for (const minute of [...parsed.minutes].sort((a, b) => a - b)) {
        const candidate = zonedTimeToUtc(year, month, day, hour, minute, timeZone)
        if (candidate.getTime() > from.getTime()) return candidate
      }
    }
  }
  throw new Error(`无法在一年内找到下一次执行时间：${expression} (${timeZone})`)
}

export function describeCron(expression: string): string {
  const raw = expression.trim().toLowerCase()
  if (SHORTHANDS[raw]) {
    const map: Record<string, string> = {
      '@hourly': '每小时',
      '@daily': '每天 00:00',
      '@midnight': '每天 00:00',
      '@weekly': '每周日 00:00',
      '@monthly': '每月 1 日 00:00',
      '@yearly': '每年 1 月 1 日 00:00',
      '@annually': '每年 1 月 1 日 00:00',
    }
    return map[raw] ?? raw
  }
  const [minute, hour] = raw.split(/\s+/)
  if (minute?.startsWith('*/') && hour === '*') return `每 ${minute.slice(2)} 分钟`
  if (/^\d+$/.test(minute ?? '') && /^\d+$/.test(hour ?? '')) {
    return `每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }
  return expression
}
