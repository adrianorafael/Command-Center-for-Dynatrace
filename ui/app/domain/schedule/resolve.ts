/**
 * On-call resolution for a Schedule at an instant.
 *
 * Semantics (documented for the UI):
 * - Shifts of a layer are anchored at `startsAt`: the anchor is the first `handoffTime`
 *   (schedule zone) at or after `startsAt`. Shift 0 belongs to `participants[0]` and also
 *   covers the lead-in from `startsAt` to the anchor (so "starts Monday 00:00, weekly,
 *   handoff 09:00" hands off every Monday 09:00 and the first shift is longer). For
 *   hour-based custom rotations the boundaries are handoff ± k × length, so the lead-in is
 *   shorter than one shift.
 *   Coverage starts at `startsAt` (nobody before it).
 * - `daily` = 1 local day, `weekly` = 7 local days, `custom` = `lengthHours` (multiples of 24
 *   are local days; others are elapsed hours). Day-based shifts always hand off at the local
 *   `handoffTime`, so a shift spanning a DST change lasts 23 or 25 hours.
 * - `restrictions`: the layer only covers instants inside one of its weekly windows.
 * - Later layers win over earlier ones; a restricted-out or empty layer falls through.
 * - Overrides win over all layers; when several overlap, the last one in the array wins.
 */

import type { RotationLayer, Schedule, ScheduleOverride } from "../contracts";
import {
  addDays,
  civilDate,
  daysBetween,
  HOUR_MS,
  inWeeklyWindow,
  parseHHmm,
  safeTimeZone,
  zonedToUtc,
  type CivilDate,
} from "../time/tz";

export interface LayerShift {
  layerId: string;
  /** Shift number since the anchor (0 = first). */
  index: number;
  uid: string;
  /** Shift start (clamped to startsAt). */
  start: number;
  end: number;
}

export interface OnCall {
  uid: string;
  source: "layer" | "override";
  layerId?: string;
  overrideId?: string;
  /** Start/end of the covering shift or override (not clipped by restrictions). */
  from: number;
  to: number;
}

type Length = { kind: "days"; days: number } | { kind: "hours"; ms: number };

export function rotationLength(layer: RotationLayer): Length {
  switch (layer.rotation.type) {
    case "daily":
      return { kind: "days", days: 1 };
    case "weekly":
      return { kind: "days", days: 7 };
    case "custom": {
      const h = layer.rotation.lengthHours;
      const hours = typeof h === "number" && Number.isFinite(h) && h > 0 ? h : 24;
      if (hours % 24 === 0) return { kind: "days", days: hours / 24 };
      return { kind: "hours", ms: hours * HOUR_MS };
    }
    default:
      return { kind: "days", days: 1 };
  }
}

interface Anchor {
  date: CivilDate;
  handoffMin: number;
  start: number;
}

function anchorOf(layer: RotationLayer, tz: string): Anchor {
  const handoffMin = parseHHmm(layer.handoffTime) ?? 0;
  let date = civilDate(layer.startsAt, tz);
  let start = zonedToUtc(date, handoffMin, tz);
  if (start < layer.startsAt) {
    date = addDays(date, 1);
    start = zonedToUtc(date, handoffMin, tz);
  }
  return { date, handoffMin, start };
}

/**
 * First handoff of a layer at or after its start, in the schedule's time zone. Weekly rotations hand off on the
 * weekday of this instant (not on the weekday of `startsAt` in the viewer's browser zone).
 */
