/**
 * Apply workflow delivery reports (DeliveryResult[]) to ledger records and incident timelines.
 * Idempotent: a result identical to what the record already holds changes nothing.
 * A late "sent" after a timeout still marks the record sent (the retry may also go out —
 * at-least-once paging).
 */

import type { DeliveryResult, Incident, NotificationRecord } from "../contracts";
import { cloneIncident, pushTimeline } from "../incidents/actions";
import { utcDay } from "../keys";
import { emptyDelta, type RollupDelta } from "../reports/metrics";

export const MAX_ERROR_LENGTH = 500;

export interface DeliveryInput {
  now: number;
  results: DeliveryResult[];
  /** Ledger records for (at least) the reported keys. */
  ledger: NotificationRecord[];
  /** Incidents referenced by those records (missing ones are skipped). */
  incidents: Incident[];
}

export interface DeliveryOutput {
  notificationsToWrite: NotificationRecord[];
  incidentsToWrite: Incident[];
  rollupDelta: RollupDelta;
  /** Result keys with no ledger record. */
  unknownKeys: string[];
}

/** Keep provider error texts short and single-line (they end up in the UI). */
export function sanitizeError(e: string | undefined): string | undefined {
  if (!e) return undefined;
  const s = e.replace(/\s+/g, " ").trim();
  return s.length > MAX_ERROR_LENGTH ? `${s.slice(0, MAX_ERROR_LENGTH - 1)}…` : s;
}

export function applyDeliveryResults(input: DeliveryInput): DeliveryOutput {
  const byKey = new Map(input.ledger.map((r) => [r.key, r]));
  const incidents = new Map(input.incidents.map((i) => [i.id, i]));
  const touchedIncidents = new Set<string>();
  const written = new Map<string, NotificationRecord>();
  const unknownKeys: string[] = [];
  const delta = emptyDelta(utcDay(input.now));

  const sorted = [...input.results].sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const res of sorted) {
    const rec = written.get(res.key) ?? byKey.get(res.key);
    if (!rec) {
      unknownKeys.push(res.key);
      continue;
    }
    if (res.status !== "sent" && res.status !== "failed") continue;
    const error = sanitizeError(res.error);
    if (rec.status === res.status && rec.reportedAt === res.at) continue;
    if (rec.status === "sent" && res.status === "failed") continue; // never downgrade a success
    const next: NotificationRecord = {
      ...rec,
      status: res.status,
      reportedAt: res.at,
      ...(res.providerRef ? { providerRef: res.providerRef } : {}),
    };
    if (error) next.error = error;
    else delete next.error;
    written.set(res.key, next);
    if (res.status === "sent") delta.notificationsSent++;
    else delta.notificationsFailed++;

    const inc = incidents.get(rec.incidentId);
    if (!inc) continue;
    const copy = cloneIncident(inc);
    pushTimeline(copy, {
      at: res.at,
      type: res.status === "sent" ? "notification_sent" : "notification_failed",
      by: "system",
      detail: `${rec.channel} → ${rec.to.name ?? rec.to.uid}${rec.attempt > 1 ? ` (attempt ${rec.attempt})` : ""}${
        error && res.status === "failed" ? `: ${error}` : ""
      }`,
      data: { key: rec.key, channel: rec.channel, uid: rec.to.uid, attempt: rec.attempt, final: false },
    });
    incidents.set(copy.id, copy);
    touchedIncidents.add(copy.id);
  }
  return {
    notificationsToWrite: [...written.values()],
    incidentsToWrite: [...touchedIncidents].sort().map((id) => incidents.get(id)).filter((x): x is Incident => !!x),
    rollupDelta: delta,
    unknownKeys,
  };
}
