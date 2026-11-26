/**
 * Best-effort engine lease on `lock.engine` (spec §2 step 1). App State has no compare-and-set,
 * so two ticks can still overlap in a narrow window; correctness comes from the notification
 * ledger (at-least-once), the lease only reduces overlap.
 *
 * Only the engine tick takes the lease (delivery-report never does — it used to, and a report
 * overlapping the next minute's tick made that tick skip, delaying escalation steps).
 */

import { KEY, type Repository } from "../../ui/app/data/repository";

export interface EngineLock {
  holder: string;
  acquiredAt: number;
}

export async function acquireLease(
  repo: Repository,
  holder: string,
  now: number,
  ttlSec: number,
): Promise<boolean> {
  const ttlMs = Math.max(1, ttlSec) * 1000;
  const current = await repo.get<EngineLock>(KEY.lock);
  // Compare on acquiredAt: the platform TTL floor is 1 min and deletes can fail, so an expired
  // lease may still exist — it is simply overwritten, never waited for.
  if (current && current.value.holder !== holder && now - current.value.acquiredAt < ttlMs) return false;
  await repo.put<EngineLock>(KEY.lock, { holder, acquiredAt: now }, ttlMs);
  const check = await repo.get<EngineLock>(KEY.lock);
  return check?.value.holder === holder;
}

/**
 * Release and verify by re-reading. If the delete did not take effect, the lease is overwritten
 * as already expired (acquiredAt 0) so the next tick is never blocked by a failed release.
 * Returns true when no lease of ours remains.
 */
export async function releaseLease(repo: Repository, holder: string): Promise<boolean> {
  const ours = async () => (await repo.get<EngineLock>(KEY.lock).catch(() => undefined))?.value.holder === holder;
  if (!(await ours())) return true;
  await repo.delete(KEY.lock).catch(() => undefined);
  if (!(await ours())) return true;
  await repo.put<EngineLock>(KEY.lock, { holder: `${holder}-released`, acquiredAt: 0 }, 60_000).catch(() => undefined);
  return !(await ours());
}
