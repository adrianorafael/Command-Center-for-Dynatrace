/**
 * Shift lists over [from, to) for previews and gantt rows.
 * Everything is piecewise constant between "change points" (shift boundaries, restriction
 * window edges, override edges), so we evaluate the resolver at each change point and merge.
 */

import type { RotationLayer, Schedule } from "../contracts";
import { addDays, civilDate, parseHHmm, safeTimeZone, zonedToUtc } from "../time/tz";
import { layerOnCallAt, layerShiftAt, onCallAt } from "./resolve";

export interface ShiftSegment {
  uid: string;
  from: number;
  to: number;
  source: "layer" | "override";
  layerId?: string;
  overrideId?: string;
}

/** Safety cap on evaluated change points per call. */
export const MAX_TIMELINE_POINTS = 20_000;

function layerChangePoints(layer: RotationLayer, timeZone: string, from: number, to: number, out: number[]): void {
  if (layer.participants.length === 0) return;
  const tz = safeTimeZone(timeZone);
  out.push(layer.startsAt);
  let t = Math.max(from, layer.startsAt);
  let guard = 0;
  while (t < to && guard++ < MAX_TIMELINE_POINTS) {
    const s = layerShiftAt(layer, tz, t);
    if (!s || s.end <= t) break;
    out.push(s.end);
    t = s.end;
  }
  const r = layer.restrictions;
  if (r && r.length > 0) {
    const first = addDays(civilDate(from, tz), -1);
    const last = addDays(civilDate(to, tz), 1);
    for (let d = first, n = 0; n < 400; d = addDays(d, 1), n++) {
      for (const w of r) {
        const a = parseHHmm(w.from);
        const b = parseHHmm(w.to);
        if (a !== undefined) out.push(zonedToUtc(d, a, tz));
        if (b !== undefined) out.push(zonedToUtc(d, b, tz));
      }
      if (d.year === last.year && d.month === last.month && d.day === last.day) break;
    }
  }
}

function segmentsFrom(
  points: number[],
  from: number,
  to: number,
  evaluate: (ts: number) => Omit<ShiftSegment, "from" | "to"> | undefined,
): ShiftSegment[] {
  const pts = Array.from(new Set(points.filter((p) => p > from && p < to)))
    .sort((a, b) => a - b)
    .slice(0, MAX_TIMELINE_POINTS);
  const bounds = [from, ...pts, to];
  const out: ShiftSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (b <= a) continue;
    const v = evaluate(a);
    if (!v) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.to === a &&
      prev.uid === v.uid &&
      prev.source === v.source &&
      prev.layerId === v.layerId &&
      prev.overrideId === v.overrideId
    ) {
      prev.to = b;
    } else {
      out.push({ ...v, from: a, to: b });
    }
  }
  return out;
}

/** Final (resolved) on-call segments of a schedule over [from, to). Gaps = nobody on call. */
export function scheduleTimeline(schedule: Schedule, from: number, to: number): ShiftSegment[] {
  if (!(to > from)) return [];
  const points: number[] = [];
  for (const layer of schedule.layers) layerChangePoints(layer, schedule.timeZone, from, to, points);
  for (const o of schedule.overrides ?? []) points.push(o.from, o.to);
  return segmentsFrom(points, from, to, (ts) => {
    const oc = onCallAt(schedule, ts);
    if (!oc) return undefined;
    return oc.source === "override"
      ? { uid: oc.uid, source: "override", overrideId: oc.overrideId }
      : { uid: oc.uid, source: "layer", layerId: oc.layerId };
  });
}

/** Segments of one layer (restrictions applied, overrides/other layers ignored) — gantt rows. */
export function layerTimeline(schedule: Schedule, layerId: string, from: number, to: number): ShiftSegment[] {
  const layer = schedule.layers.find((l) => l.id === layerId);
  if (!layer || !(to > from)) return [];
  const points: number[] = [];
  layerChangePoints(layer, schedule.timeZone, from, to, points);
  return segmentsFrom(points, from, to, (ts) => {
    const s = layerOnCallAt(layer, schedule.timeZone, ts);
    return s ? { uid: s.uid, source: "layer", layerId: layer.id } : undefined;
  });
}

/** Overrides clipped to [from, to) as segments. */
export function overrideTimeline(schedule: Schedule, from: number, to: number): ShiftSegment[] {
  return (schedule.overrides ?? [])
    .filter((o) => o.to > from && o.from < to)
    .map((o) => ({
      uid: o.uid,
      from: Math.max(o.from, from),
      to: Math.min(o.to, to),
      source: "override" as const,
      overrideId: o.id,
    }));
}

export interface OnCallNowNext {
  current?: ShiftSegment;
  next?: ShiftSegment;
}

/** Current segment at `now` and the next different one within `horizonMs` (default 14 d). */
export function onCallNowAndNext(schedule: Schedule, now: number, horizonMs = 14 * 86_400_000): OnCallNowNext {
  const segs = scheduleTimeline(schedule, now, now + horizonMs);
  const first = segs[0];
  const current = first && first.from === now ? first : undefined;
  const next = current ? segs[1] : first;
  return { current, next };
}

/** Hours on call per uid over [from, to) — for the on-call load report. */
export function onCallHoursByUser(schedule: Schedule, from: number, to: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of scheduleTimeline(schedule, from, to)) {
    out[s.uid] = (out[s.uid] ?? 0) + (s.to - s.from) / 3_600_000;
  }
  return out;
}
