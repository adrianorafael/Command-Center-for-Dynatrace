/**
 * Alert de-duplication (spec §H3 decision 2):
 * - Davis events owned by a fetched problem (`dt.davis.event_ids`) are dropped; their `cc.*`
 *   fields and tags are merged into the owning problem first, because the problem record does
 *   not carry Events API properties (lead's live-tenant note) — this lets routing rules on
 *   `fields.cc.service` etc. match problems raised by custom events.
 * - Davis events flagged `dt.davis.is_frequent_event` are dropped.
 * - Alerts with the same dedupKey collapse into one (latest activity wins).
 */

import type { Alert } from "../contracts";

export const EVENT_IDS_FIELD = "dt.davis.event_ids";
export const FREQUENT_FIELD = "dt.davis.is_frequent_event";

function davisEventId(a: Alert): string {
  return a.fields["event.id"] ?? a.sourceId;
}

function lastActivity(a: Alert): number {
  return Math.max(a.startedAt, a.reopenedAt ?? 0, a.endedAt ?? 0);
}

export interface DedupResult {
  alerts: Alert[];
  /** Davis events dropped because a problem owns them. */
  ownedByProblem: number;
  /** Davis events dropped as frequent events. */
  frequent: number;
  /** Alerts collapsed into another one with the same dedup key. */
  collapsed: number;
}

/** Problem event ids per problem dedupKey. */
export function problemEventIds(problem: Alert): string[] {
  const raw = problem.fields[EVENT_IDS_FIELD];
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function dedupAlerts(alerts: Alert[]): DedupResult {
  const owner = new Map<string, Alert>();
  for (const a of alerts) {
    if (a.source !== "davis-problem") continue;
    for (const id of problemEventIds(a)) if (!owner.has(id)) owner.set(id, a);
  }
  let ownedByProblem = 0;
  let frequent = 0;
  const kept: Alert[] = [];
  const enriched = new Map<Alert, Alert>();
  for (const a of alerts) {
    if (a.source === "davis-event") {
      const p = owner.get(davisEventId(a));
      if (p) {
        ownedByProblem++;
        const base = enriched.get(p) ?? { ...p, fields: { ...p.fields }, tags: [...p.tags] };
        for (const [k, v] of Object.entries(a.fields)) {
          if (k.startsWith("cc.") && base.fields[k] === undefined) base.fields[k] = v;
        }
        for (const t of a.tags) if (!base.tags.includes(t)) base.tags.push(t);
        enriched.set(p, base);
        continue;
      }
      if (a.fields[FREQUENT_FIELD] === "true") {
        frequent++;
        continue;
      }
    }
    kept.push(a);
  }
  const byKey = new Map<string, Alert>();
  let collapsed = 0;
  for (const original of kept) {
    const a = enriched.get(original) ?? original;
    const prev = byKey.get(a.dedupKey);
    if (!prev) {
      byKey.set(a.dedupKey, a);
      continue;
    }
    collapsed++;
    if (lastActivity(a) >= lastActivity(prev)) byKey.set(a.dedupKey, a);
  }
  return { alerts: Array.from(byKey.values()), ownedByProblem, frequent, collapsed };
}
