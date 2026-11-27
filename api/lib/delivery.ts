/**
 * delivery-report: apply the workflow's DeliveryResult[] to the notification ledger and the daily
 * rollup through the pure domain `applyDeliveryResults`.
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
