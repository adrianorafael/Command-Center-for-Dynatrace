import type { TimeValue } from "@dynatrace/strato-components/core";

/**
 * Resolve a Strato timeframe endpoint to a JS Date.
 * Handles: absolute ({ absoluteDate }), "now()", "now()-Xh/m/d",
 * "@d" (start of today), "-Xd@d" (snap-to-day offsets).
 *
 * Accepts both the Strato TimeValue object format { absoluteDate, value, type }
 * and plain string expressions used by preset shortcuts.
 */
export function parseTimeframeDate(
  val: TimeValue | string | null | undefined,
  endOfDay = false
): Date {
  if (val && typeof val === "object") {
    // TimeValue from TimeframeSelector: { absoluteDate, value, type }
    if (val.type === "iso8601") {
      // Absolute date selected by user — use as-is
      return new Date(val.absoluteDate);
    }
    // Expression (e.g. "now()-2h", "@d", "now()") — re-evaluate now to get current time
    return parseTimeframeDate(val.value, endOfDay);
  }
  const now = new Date();
  if (typeof val === "string") {
    if (val === "now()") return now;
    // "@d" = start of current day (optionally end)
    if (val === "@d") {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      if (endOfDay) d.setHours(23, 59, 59, 999);
      return d;
    }
    // "now()-Xm/h/d/w/M/y"
    const rel = val.match(/^now\(\)-(\d+)([smhdwMy])$/);
    if (rel) {
      const n = parseInt(rel[1]);
      const u = rel[2];
      const d = new Date(now);
      if (u === "s") d.setSeconds(d.getSeconds() - n);
      else if (u === "m") d.setMinutes(d.getMinutes() - n);
      else if (u === "h") d.setHours(d.getHours() - n);
      else if (u === "d") d.setDate(d.getDate() - n);
      else if (u === "w") d.setDate(d.getDate() - n * 7);
      else if (u === "M") d.setMonth(d.getMonth() - n);
      else if (u === "y") d.setFullYear(d.getFullYear() - n);
      return d;
    }
    // "-Xd@d" = offset + snap to day boundary (e.g. "-1d@d" = start of yesterday)
    const snap = val.match(/^(-?\d+)([smhdwMy])@([dwMy])$/);
    if (snap) {
      const n = parseInt(snap[1]);
      const u = snap[2];
      const d = new Date(now);
      if (u === "d") d.setDate(d.getDate() + n);
      else if (u === "w") d.setDate(d.getDate() + n * 7);
      else if (u === "M") d.setMonth(d.getMonth() + n);
      // snap to start-of-day
      d.setHours(0, 0, 0, 0);
      if (endOfDay) d.setHours(23, 59, 59, 999);
      return d;
    }
  }
  return now;
}
