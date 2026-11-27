/**
 * Best-effort engine lease on `lock.engine` (spec §2 step 1). App State has no compare-and-set, so two
 * cycles can still overlap in a narrow window; correctness comes from the notification ledger
 * (at-least-once), the lease only reduces overlap.
 *
 * Reads right after a write can be stale (observed on a trial tenant, 2026-11-27: a cycle read back the
 * previous lease, counted itself as "locked", never released its own lease and the next two minutes of
 * cycles were skipped). So every decision compares `acquiredAt`:
 *  - a read showing an OLDER lease than ours is stale, not a competitor;
 *  - the lease is lost only when ANOTHER holder has a lease at least as new as ours;
 *  - release deletes when the lease is ours or older than ours (a stale view of the one we replaced).
 */

import { KEY, type Repository } from "../../ui/app/data/repository";

/** Value stored under `lock.engine`: who holds the lease and since when (epoch ms; 0 marks a released lease). */
export interface EngineLock {
  holder: string;
  acquiredAt: number;
}

const READ_RETRIES = 3;
const READ_RETRY_MS = 250;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads the lease; errors propagate (a failing state service must fail the cycle, not be mistaken for "free"). */
async function read(repo: Repository): Promise<EngineLock | undefined> {
  return (await repo.get<EngineLock>(KEY.lock))?.value;
}

/** True when another holder took a newer lease than ours (a stale or older value is not a loss). */
export async function leaseLost(repo: Repository, holder: string, acquiredAt: number): Promise<boolean> {
  const cur = await read(repo);
  return !!cur && cur.holder !== holder && cur.acquiredAt >= acquiredAt;
}

/**
 * Takes the lease unless another holder's lease is younger than `ttlSec`. Writes, then re-reads to tell a stale read
 * of our own write from a competitor's write; returns false when a competitor wrote at the same time or later.
 */
export async function acquireLease(
  repo: Repository,
  holder: string,
  now: number,
  ttlSec: number,
  wait: (ms: number) => Promise<unknown> = pause,
): Promise<boolean> {
  const ttlMs = Math.max(1, ttlSec) * 1000;
  const current = await read(repo);
  // An expired lease (deletes can fail; the platform TTL floor is 1 min) is overwritten, never waited for.
  if (current && current.holder !== holder && now - current.acquiredAt < ttlMs) return false;
  await repo.put<EngineLock>(KEY.lock, { holder, acquiredAt: now }, ttlMs);
  for (let i = 0; i < READ_RETRIES; i++) {
    const check = await read(repo);
    if (check?.holder === holder) return true;
    if (check && check.acquiredAt >= now) return false; // a competitor wrote at the same time or later
    await wait(READ_RETRY_MS); // missing or older value: a stale read of our own write
  }
  return true; // we wrote last; reads are still stale
}

/**
 * Release and verify. Deletes when the lease is ours or older than ours; if the delete does not take
 * effect, overwrites the lease as already expired (acquiredAt 0) so the next cycle is never blocked.
 * Returns true when no lease of ours (or older) remains.
 */
export async function releaseLease(repo: Repository, holder: string, acquiredAt = Number.MAX_SAFE_INTEGER): Promise<boolean> {
  const mineOrOlder = async () => {
    const cur = await read(repo).catch(() => undefined);
    return !!cur && (cur.holder === holder || cur.acquiredAt < acquiredAt) && cur.acquiredAt !== 0;
  };
  if (!(await mineOrOlder())) return true;
  await repo.delete(KEY.lock).catch(() => undefined);
  if (!(await mineOrOlder())) return true;
  await repo.put<EngineLock>(KEY.lock, { holder: `${holder}-released`, acquiredAt: 0 }, 60_000).catch(() => undefined);
  return !(await mineOrOlder());
}
