/**
 * App State key helpers on top of the frozen KEY/PREFIX schema (data/repository.ts, spec §4).
 * Keys are lower-case `[a-z0-9._-]`, ≤ 200 chars.
 */

import type { Channel } from "./contracts";
import { KEY, PREFIX } from "../data/repository";
import { MAX_KEY_LENGTH, randomId, sanitizeSegment, uidHash, type Rng } from "./ids";

export { KEY, PREFIX };

const KEY_RE = /^[a-z0-9._-]+$/;

/** True when `key` only uses `[a-z0-9._-]` and is 1…200 chars long. */
export function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH && KEY_RE.test(key);
}

/** Throws when the key is not storable — use at write boundaries. */
export function assertValidKey(key: string): string {
  if (!isValidKey(key)) throw new Error(`Invalid app-state key: ${key.slice(0, 220)}`);
  return key;
}

/** Parts of a notification key (see notificationKey). */
export interface NotificationKeyParts {
  incidentId: string;
  cycle: number;
  /** Escalation ordinal: pass × steps.length + stepIndex (see escalation/machine.ts). */
  step: number;
  uid: string;
  channel: Channel;
  attempt: number;
}

/**
 * `<incId>.<cycle>.<step>.<uidHash>.<channel>.<attempt>` — the NotificationRecord.key and the
 * suffix of `ntf.<…>` ledger keys.
 */
export function notificationKey(p: NotificationKeyParts): string {
  return `${p.incidentId}.${p.cycle}.${p.step}.${uidHash(p.uid)}.${p.channel}.${p.attempt}`;
}

/** Same notification, different attempt. */
export function withAttempt(key: string, attempt: number): string {
  const i = key.lastIndexOf(".");
  return `${i < 0 ? key : key.slice(0, i)}.${attempt}`;
}

/** A notification key split back into its parts; the uid is only available as its hash. */
export interface ParsedNotificationKey {
  incidentId: string;
  cycle: number;
  step: number;
  uidHash: string;
  channel: string;
  attempt: number;
}

/** Splits a notification key (with or without the `ntf.` prefix); undefined when it is malformed. */
export function parseNotificationKey(key: string): ParsedNotificationKey | undefined {
  const k = key.startsWith(PREFIX.notification) ? key.slice(PREFIX.notification.length) : key;
  const parts = k.split(".");
  if (parts.length < 6) return undefined;
  const [attempt, channel, hash, step, cycle] = [
    parts[parts.length - 1],
    parts[parts.length - 2],
    parts[parts.length - 3],
    parts[parts.length - 4],
    parts[parts.length - 5],
  ];
  const incidentId = parts.slice(0, parts.length - 5).join(".");
  const n = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : NaN);
  if (!incidentId || Number.isNaN(n(cycle)) || Number.isNaN(n(step)) || Number.isNaN(n(attempt))) {
    return undefined;
  }
  return {
    incidentId,
    cycle: n(cycle),
    step: n(step),
    uidHash: hash ?? "",
    channel: channel ?? "",
    attempt: n(attempt),
  };
}

/** New append-only action key `act.<incId>.<ts13>.<rand6>`. */
export function newActionKey(incidentId: string, at: number, rng: Rng): string {
  return KEY.action(sanitizeSegment(incidentId), Math.max(0, Math.floor(at)), randomId(rng, 6));
}

/** Incident id embedded in an `act.<incId>.<ts13>.<rand>` key. */
export function incidentIdFromActionKey(key: string): string | undefined {
  if (!key.startsWith(PREFIX.action)) return undefined;
  const parts = key.slice(PREFIX.action.length).split(".");
  if (parts.length < 3) return undefined;
  return parts.slice(0, parts.length - 2).join(".");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC `yyyy-mm-dd` (rollup day). */
export function utcDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** UTC `yyyymmdd` (archive key segment). */
export function utcDayCompact(ts: number): string {
  return utcDay(ts).replace(/-/g, "");
}
