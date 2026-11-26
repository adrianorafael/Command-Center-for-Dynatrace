/**
 * IANA time-zone helpers built on Intl.DateTimeFormat (no DOM, no external tz data).
 *
 * Conventions:
 * - Instants are epoch milliseconds.
 * - A "civil date" is {year, month (1-12), day} in some zone.
 * - Local-to-instant conversion is DST-correct:
 *   - spring-forward gap (local time does not exist): resolved forward by the gap length
 *     (Berlin 2026-03-29 02:30 → 03:30 CEST), the usual "shift forward" behaviour;
 *   - autumn overlap (local time occurs twice): the earlier instant is used.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** True if the runtime knows this IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Zone to use when `timeZone` is unknown/empty. */
export function safeTimeZone(timeZone: string | undefined, fallback = "UTC"): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : fallback;
}

/** Wall-clock parts of instant `ts` in `timeZone`. */
export function zonedParts(ts: number, timeZone: string): ZonedParts {
  const parts = formatter(safeTimeZone(timeZone)).formatToParts(new Date(ts));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";
  let hour = Number(get("hour"));
  // Some engines print midnight as "24" even with h23.
  if (hour === 24) hour = 0;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at instant `ts`, in ms (Berlin winter → +3 600 000). */
export function zoneOffsetMs(ts: number, timeZone: string): number {
  const p = zonedParts(ts, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const flooredTs = Math.floor(ts / 1000) * 1000;
  return asUtc - flooredTs;
}

/**
 * Instant for a wall-clock time in a zone (DST-correct; see module notes for gaps/overlaps).
 * `minuteOfDay` may exceed 1440 or be negative; it rolls into adjacent days.
 */
export function zonedToUtc(date: CivilDate, minuteOfDay: number, timeZone: string): number {
  const tz = safeTimeZone(timeZone);
  const local = Date.UTC(date.year, date.month - 1, date.day) + minuteOfDay * MINUTE_MS;
  const before = zoneOffsetMs(local - 14 * HOUR_MS, tz);
  const after = zoneOffsetMs(local + 14 * HOUR_MS, tz);
  const candidates: number[] = [];
  for (const off of before === after ? [before] : [before, after]) {
    const t = local - off;
    if (zoneOffsetMs(t, tz) === off) candidates.push(t);
  }
  if (candidates.length > 0) return Math.min(...candidates);
  // Gap: the local time does not exist; interpret with the pre-transition offset (moves forward).
  return local - before;
}

/** Civil date of instant `ts` in `timeZone`. */
export function civilDate(ts: number, timeZone: string): CivilDate {
  const p = zonedParts(ts, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Add whole days to a civil date (calendar arithmetic, zone-independent). */
export function addDays(d: CivilDate, days: number): CivilDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

/** Weekday of a civil date, 0 = Sunday. */
export function civilWeekday(d: CivilDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** Weekday of instant `ts` in `timeZone`, 0 = Sunday. */
export function weekdayInZone(ts: number, timeZone: string): number {
  return zonedParts(ts, timeZone).weekday;
}

/** Minutes since local midnight (0…1439) of instant `ts` in `timeZone`. */
export function minuteOfDayInZone(ts: number, timeZone: string): number {
  const p = zonedParts(ts, timeZone);
  return p.hour * 60 + p.minute;
}

/** Parse 'HH:mm' (00:00…24:00) to minutes; undefined when malformed. */
export function parseHHmm(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return undefined;
  return h * 60 + min;
}

/** Format minutes-of-day as 'HH:mm'. */
export function formatHHmm(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Instant of 'HH:mm' on the civil date of `ts` in `timeZone`. */
export function localTimeOnDay(ts: number, hhmm: string, timeZone: string): number {
  return zonedToUtc(civilDate(ts, timeZone), parseHHmm(hhmm) ?? 0, timeZone);
}

/** Start of the local day containing `ts`. */
export function startOfLocalDay(ts: number, timeZone: string): number {
  return zonedToUtc(civilDate(ts, timeZone), 0, timeZone);
}

/** Format an instant as 'yyyy-mm-dd HH:mm' in a zone (for texts and logs). */
export function formatZoned(ts: number, timeZone: string): string {
  const p = zonedParts(ts, timeZone);
  const d = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return `${d} ${formatHHmm(p.hour * 60 + p.minute)}`;
}

/**
 * Is `ts` inside a weekly window {days, from, to} evaluated in `timeZone`?
 * `days` are the weekdays on which the window STARTS; `to <= from` means it crosses
 * midnight into the next day; `from === to` means the whole day.
 */
export function inWeeklyWindow(
  ts: number,
  win: { days: number[]; from: string; to: string },
  timeZone: string,
): boolean {
  const from = parseHHmm(win.from);
  const to = parseHHmm(win.to);
  if (from === undefined || to === undefined) return false;
  const p = zonedParts(ts, timeZone);
  const m = p.hour * 60 + p.minute;
  const days = win.days;
  if (from === to) return days.includes(p.weekday);
  if (from < to) return days.includes(p.weekday) && m >= from && m < to;
  const prev = (p.weekday + 6) % 7;
  return (days.includes(p.weekday) && m >= from) || (days.includes(prev) && m < to);
}
