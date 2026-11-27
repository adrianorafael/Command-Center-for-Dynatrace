/**
 * delivery-report: apply DeliveryResult[] to the notification ledger and the daily rollup through the pure domain
 * `applyDeliveryResults`. Called by the engine cycle after its own sends (api/lib/cycle.ts) and by the
 * send-notification action for a notification handed to an integration's workflow.
 *
 * Tolerant by design: unknown keys (e.g. reason 'test' requests, expired records) are counted,
 * never thrown. Only records that are still awaiting a report (status planned/timeout, planned
 * within REPORT_WINDOW_MS) are updated; anything else is ignored.
 *
 * Writes ONLY ledger records and a rollup delta key (`rpt.<day>.d.<rand>`, folded by the engine).
 * It never takes the engine lease and never rewrites `inc.*`: a report overlapping the next tick
 * would otherwise make that tick skip (steps fired late) or clobber an ack the tick just folded.
 * The ledger is the source of truth for delivery state; the incident detail shows it from there.
 */

import type { DeliveryResult, NotificationRecord } from "../../ui/app/domain/contracts";
import { KEY, type Repository } from "../../ui/app/data/repository";
import { describeError } from "../../ui/app/data/grail";
import { createStore } from "../../ui/app/data/store";
import { applyDeliveryResults } from "../../ui/app/domain/engine/delivery";
import { isValidKey } from "../../ui/app/domain/keys";
import { NOTIFICATION_TTL_MS, forEachLimited } from "./engine";
import { isFinalRecord, slimRecord, writeRollupDelta } from "./storage";

export interface DeliveryReportRequest {
  results: DeliveryResult[];
}

export interface DeliveryReportResponse {
  ok: boolean;
  applied: number;
  unknown: number;
  /** Results for records that are already final or outside the report window. */
  ignored?: number;
  errors: string[];
}

/** Results beyond this count in one report are dropped (and reported as excess). */
export const MAX_RESULTS = 1000;
/**
 * Shortest window that is still correct: the longest time the engine itself waits for a result before it marks the
 * record `timeout` (engine.reportTimeoutSec, at most 3600 s per validation/validate.ts) plus one action / function
 * invocation (120 s), during which the result of the last send of that wait can still arrive. A shorter window would
 * reject the result of a record the engine is still waiting on.
 */
export const MIN_REPORT_WINDOW_MS = (3600 + 120) * 1000;

/**
 * A result is accepted only for a record that is still awaiting one (planned / timeout) and was planned at most this
 * long ago (`now - plannedAt <= REPORT_WINDOW_MS`). Every result is for one attempt's own key, and the domain accepts
 * a late "sent" after a timeout on purpose (it corrects "No result" in the incident's Notifications; the retry, if
 * any, is already planned under the next attempt's key). So the window is policy above MIN_REPORT_WINDOW_MS:
 *  - long enough for a send run by an integration's own workflow (send-notification action) whose run was queued or
 *    retried by the workflow long after the engine handed it off;
 *  - bounded well below the ledger TTL (NOTIFICATION_TTL_MS, 14 days; the write here renews it), because the
 *    rollup counts a result on the day it is reported, not the day it was planned: 24 h keeps a late count on the
 *    planning day or the next, and a hand re-run of an old workflow execution days later does not rewrite history.
 */
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

/** Validates `payload.results` and writes the accepted ones; never throws for bad input (see header). */
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

  // Incidents are not passed: their timelines are not rewritten here (see header).
  const out = applyDeliveryResults({ now, results: domainResults, ledger, incidents: [] });

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

  // Rollup counts go to a separate delta key; the engine folds them into rpt.<day> under its lease.
  await writeRollupDelta(deps.repo, out.rollupDelta).catch((e: unknown) => errors.push(`rollup: ${describeError(e)}`));

  return {
    ok: errors.length === 0,
    applied: out.notificationsToWrite.length,
    unknown,
    ...(ignored ? { ignored } : {}),
    errors,
  };
}
