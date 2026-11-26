/**
 * delivery-report: apply the workflow's DeliveryResult[] to the ledger, incident timelines and
 * the daily rollup through the pure domain `applyDeliveryResults`.
 * Tolerant by design: unknown keys (e.g. reason 'test' requests, expired records) are counted,
 * never thrown.
 *
 * Race guard: incidents are only rewritten while holding the engine lease. If a tick is running
 * (the next minute's execution can overlap a slow sender), only the ledger is updated — a stale
 * incident write could otherwise clobber an ack the tick just folded. The ledger is the source of
 * truth; the skipped "notification_sent" timeline entries are informational.
 */

import type { DeliveryResult, Incident, NotificationRecord } from "../../ui/app/domain/contracts";
import { KEY, type Repository } from "../../ui/app/data/repository";
import { describeError } from "../../ui/app/data/grail";
import { applyDeliveryResults } from "../../ui/app/domain/engine/delivery";
import { isValidKey } from "../../ui/app/domain/keys";
import { createStore } from "../../ui/app/data/store";
import { NOTIFICATION_TTL_MS, addRollup, forEachLimited } from "./engine";
import { acquireLease, releaseLease } from "./lease";

export interface DeliveryReportRequest {
  results: DeliveryResult[];
}

export interface DeliveryReportResponse {
  ok: boolean;
  applied: number;
  unknown: number;
  /** True when the engine lease was held by a tick, so incident timelines were not updated. */
  timelineSkipped?: boolean;
  errors: string[];
}

export const MAX_RESULTS = 1000;

function isResult(v: unknown): v is DeliveryResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["key"] === "string" &&
    (r["status"] === "sent" || r["status"] === "failed") &&
    typeof r["at"] === "number" &&
    Number.isFinite(r["at"])
  );
}

export async function runDeliveryReport(
  payload: unknown,
  deps: { repo: Repository; now?: () => number },
): Promise<DeliveryReportResponse> {
  const now = (deps.now ?? Date.now)();
  const raw = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(raw)) return { ok: false, applied: 0, unknown: 0, errors: ["payload.results must be an array"] };
  const results = raw.filter(isResult).slice(0, MAX_RESULTS);
  const errors: string[] = [];
  if (results.length < raw.length) errors.push(`${raw.length - results.length} malformed or excess result(s) ignored`);

  const ledger: NotificationRecord[] = [];
  const keys = [...new Set(results.map((r) => r.key))].filter((k) => isValidKey(KEY.notification(k)));
  await forEachLimited(
    keys,
    8,
    async (k) => {
      const rec = await deps.repo.get<NotificationRecord>(KEY.notification(k));
      if (rec) ledger.push(rec.value);
    },
    (k, e) => errors.push(`read notification ${k}: ${describeError(e)}`),
  );

  const incidents: Incident[] = [];
  await forEachLimited(
    [...new Set(ledger.map((r) => r.incidentId))],
    8,
    async (id) => {
      const inc = await deps.repo.get<Incident>(KEY.incident(id));
      if (inc) incidents.push(inc.value);
    },
    (id, e) => errors.push(`read incident ${id}: ${describeError(e)}`),
  );

  const out = applyDeliveryResults({ now, results, ledger, incidents });

  await forEachLimited(
    out.notificationsToWrite,
    8,
    (r) => deps.repo.put(KEY.notification(r.key), r, NOTIFICATION_TTL_MS),
    (r, e) => errors.push(`write notification ${r.key}: ${describeError(e)}`),
  );
  let timelineSkipped = false;
  if (out.incidentsToWrite.length > 0) {
    const settings = await createStore(deps.repo).getSettings();
    const holder = `report-${now}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    if (await acquireLease(deps.repo, holder, now, settings.engine.lockTtlSec)) {
      try {
        // Re-read under the lease so the timeline append applies to the newest incident.
        const fresh: Incident[] = [];
        for (const inc of out.incidentsToWrite) {
          const cur = (await deps.repo.get<Incident>(KEY.incident(inc.id)))?.value;
          if (cur) fresh.push(cur);
        }
        const again = applyDeliveryResults({ now, results, ledger, incidents: fresh });
        await forEachLimited(
          again.incidentsToWrite,
          8,
          (inc) => deps.repo.put(KEY.incident(inc.id), inc),
          (inc, e) => errors.push(`write incident ${inc.id}: ${describeError(e)}`),
        );
      } finally {
        await releaseLease(deps.repo, holder).catch(() => undefined);
      }
    } else {
      timelineSkipped = true;
    }
  }
  await addRollup(deps.repo, out.rollupDelta).catch((e: unknown) => errors.push(`rollup: ${describeError(e)}`));

  return {
    ok: errors.length === 0,
    applied: out.notificationsToWrite.length,
    unknown: out.unknownKeys.length,
    ...(timelineSkipped ? { timelineSkipped: true } : {}),
    errors,
  };
}
