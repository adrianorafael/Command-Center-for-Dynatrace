import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../../ui/app/data/memoryRepository";
import { KEY, type Repository, type Stored } from "../../ui/app/data/repository";
import { acquireLease, leaseLost, releaseLease, type EngineLock } from "../lib/lease";

/** Repository whose reads of lock.engine return the PREVIOUS value for the next `staleReads` reads after a write. */
function staleRepo(staleReads: number): Repository {
  const inner = new MemoryRepository();
  let previous: Stored<unknown> | undefined;
  let left = 0;
  return {
    get: async <T,>(key: string) => {
      if (key === KEY.lock && left > 0) {
        left--;
        return previous as Stored<T> | undefined;
      }
      return inner.get<T>(key);
    },
    list: (p) => inner.list(p),
    put: async (key, value, ttl) => {
      if (key === KEY.lock) {
        previous = await inner.get(key);
        left = staleReads;
      }
      return inner.put(key, value, ttl);
    },
    delete: (k) => inner.delete(k),
  };
}

const noWait = () => Promise.resolve();

describe("engine lease with stale reads", () => {
  it("acquires when the read-back is stale (old lease) and releases its own lease", async () => {
    const repo = staleRepo(0);
    await repo.put<EngineLock>(KEY.lock, { holder: "old", acquiredAt: 1_000 });
    const stale = staleRepo(2);
    await stale.put<EngineLock>(KEY.lock, { holder: "old", acquiredAt: 1_000 });
    // lease expired (TTL 150 s): the new cycle overwrites it; the next 2 reads still show "old"
    expect(await acquireLease(stale, "new", 1_000 + 200_000, 150, noWait)).toBe(true);
    expect(await leaseLost(stale, "new", 201_000)).toBe(false);
    expect(await releaseLease(stale, "new", 201_000)).toBe(true);
    expect((await stale.get(KEY.lock))).toBeUndefined();
  });

  it("does not acquire a live lease held by another cycle", async () => {
    const repo = staleRepo(0);
    await repo.put<EngineLock>(KEY.lock, { holder: "other", acquiredAt: 100_000 });
    expect(await acquireLease(repo, "me", 130_000, 150, noWait)).toBe(false);
  });

  it("loses the lease only to a newer holder", async () => {
    const repo = staleRepo(0);
    await repo.put<EngineLock>(KEY.lock, { holder: "older", acquiredAt: 1 });
    expect(await leaseLost(repo, "me", 10)).toBe(false);
    await repo.put<EngineLock>(KEY.lock, { holder: "newer", acquiredAt: 20 });
    expect(await leaseLost(repo, "me", 10)).toBe(true);
    // and release leaves a newer holder's lease alone
    expect(await releaseLease(repo, "me", 10)).toBe(true);
    expect((await repo.get<EngineLock>(KEY.lock))?.value.holder).toBe("newer");
  });
});
