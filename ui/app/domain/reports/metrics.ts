/**
 * Reporting maths: daily rollups (engine-maintained) and live metrics from incidents.
 * MTTA = mean(acknowledgedAt − createdAt), MTTR = mean(resolvedAt − createdAt).
 */

import { PRIORITIES, SCHEMA_VERSION, type DailyRollup, type Incident, type Priority } from "../contracts";
import { utcDay } from "../keys";

export type RollupDelta = Omit<DailyRollup, "schemaVersion">;

export function emptyRollup(day: string): DailyRollup {
  return {
    schemaVersion: SCHEMA_VERSION,
    day,
    created: 0,
    resolved: 0,
    ttaSumMs: 0,
    ttaCount: 0,
    ttrSumMs: 0,
    ttrCount: 0,
    byPriority: {},
    byTeam: {},
    byService: {},
    bySource: {},
    notificationsSent: 0,
    notificationsFailed: 0,
    pagesByUser: {},
  };
}

export function emptyDelta(day: string): RollupDelta {
  const { schemaVersion: _v, ...rest } = emptyRollup(day);
  void _v;
  return rest;
}

export function isEmptyDelta(d: RollupDelta): boolean {
  return (
    d.created === 0 &&
    d.resolved === 0 &&
    d.ttaCount === 0 &&
    d.ttrCount === 0 &&
    d.notificationsSent === 0 &&
    d.notificationsFailed === 0 &&
    Object.keys(d.pagesByUser).length === 0
  );
}

function bump(map: Record<string, number>, key: string | undefined, by = 1): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + by;
}