export function firstHandoff(layer: RotationLayer, timeZone: string): number {
  return anchorOf(layer, safeTimeZone(timeZone)).start;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** The rotation shift of `layer` containing `ts` (ignores restrictions). */
export function layerShiftAt(layer: RotationLayer, timeZone: string, ts: number): LayerShift | undefined {
  if (layer.participants.length === 0 || ts < layer.startsAt) return undefined;
  const tz = safeTimeZone(timeZone);
  const anchor = anchorOf(layer, tz);
  const len = rotationLength(layer);
  let index: number;
  let start: number;
  let end: number;
  if (len.kind === "days") {
    const today = civilDate(ts, tz);
    let days = daysBetween(anchor.date, today);
    if (ts < zonedToUtc(today, anchor.handoffMin, tz)) days -= 1;
    index = Math.floor(days / len.days);
    start = zonedToUtc(addDays(anchor.date, index * len.days), anchor.handoffMin, tz);
    end = zonedToUtc(addDays(anchor.date, (index + 1) * len.days), anchor.handoffMin, tz);
    // Guard against rare rounding at DST edges.
    if (ts < start) {
      index -= 1;
      end = start;
      start = zonedToUtc(addDays(anchor.date, index * len.days), anchor.handoffMin, tz);
    } else if (ts >= end) {
      index += 1;
      start = end;
      end = zonedToUtc(addDays(anchor.date, (index + 1) * len.days), anchor.handoffMin, tz);
    }
  } else {
    // Hour-based: boundaries are handoff-on-the-start-day ± k × length; first one ≥ startsAt.
    const base = zonedToUtc(civilDate(layer.startsAt, tz), anchor.handoffMin, tz);
    const first = base + Math.ceil((layer.startsAt - base) / len.ms) * len.ms;
    index = Math.floor((ts - first) / len.ms);
    start = first + index * len.ms;
    end = start + len.ms;
    if (index < 0) end = first + len.ms;
  }
  if (index < 0) {
    // Lead-in between startsAt and the first handoff: part of shift 0.
    if (len.kind === "days") end = zonedToUtc(addDays(anchor.date, len.days), anchor.handoffMin, tz);
    index = 0;
    start = layer.startsAt;
  }
  const uid = layer.participants[mod(index, layer.participants.length)];
  if (uid === undefined) return undefined;
  return { layerId: layer.id, index, uid, start: Math.max(start, layer.startsAt), end };
}

/** Does the layer's restriction set allow `ts`? (No restrictions → always.) */
export function layerAllows(layer: RotationLayer, timeZone: string, ts: number): boolean {
  const r = layer.restrictions;
  if (!r || r.length === 0) return true;
  const tz = safeTimeZone(timeZone);
  return r.some((w) => inWeeklyWindow(ts, w, tz));
}

/** Who a single layer puts on call at `ts` (restrictions applied). */
export function layerOnCallAt(layer: RotationLayer, timeZone: string, ts: number): LayerShift | undefined {
  if (!layerAllows(layer, timeZone, ts)) return undefined;
  return layerShiftAt(layer, timeZone, ts);
}

/** Override active at `ts` (last matching in the array wins). */
export function overrideAt(overrides: ScheduleOverride[], ts: number): ScheduleOverride | undefined {
  for (let i = overrides.length - 1; i >= 0; i--) {
    const o = overrides[i];
    if (o && o.uid && o.from <= ts && ts < o.to) return o;
  }
  return undefined;
}

/** Final on-call for the schedule at `ts`, or undefined when nobody is covering. */
export function onCallAt(schedule: Schedule, ts: number): OnCall | undefined {
  const o = overrideAt(schedule.overrides ?? [], ts);
  if (o) return { uid: o.uid, source: "override", overrideId: o.id, from: o.from, to: o.to };
  for (let i = schedule.layers.length - 1; i >= 0; i--) {
    const layer = schedule.layers[i];
    if (!layer) continue;
    const s = layerOnCallAt(layer, schedule.timeZone, ts);
    if (s) return { uid: s.uid, source: "layer", layerId: layer.id, from: s.start, to: s.end };
  }
  return undefined;
}

/** On-call uids for a schedule id at `ts` (empty when unknown or uncovered). */
export function onCallUids(schedules: Schedule[], scheduleId: string, ts: number): string[] {
  const s = schedules.find((x) => x.id === scheduleId);
  if (!s) return [];
  const oc = onCallAt(s, ts);
  return oc ? [oc.uid] : [];
}
