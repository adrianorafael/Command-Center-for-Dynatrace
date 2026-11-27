/**
 * Calendar-week math for the on-call week view (pure, no DOM, no React).
 *
 * A week always runs Sunday → Saturday in the display time zone. "Workdays only" shows
 * Monday → Friday of the same week; because those five days are contiguous, it is just a
 * shorter [from, to) and never needs a segment to be split around hidden days.
 *
 * Day boundaries come from `zonedToUtc(day, 0, tz)` for every day, never from "+24 h":
 * a day that contains a DST change lasts 23 or 25 hours, and in zones whose clocks jump
 * at midnight (America/Santiago in September) the day starts at 01:00 local.
 */
import { addDays, civilDate, civilWeekday, safeTimeZone, zonedToUtc, type CivilDate } from "./tz";

/** One visible day column: its civil date and its [start, end) instants in the display zone. */
export interface WeekDay {
  date: CivilDate;
  /** "YYYY-MM-DD", stable key for React and URLs. */
  key: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  start: number;
  end: number;
}

/** Horizontal placement of a span inside the visible days, as fractions (0…1) of the full width. */
export interface DaySpan {
  left: number;
  width: number;
}

/** "YYYY-MM-DD" for a civil date (URL format of `?week=`). */
export function formatCivilDate(d: CivilDate): string {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/**
 * Strict "YYYY-MM-DD" parser: rejects other shapes and impossible dates such as 2026-02-31
 * (which `Date.UTC` would silently roll into March). Undefined when invalid.
 */
export function parseCivilDate(value: string | null | undefined): CivilDate | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const back = addDays(d, 0);
  return back.year === d.year && back.month === d.month && back.day === d.day ? d : undefined;
}

/** The Sunday that starts the week containing civil date `d`. */
export function weekStartOfDate(d: CivilDate): CivilDate {
  return addDays(d, -civilWeekday(d));
}

/** The Sunday that starts the week containing instant `ts`, in `timeZone`. */
export function weekStartAt(ts: number, timeZone: string): CivilDate {
  return weekStartOfDate(civilDate(ts, safeTimeZone(timeZone)));
}

/** The Sunday `weeks` weeks after (negative: before) `sunday`. */
export function addWeeks(sunday: CivilDate, weeks: number): CivilDate {
  return addDays(sunday, weeks * 7);
}

/**
 * Week shown for a `?week=` value: any valid date selects the week that contains it, so a
 * shared link with a mid-week date still works; a missing or malformed value is the current week.
 */
export function resolveWeekParam(param: string | null | undefined, now: number, timeZone: string): CivilDate {
  const d = parseCivilDate(param);
  return d ? weekStartOfDate(d) : weekStartAt(now, timeZone);
}

/**
 * The visible day columns of the week starting `sunday`: Sunday → Saturday, or Monday → Friday
 * when `workdaysOnly`. Each day's [start, end) is computed in `timeZone` (DST-safe).
 */
export function weekDays(sunday: CivilDate, timeZone: string, workdaysOnly = false): WeekDay[] {
  const tz = safeTimeZone(timeZone);
  const out: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    if (workdaysOnly && (i === 0 || i === 6)) continue;
    const date = addDays(sunday, i);
    out.push({
      date,
      key: formatCivilDate(date),
      weekday: civilWeekday(date),
      start: zonedToUtc(date, 0, tz),
      end: zonedToUtc(addDays(date, 1), 0, tz),
    });
  }
  return out;
}

/** [from, to) covered by the visible days (they are always contiguous). */
export function daysRange(days: readonly WeekDay[]): { from: number; to: number } {
  const first = days[0];
  const last = days[days.length - 1];
  return first && last ? { from: first.start, to: last.end } : { from: 0, to: 0 };
}

/**
 * Horizontal position (0…1) of instant `ts` when every visible day gets the same width.
 * Within a day the position is linear in time, so a 25-hour day is drawn a little denser
 * instead of pushing the following columns out of line with their headers. Clamped to the range.
 */
export function positionIn(ts: number, days: readonly WeekDay[]): number {
  const n = days.length;
  if (n === 0) return 0;
  if (ts <= days[0].start) return 0;
  for (let i = 0; i < n; i++) {
    const d = days[i];
    if (ts < d.end) return (i + (ts - d.start) / (d.end - d.start)) / n;
  }
  return 1;
}

/** True when `ts` falls inside the visible days (drives the "Now" marker). */
export function isInDays(ts: number, days: readonly WeekDay[]): boolean {
  const { from, to } = daysRange(days);
  return ts >= from && ts < to;
}

/** Placement of [from, to) clipped to the visible days; undefined when it does not overlap them. */
export function placeSpan(from: number, to: number, days: readonly WeekDay[]): DaySpan | undefined {
  const r = daysRange(days);
  const a = Math.max(from, r.from);
  const b = Math.min(to, r.to);
  if (!(b > a)) return undefined;
  const left = positionIn(a, days);
  return { left, width: positionIn(b, days) - left };
}

/** "Nov 22 – 28, 2026" / "Nov 29 – Dec 5, 2026" / "Dec 27, 2026 – Jan 2, 2027" for the visible days. */
export function formatDaysRange(days: readonly WeekDay[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  // Formatted from the civil date at noon UTC: the label never depends on the runtime zone.
  const at = (d: WeekDay) => Date.UTC(d.date.year, d.date.month - 1, d.date.day, 12);
  const f = (d: WeekDay, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...o, timeZone: "UTC" }).format(at(d));
  if (first.date.year !== last.date.year) return `${f(first, { month: "short", day: "numeric", year: "numeric" })} – ${f(last, { month: "short", day: "numeric", year: "numeric" })}`;
  if (first.date.month !== last.date.month) return `${f(first, { month: "short", day: "numeric" })} – ${f(last, { month: "short", day: "numeric" })}, ${last.date.year}`;
  return `${f(first, { month: "short", day: "numeric" })} – ${last.date.day}, ${last.date.year}`;
}

/** Years the date picker may navigate to; anything else is a year still being typed ("0002"). */
export const PICKER_MIN_YEAR = 1970;
export const PICKER_MAX_YEAR = 2199;

/**
 * Civil date chosen in a Strato `DateTimePicker type="date"` (a string or a `TimeValue`).
 * With `type="date"` the picker reports a plain "YYYY-MM-DD" (seen in Strato 3.18), which is
 * read as is. The picker otherwise works in the platform user's zone, which can differ from the
 * display zone, so an ISO text with an explicit offset also keeps its own local date; only a UTC
 * "Z" timestamp is converted, in `fallbackTimeZone`. Undefined for empty, invalid or implausible
 * values (years outside PICKER_MIN_YEAR…PICKER_MAX_YEAR are a year still being typed).
 */
export function pickedCivilDate(value: unknown, fallbackTimeZone: string): CivilDate | undefined {
  let text: string | undefined;
  if (typeof value === "string") text = value;
  else if (value && typeof value === "object" && "absoluteDate" in value) text = String((value as { absoluteDate: unknown }).absoluteDate);
  if (!text) return undefined;
  text = text.trim();
  const local = /^(\d{4}-\d{2}-\d{2})(?:$|T[\d:.]+(?:[+-]\d{2}:?\d{2})$)/.exec(text);
  const ts = local ? undefined : Date.parse(text);
  const d = local ? parseCivilDate(local[1]) : Number.isFinite(ts) ? civilDate(ts as number, safeTimeZone(fallbackTimeZone)) : undefined;
  return d && d.year >= PICKER_MIN_YEAR && d.year <= PICKER_MAX_YEAR ? d : undefined;
}