function mergeMap(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Add a delta into a rollup (or into an empty rollup for that day). */
export function applyRollupDelta(existing: DailyRollup | undefined, delta: RollupDelta): DailyRollup {
  const base = existing && existing.day === delta.day ? existing : emptyRollup(delta.day);
  const byPriority: Partial<Record<Priority, number>> = { ...base.byPriority };
  for (const p of PRIORITIES) {
    const v = delta.byPriority[p];
    if (v) byPriority[p] = (byPriority[p] ?? 0) + v;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    day: base.day,
    created: base.created + delta.created,
    resolved: base.resolved + delta.resolved,
    ttaSumMs: base.ttaSumMs + delta.ttaSumMs,
    ttaCount: base.ttaCount + delta.ttaCount,
    ttrSumMs: base.ttrSumMs + delta.ttrSumMs,
    ttrCount: base.ttrCount + delta.ttrCount,
    byPriority,
    byTeam: mergeMap(base.byTeam, delta.byTeam),
    byService: mergeMap(base.byService, delta.byService),
    bySource: mergeMap(base.bySource, delta.bySource),
    notificationsSent: base.notificationsSent + delta.notificationsSent,
    notificationsFailed: base.notificationsFailed + delta.notificationsFailed,
    pagesByUser: mergeMap(base.pagesByUser, delta.pagesByUser),
  };
}

/** Mutating recorders used by the engine. */
export const rollupRecord = {
  created(d: RollupDelta, inc: Incident): void {
    d.created++;
    const bp = d.byPriority;
    bp[inc.priority] = (bp[inc.priority] ?? 0) + 1;
    bump(d.byTeam, inc.teamId ?? "unassigned");
    bump(d.byService, inc.serviceId ?? "none");
    bump(d.bySource, inc.alert.source);
  },
  acknowledged(d: RollupDelta, inc: Incident): void {
    if (inc.acknowledgedAt === undefined || inc.acknowledgedAt < inc.createdAt) return;
    d.ttaSumMs += inc.acknowledgedAt - inc.createdAt;
    d.ttaCount++;
  },
  resolved(d: RollupDelta, inc: Incident): void {
    d.resolved++;
    // Incidents created already closed (resolvedAt before createdAt) do not count for MTTR.
    if (inc.resolvedAt === undefined || inc.resolvedAt < inc.createdAt) return;
    d.ttrSumMs += inc.resolvedAt - inc.createdAt;
    d.ttrCount++;
  },
  page(d: RollupDelta, uid: string): void {
    bump(d.pagesByUser, uid);
  },
};

// ─── aggregate views ─────────────────────────────────────────────────────────

export interface MetricsSummary {
  from: string;
  to: string;
  created: number;
  resolved: number;
  mttaMs?: number;
  mttrMs?: number;
  byPriority: Partial<Record<Priority, number>>;
  byTeam: Record<string, number>;
  byService: Record<string, number>;
  bySource: Record<string, number>;
  notificationsSent: number;
  notificationsFailed: number;
  /** sent / (sent + failed), undefined with no traffic. */
  deliverySuccessRate?: number;
  pagesByUser: Record<string, number>;
  /** Per-day series (sorted by day) for charts. */
  daily: { day: string; created: number; resolved: number; mttaMs?: number; mttrMs?: number }[];
}

/** Combine rollups whose day is within [fromDay, toDay] (inclusive, 'yyyy-mm-dd'). */
export function summarizeRollups(rollups: DailyRollup[], fromDay: string, toDay: string): MetricsSummary {
  const days = rollups.filter((r) => r.day >= fromDay && r.day <= toDay).sort((a, b) => (a.day < b.day ? -1 : 1));
  let total = emptyRollup(toDay);
  for (const r of days) {
    const { schemaVersion: _v, ...delta } = r;
    void _v;
    total = applyRollupDelta(total, { ...delta, day: toDay });
  }
  const sentFailed = total.notificationsSent + total.notificationsFailed;
  return {
    from: fromDay,
    to: toDay,
    created: total.created,
    resolved: total.resolved,
    ...(total.ttaCount ? { mttaMs: total.ttaSumMs / total.ttaCount } : {}),
    ...(total.ttrCount ? { mttrMs: total.ttrSumMs / total.ttrCount } : {}),
    byPriority: total.byPriority,
    byTeam: total.byTeam,
    byService: total.byService,
    bySource: total.bySource,
    notificationsSent: total.notificationsSent,
    notificationsFailed: total.notificationsFailed,
    ...(sentFailed ? { deliverySuccessRate: total.notificationsSent / sentFailed } : {}),
    pagesByUser: total.pagesByUser,
    daily: days.map((r) => ({
      day: r.day,
      created: r.created,
      resolved: r.resolved,
      ...(r.ttaCount ? { mttaMs: r.ttaSumMs / r.ttaCount } : {}),
      ...(r.ttrCount ? { mttrMs: r.ttrSumMs / r.ttrCount } : {}),
    })),
  };
}

/** Rollups rebuilt from incidents (created within [from, to)) — live view / fallback. */
export function rollupsFromIncidents(incidents: Incident[], from: number, to: number): DailyRollup[] {
  const byDay = new Map<string, RollupDelta>();
  const get = (ts: number) => {
    const day = utcDay(ts);
    let d = byDay.get(day);
    if (!d) {
      d = emptyDelta(day);
      byDay.set(day, d);
    }
    return d;
  };
  for (const inc of incidents) {
    if (inc.createdAt >= from && inc.createdAt < to) rollupRecord.created(get(inc.createdAt), inc);
    if (inc.acknowledgedAt !== undefined && inc.acknowledgedAt >= from && inc.acknowledgedAt < to) {
      rollupRecord.acknowledged(get(inc.acknowledgedAt), inc);
    }
    if (inc.status === "resolved" && inc.resolvedAt !== undefined && inc.resolvedAt >= from && inc.resolvedAt < to) {
      rollupRecord.resolved(get(inc.resolvedAt), inc);
    }
  }
  return Array.from(byDay.values()).map((d) => applyRollupDelta(undefined, d));
}

/** MTTA / MTTR straight from incidents. */
export function incidentTimings(incidents: Incident[]): { mttaMs?: number; mttrMs?: number; acked: number; resolved: number } {
  let ttaSum = 0;
  let tta = 0;
  let ttrSum = 0;
  let ttr = 0;
  for (const i of incidents) {
    if (i.acknowledgedAt !== undefined && i.acknowledgedAt >= i.createdAt) {
      ttaSum += i.acknowledgedAt - i.createdAt;
      tta++;
    }
    if (i.status === "resolved" && i.resolvedAt !== undefined && i.resolvedAt >= i.createdAt) {
      ttrSum += i.resolvedAt - i.createdAt;
      ttr++;
    }
  }
  return {
    ...(tta ? { mttaMs: ttaSum / tta } : {}),
    ...(ttr ? { mttrMs: ttrSum / ttr } : {}),
    acked: tta,
    resolved: ttr,
  };
}

/** Counts of open incidents by status/priority for the console KPI strip. */
export function openIncidentKpis(incidents: Incident[]): {
  open: number;
  triggered: number;
  acknowledged: number;
  snoozed: number;
  byPriority: Partial<Record<Priority, number>>;
} {
  const out = { open: 0, triggered: 0, acknowledged: 0, snoozed: 0, byPriority: {} as Partial<Record<Priority, number>> };
  for (const i of incidents) {
    if (i.status === "resolved") continue;
    out.open++;
    if (i.status === "triggered") out.triggered++;
    else if (i.status === "acknowledged") out.acknowledged++;
    else out.snoozed++;
    out.byPriority[i.priority] = (out.byPriority[i.priority] ?? 0) + 1;
  }
  return out;
}

/** Human duration "1h 05m", "4m", "35s". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
