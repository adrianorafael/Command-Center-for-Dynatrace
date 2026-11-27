/**
 * In-memory Repository adapter — demo mode and tests.
 *
 * Values are deep-copied through JSON on the way in and out so callers can never mutate
 * stored state by reference (the App State adapter behaves the same way, it stores strings).
 */

import type { Repository, Stored } from "./repository";

interface Entry {
  json: string;
  lastModifiedBy?: string;
  lastModifiedTime: number;
  /** Epoch ms; undefined = no expiry. */
  expiresAt?: number;
}

/** One initial entry (demo fixtures, test setup); seeds never expire. */
export interface MemorySeed {
  key: string;
  value: unknown;
  lastModifiedBy?: string;
  lastModifiedTime?: number;
}

export interface MemoryRepositoryOptions {
  /** Identity recorded as lastModifiedBy on writes (mirrors the platform's modificationInfo). */
  actor?: string;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/** Repository in a Map, with TTL expiry checked on read. Unlike App State it does not validate keys. */
export class MemoryRepository implements Repository {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  /** Identity stamped on subsequent writes; tests may change it between writes. */
  actor: string | undefined;

  constructor(seed: Iterable<MemorySeed> = [], options: MemoryRepositoryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.actor = options.actor;
    for (const s of seed) {
      this.entries.set(s.key, {
        json: JSON.stringify(s.value),
        lastModifiedBy: s.lastModifiedBy,
        lastModifiedTime: s.lastModifiedTime ?? this.now(),
      });
    }
  }

  private live(key: string): Entry | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== undefined && e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  private toStored<T>(key: string, e: Entry): Stored<T> {
    return {
      key,
      value: JSON.parse(e.json) as T,
      lastModifiedBy: e.lastModifiedBy,
      lastModifiedTime: e.lastModifiedTime,
    };
  }

  get<T>(key: string): Promise<Stored<T> | undefined> {
    const e = this.live(key);
    return Promise.resolve(e ? this.toStored<T>(key, e) : undefined);
  }

  list<T>(prefix: string): Promise<Stored<T>[]> {
    const out: Stored<T>[] = [];
    // App State's starts-with is case-insensitive; keys are lower-case by contract anyway.
    const p = prefix.toLowerCase();
    for (const key of [...this.entries.keys()].sort()) {
      if (!key.toLowerCase().startsWith(p)) continue;
      const e = this.live(key);
      if (e) out.push(this.toStored<T>(key, e));
    }
    return Promise.resolve(out);
  }

  put<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const now = this.now();
    this.entries.set(key, {
      json: JSON.stringify(value),
      lastModifiedBy: this.actor,
      lastModifiedTime: now,
      expiresAt: ttlMs === undefined ? undefined : now + clampTtlMs(ttlMs),
    });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  /** Test/debug helper: number of live keys. */
  size(): number {
    return [...this.entries.keys()].filter((k) => this.live(k) !== undefined).length;
  }

  /** Test/debug helper: all live keys, sorted. */
  keys(): string[] {
    return [...this.entries.keys()].filter((k) => this.live(k) !== undefined).sort();
  }
}

/** Shortest TTL App State accepts (1 min). */
export const TTL_MIN_MS = 60_000;
/** Longest TTL App State accepts (90 days). */
export const TTL_MAX_MS = 90 * 24 * 3600_000;

/** Platform window for validUntilTime: now+1m … now+90d (client-state PersistenceState docs). */
export function clampTtlMs(ttlMs: number): number {
  if (!Number.isFinite(ttlMs)) return TTL_MAX_MS;
  return Math.min(TTL_MAX_MS, Math.max(TTL_MIN_MS, Math.round(ttlMs)));
}
