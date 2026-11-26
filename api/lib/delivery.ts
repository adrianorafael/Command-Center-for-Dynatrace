/**
 * delivery-report: apply the workflow's DeliveryResult[] to the ledger, incident timelines and
 * the daily rollup through the pure domain `applyDeliveryResults`.
 *
 * Tolerant by design: unknown keys (e.g. reason 'test' requests, expired records) are counted,
 * never thrown. Only records that are still awaiting a report (status planned/timeout, planned
 * within REPORT_WINDOW_MS) are updated; anything else is ignored.
 *
 * Race guards (no transactions in App State):
 *  - incident timelines are only rewritten while holding the engine lease; when a tick is running
 *    only the ledger is updated (a stale incident write could clobber an ack the tick just folded);
 *  - rollup counts go straight into `rpt.<day>` under the lease, otherwise into a separate delta
 *    key `rpt.<day>.d.<rand>` that the engine folds in later (no lost read-modify-write).
 */

import type { DeliveryResult, Incident, NotificationRecord } from "../../ui/app/domain/contracts";
import { KEY, type Repository } from "../../ui/app/data/repository";
import { describeError } from "../../ui/app/data/grail";
import { createStore } from "../../ui/app/data/store";
import { MIN_LOCK_TTL_SEC } from "../../ui/app/data/domainPort";
import { applyDeliveryResults } from "../../ui/app/domain/engine/delivery";
import { isValidKey } from "../../ui/app/domain/keys";
import { NOTIFICATION_TTL_MS, forEachLimited } from "./engine";
import { acquireLease, releaseLease } from "./lease";
import { addRollup, isFinalRecord, slimRecord, writeRollupDelta } from "./storage";

export interface DeliveryReportRequest {
  results: DeliveryResult[];
}

export interface DeliveryReportResponse {
  ok: boolean;
  applied: number;
  unknown: number;
  /** Results for records that are already final or outside the report window. */
  ignored?: number;
  /** True when the engine lease was held by a tick, so incident timelines were not updated. */
  timelineSkipped?: boolean;
  errors: string[];
}

export const MAX_RESULTS = 1000;
/** A result is accepted for records planned at most this long ago (a run takes ≤ 2 min). */
export const REPORT_WINDOW_MS = 24 * 3600_000;

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

function awaitingReport(r: NotificationRecord, now: number): boolean {
  return (r.status === "planned" || r.status === "timeout") && now - r.plannedAt <= REPORT_WINDOW_MS;
}

export async function runDeliveryReport(
  payload: unknown,
  deps: { repo: Repository; now?: () => number },
): Promise<DeliveryReportResponse> {
  const now = (deps.now ?? Date.now)();
  const raw = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(raw)) return { ok: false, applied: 0, unknown: 0, errors: ["payload.results must be an array"] };
  const valid = raw.filter(isResult).slice(0, MAX_RESULTS);
  const errors: string[] = [];
  if (valid.length < raw.length) errors.push(`${raw.length - valid.length} malformed or excess result(s) ignored`);

  const ledger: NotificationRecord[] = [];
  const found = new Set<string>();
  let ignored = 0;
  const keys = [...new Set(valid.map((r) => r.key))].filter((k) => isValidKey(KEY.notification(k)));
  await forEachLimited(
    keys,
    8,
    async (k) => {
      const rec = (await deps.repo.get<NotificationRecord>(KEY.notification(k)))?.value;
      if (!rec) return;
      found.add(k);
      if (awaitingReport(rec, now)) ledger.push(rec);
      else ignored++;
    },
    (k, e) => errors.push(`read notification ${k}: ${describeError(e)}`),
  );
  const accepted = new Set(ledger.map((r) => r.key));
  const domainResults = valid.filter((r) => accepted.has(r.key));
  const unknown = new Set(valid.map((r) => r.key).filter((k) => !found.has(k))).size;

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

  const out = applyDeliveryResults({ now, results: domainResults, ledger, incidents });

  const settings = await createStore(deps.repo).getSettings();
  await forEachLimited(
    out.notificationsToWrite,
    8,
    (r) =>
      deps.repo.put(
        KEY.notification(r.key),
        isFinalRecord(r, settings.engine.maxAttempts) ? slimRecord(r) : r,
        NOTIFICATION_TTL_MS,
      ),
    (r, e) => errors.push(`write notification ${r.key}: ${describeError(e)}`),
  );

  let timelineSkipped = false;
  const holder = `report-${now}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const leased = await acquireLease(deps.repo, holder, now, Math.max(settings.engine.lockTtlSec, MIN_LOCK_TTL_SEC)).catch(
    () => false,
  );
  try {
    if (leased) {
      if (out.incidentsToWrite.length > 0) {
        // Re-read under the lease so the timeline append applies to the newest incident.
        const fresh: Incident[] = [];
        for (const inc of out.incidentsToWrite) {
          const cur = (await deps.repo.get<Incident>(KEY.incident(inc.id)))?.value;
          if (cur) fresh.push(cur);
        }
        const again = applyDeliveryResults({ now, results: domainResults, ledger, incidents: fresh });
        await forEachLimited(
          again.incidentsToWrite,
          8,
          (inc) => deps.repo.put(KEY.incident(inc.id), inc),
          (inc, e) => errors.push(`write incident ${inc.id}: ${describeError(e)}`),
        );
      }
      await addRollup(deps.repo, out.rollupDelta).catch((e: unknown) => errors.push(`rollup: ${describeError(e)}`));
    } else {
      timelineSkipped = out.incidentsToWrite.length > 0;
      await writeRollupDelta(deps.repo, out.rollupDelta).catch((e: unknown) => errors.push(`rollup: ${describeError(e)}`));
    }
  } finally {
    if (leased) await releaseLease(deps.repo, holder).catch(() => undefined);
  }

  return {
    ok: errors.length === 0,
    applied: out.notificationsToWrite.length,
    unknown,
    ...(ignored ? { ignored } : {}),
    ...(timelineSkipped ? { timelineSkipped: true } : {}),
    errors,
  };
}
