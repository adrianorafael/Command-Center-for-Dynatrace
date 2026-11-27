/**
 * App State budget helpers (50 MB per app, 10 MB per value, TTL ≤ 90 d — spec H2).
 *
 *  - Ledger records in a final state keep only their subject (text/speech dropped).
 *  - Daily rollups expire after 90 days (platform maximum TTL).
 *  - Rollup deltas from writers outside the engine lease go to `rpt.<day>.d.<rand>` and are
 *    folded into `rpt.<day>` by the engine (under the lease); readers sum both (store.listRollups).
 *  - A storage estimate (keys and bytes per prefix) goes into the heartbeat; above the shedding
 *    threshold the oldest archives are deleted first.
 */

import { PREFIX, KEY, type Repository, type Stored } from "../../ui/app/data/repository";
import { ROLLUP_DELTA_MARK, rollupDeltaKey } from "../../ui/app/data/store";
import type { DailyRollup, NotificationRecord } from "../../ui/app/domain/contracts";
import { applyRollupDelta, isEmptyDelta, type RollupDelta } from "../../ui/app/domain/reports/metrics";

const DAY_MS = 24 * 3600_000;
export const ROLLUP_TTL_MS = 90 * DAY_MS;
export const APP_STATE_LIMIT_BYTES = 50 * 1024 * 1024;
export const SHED_THRESHOLD_BYTES = 40 * 1024 * 1024;

export interface PrefixUsage {
  keys: number;
  bytes: number;
}

export interface StorageEstimate {
  at: number;
  totalBytes: number;
  limitBytes: number;
  byPrefix: Record<string, PrefixUsage>;
  /** Archives deleted by shedding in this tick. */
  shed?: number;
}

/** A record no longer needs its message body once it is final (no further attempt is built from it). */
export function isFinalRecord(r: NotificationRecord, maxAttempts: number): boolean {
  if (r.status === "sent") return true;
  return (r.status === "failed" || r.status === "timeout") && r.attempt >= maxAttempts;
}

export function slimRecord(r: NotificationRecord): NotificationRecord {
  const { speech: _speech, ...rest } = r;
  void _speech;
  return { ...rest, text: "" };
}

export function bytesOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function rand(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

/** Engine (under the lease): merge a delta into `rpt.<day>`. */
export async function addRollup(repo: Repository, delta: RollupDelta): Promise<void> {
  if (isEmptyDelta(delta)) return;
  const key = KEY.rollup(delta.day);
  const existing = await repo.get<DailyRollup>(key);
  await repo.put(key, applyRollupDelta(existing?.value, delta), ROLLUP_TTL_MS);
}

/** Writers without the lease: append a separate delta key (no read-modify-write race). */
export async function writeRollupDelta(repo: Repository, delta: RollupDelta): Promise<void> {
  if (isEmptyDelta(delta)) return;
  await repo.put(rollupDeltaKey(delta.day, rand()), applyRollupDelta(undefined, delta), ROLLUP_TTL_MS);
}

/** Engine (under the lease): fold every `rpt.<day>.d.*` into `rpt.<day>` and delete the deltas. */
export async function foldRollupDeltas(repo: Repository, rows: Stored<DailyRollup>[]): Promise<number> {
  const deltas = rows.filter((r) => r.key.includes(ROLLUP_DELTA_MARK));
  let folded = 0;
  for (const d of deltas) {
    const { schemaVersion: _v, ...delta } = d.value;
    void _v;
    await addRollup(repo, delta);
    await repo.delete(d.key);
    folded++;
  }
  return folded;
}

export function usage(rows: readonly { value: unknown }[]): PrefixUsage {
  return { keys: rows.length, bytes: rows.reduce((n, r) => n + bytesOf(r.value), 0) };
}

/**
 * Delete the oldest archives (key order = day order) until the estimate is under the threshold.
 * Returns the number of archives deleted and the bytes freed.
 */
export async function shedArchives(
  repo: Repository,
  archives: Stored<unknown>[],
  totalBytes: number,
  threshold = SHED_THRESHOLD_BYTES,
): Promise<{ deleted: number; freed: number }> {
  let total = totalBytes;
  let deleted = 0;
  let freed = 0;
  const sorted = [...archives].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const a of sorted) {
    if (total <= threshold) break;
    if (!a.key.startsWith(PREFIX.archive)) continue;
    const b = bytesOf(a.value);
    await repo.delete(a.key);
    total -= b;
    freed += b;
    deleted++;
  }
  return { deleted, freed };
}
