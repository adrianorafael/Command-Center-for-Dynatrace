/**
 * Best-effort engine lease on `lock.engine` (spec §2 step 1). App State has no compare-and-set,
 * so two ticks can still overlap in a narrow window; correctness comes from the notification
 * ledger (at-least-once), the lease only reduces overlap.
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
  // Compare on acquiredAt: the platform TTL floor is 1 min, so an expired lease may still exist.
  if (current && current.value.holder !== holder && now - current.value.acquiredAt < ttlMs) return false;
  await repo.put<EngineLock>(KEY.lock, { holder, acquiredAt: now }, ttlMs);
  const check = await repo.get<EngineLock>(KEY.lock);
  return check?.value.holder === holder;
}

export async function releaseLease(repo: Repository, holder: string): Promise<void> {
  const current = await repo.get<EngineLock>(KEY.lock);
  if (current?.value.holder === holder) await repo.delete(KEY.lock);
}
