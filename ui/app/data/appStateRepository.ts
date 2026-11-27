/**
 * Repository adapter over the App State service (@dynatrace-sdk/client-state 1.11).
 *
 * Verified against node_modules/@dynatrace-sdk/client-state/types/index.d.ts:
 *  - getAppStates({ addFields?, filter? }) → ListAppState[] {key, value?, modificationInfo?, validUntilTime?}
 *    (list returns only `key` unless addFields asks for more; `starts-with` is case-insensitive)
 *  - getAppState({ key }) → AppState; throws NotFound (isNotFound guard) for a missing key
 *  - setAppState({ key, body: { value: string, validUntilTime? } })
 *    validUntilTime: "Allowed are values from now+1m to now+90d"
 *  - deleteAppState({ key }); throws NotFound for a missing key
 *  - ModificationInfo { lastModifiedBy: string; lastModifiedTime: Date }
 *
 * No version/etag exists on the API → last write wins (see spec H2).
 * Scopes: state:app-states:read / :write / :delete.
 *
 * Usable from the UI and from app functions (no DOM APIs).
 */

import { isNotFound, stateClient } from "@dynatrace-sdk/client-state";
import type { Repository, Stored } from "./repository";
import { clampTtlMs } from "./memoryRepository";

/** The subset of StateClient this adapter uses (injectable for tests). */
export interface StateClientLike {
  getAppStates(config?: {
    addFields?: string;
    filter?: string;
  }): Promise<
    {
      key: string;
      value?: string;
      modificationInfo?: { lastModifiedBy: string; lastModifiedTime: Date | string };
    }[]
  >;
  getAppState(config: { key: string }): Promise<{
    value: string;
    modificationInfo?: { lastModifiedBy: string; lastModifiedTime: Date | string };
  }>;
  setAppState(config: { key: string; body: { value: string; validUntilTime?: string | null } }): Promise<void>;
  deleteAppState(config: { key: string }): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9._-]{1,200}$/;

/** Throws for a key App State would reject, before any request is made. */
export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Invalid app-state key (allowed: [a-z0-9._-], ≤ 200 chars): ${key.slice(0, 60)}`);
  }
}

/**
 * validUntilTime for a TTL. The documented *input* example is the relative form "now+2d";
 * returned values are ISO 8601. We send ISO 8601 of the absolute instant.
 * ⚠️ UNVERIFIED: whether absolute ISO input is accepted (only the relative example is documented).
 * Kept in one place so it can be switched to `now+<n>m` if the tenant rejects ISO.
 */
export function validUntilTime(ttlMs: number, now: number = Date.now()): string {
  return new Date(now + clampTtlMs(ttlMs)).toISOString();
}

/** Documented relative form ("now+2d" in the SDK example), in whole minutes. */
export function relativeValidUntil(ttlMs: number): string {
  return `now+${Math.round(clampTtlMs(ttlMs) / 60_000)}m`;
}

function toEpoch(t: Date | string | undefined): number | undefined {
  if (t === undefined) return undefined;
  const ms = t instanceof Date ? t.getTime() : Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}

function parse<T>(key: string, raw: string | undefined): T | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A value written by something other than this app (e.g. v1's raw strings): skip, never crash.
    console.warn(`app-state value for ${key.slice(0, 60)} is not JSON; ignored`);
    return undefined;
  }
}

/** Repository over App State. get/delete treat a missing key as undefined / success; values are JSON text. */
export class AppStateRepository implements Repository {
  constructor(private readonly client: StateClientLike = stateClient as unknown as StateClientLike) {}

  async get<T>(key: string): Promise<Stored<T> | undefined> {
    assertValidKey(key);
    try {
      const s = await this.client.getAppState({ key });
      const value = parse<T>(key, s.value);
      if (value === undefined) return undefined;
      return {
        key,
        value,
        lastModifiedBy: s.modificationInfo?.lastModifiedBy,
        lastModifiedTime: toEpoch(s.modificationInfo?.lastModifiedTime),
      };
    } catch (e) {
      if (isNotFound(e) || statusOf(e) === 404) return undefined;
      throw e;
    }
  }

  async list<T>(prefix: string): Promise<Stored<T>[]> {
    // Prefix is always one of our own PREFIX constants; still refuse quotes to keep the filter well-formed.
    if (!/^[a-z0-9._-]+$/.test(prefix)) throw new Error(`Invalid key prefix: ${prefix.slice(0, 60)}`);
    const rows = await this.client.getAppStates({
      filter: `key starts-with '${prefix}'`,
      addFields: "value,modificationInfo",
    });
    const out: Stored<T>[] = [];
    for (const r of rows) {
      // starts-with is case-insensitive on the server; enforce the exact prefix here.
      if (!r.key.startsWith(prefix)) continue;
      const value = parse<T>(r.key, r.value);
      if (value === undefined) continue;
      out.push({
        key: r.key,
        value,
        lastModifiedBy: r.modificationInfo?.lastModifiedBy,
        lastModifiedTime: toEpoch(r.modificationInfo?.lastModifiedTime),
      });
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  }

  async put<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    assertValidKey(key);
    const json = JSON.stringify(value);
    if (ttlMs === undefined) {
      await this.client.setAppState({ key, body: { value: json } });
      return;
    }
    try {
      await this.client.setAppState({ key, body: { value: json, validUntilTime: validUntilTime(ttlMs) } });
    } catch (e) {
      // ISO input is UNVERIFIED; on a 400 fall back once to the documented relative form.
      if (statusOf(e) !== 400) throw e;
      await this.client.setAppState({ key, body: { value: json, validUntilTime: relativeValidUntil(ttlMs) } });
    }
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    try {
      await this.client.deleteAppState({ key });
    } catch (e) {
      if (isNotFound(e) || statusOf(e) === 404) return; // already gone = success
      throw e;
    }
  }
}

function statusOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "response" in e) {
    const r = (e as { response?: { status?: unknown } }).response;
    if (r && typeof r.status === "number") return r.status;
  }
  return undefined;
}
