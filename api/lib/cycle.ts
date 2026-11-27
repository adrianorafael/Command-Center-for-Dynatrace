/**
 * One complete engine cycle, run in a single invocation:
 *   1. tick  — read alerts from Grail, update incidents, plan notifications (runEngineTick, under the lease)
 *   2. send  — deliver the planned notifications through each provider (sendAll), within a deadline
 *   3. report — record each delivery result in the ledger (runDeliveryReport)
 *
 * Used by the custom workflow action `run-engine` (Simple workflow: one task, no workflow hours) and by
 * the `engine-run` app function (manual "Run engine now" / "Send test" from the UI).
 */
import { getAppId, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import type { EngineCounts, EngineTickRequest } from "../../ui/app/domain/contracts";
import type { Repository } from "../../ui/app/data/repository";
import type { QueryRunner } from "../../ui/app/data/grail";
import { runEngineTick } from "./engine";
import { runDeliveryReport } from "./delivery";
import { sendAll, type SenderDeps } from "./senders";

/** Total budget for one cycle; the platform limit for an action/function invocation is 120 s. */
export const CYCLE_BUDGET_MS = 100_000;

/** What one cycle did (the action/function result). `skipped` is set when the tick did not run, e.g. "locked". */
export interface CycleResult {
  ok: boolean;
  tickAt: number;
  skipped?: string;
  counts: EngineCounts;
  sent: number;
  failed: number;
  /** Planned but not attempted before the deadline (retried on a later cycle). */
  deferred: number;
  /** Handed to an integration's own workflow, which records the result itself. */
  handedOff?: number;
  errors: string[];
}

/** Everything a cycle needs from outside: state, Grail, the senders' I/O and the clock. */
export interface CycleDeps extends SenderDeps {
  repo: Repository;
  runQuery: QueryRunner;
  appBaseUrl?: string;
  /**
   * Absolute time (epoch ms) by which sending must stop. Default: this cycle's start + CYCLE_BUDGET_MS. A run that
   * waits before its cycle (the Problem trigger) passes the invocation's own deadline, so sends never outlive it.
   */
  deadlineAt?: number;
}

/** Absolute UI base for links in messages; undefined when the runtime does not expose it. */
export function appBaseUrl(): string | undefined {
  try {
    const env = getEnvironmentUrl();
    const app = getAppId();
    if (!env || env.startsWith("dt.missing") || !app || app.startsWith("dt.missing")) return undefined;
    return `${env.replace(/\/+$/, "")}/ui/apps/${app}`;
  } catch {
    return undefined;
  }
}

/** Runs tick, send and report once; sends nothing when the tick failed, was skipped or planned nothing. */
export async function runEngineCycle(request: EngineTickRequest, deps: CycleDeps): Promise<CycleResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const tick = await runEngineTick(request, { repo: deps.repo, runQuery: deps.runQuery, now: deps.now, appBaseUrl: deps.appBaseUrl });
  const planned = Object.values(tick.batches).reduce((n, list) => n + list.length, 0);
  const base = { ok: tick.ok, tickAt: tick.tickAt, counts: tick.counts, errors: [...tick.errors], ...(tick.skipped ? { skipped: tick.skipped } : {}) };
  if (!tick.ok || planned === 0) return { ...base, sent: 0, failed: 0, deferred: 0 };

  let handedOff = 0;
  const results = await sendAll(tick.batches, tick.providers, deps.deadlineAt ?? started + CYCLE_BUDGET_MS, {
    ...deps,
    onHandOff: (key) => {
      handedOff++;
      deps.onHandOff?.(key);
    },
  });
  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.length - sent;
  if (results.length > 0) {
    const report = await runDeliveryReport({ results }, { repo: deps.repo, now: deps.now });
    base.errors.push(...report.errors);
  }
  return { ...base, sent, failed, deferred: planned - results.length - handedOff, ...(handedOff ? { handedOff } : {}) };
}
