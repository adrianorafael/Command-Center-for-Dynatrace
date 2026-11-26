/**
 * Normalise raw Grail records into Alerts.
 *
 * Sources (spec §H3, §7 — field names UNVALIDATED against a tenant except where the lead
 * supplied live samples):
 * - dt.davis.problems  → source "davis-problem"
 * - dt.davis.events    → source "davis-event" (custom Events API v2 `properties` arrive as
 *   top-level fields, so the `cc.*` convention also works there)
 * - events (generic)   → source "generic-event", convention:
 *     event.type == "command_center.alert", cc.dedup_key, cc.action trigger|resolve,
 *     cc.priority, cc.service, cc.tags; or the summarised Q3 row shape
 *     {cc.dedup_key, last_action, title, priority, service, first_seen, last_seen}.
 *
 * Tolerates smartscape.* and the deprecated affected_entity_ids / affected_entity_names /
 * root_cause_entity_* / entity_tags fields; timestamps as ISO strings (nanosecond fractions
 * are truncated to ms) or numbers (s, ms or ns — inferred from magnitude).
 */

import type { Alert, AlertSource, EntityRef } from "../contracts";
import { dedupKeyFor } from "../ids";

export type RawRecord = Record<string, unknown>;

export const MAX_TITLE = 500;
export const MAX_DESCRIPTION = 4000;
export const MAX_FIELDS = 120;
export const MAX_FIELD_VALUE = 500;

/** Canonical Davis categories (semantic dictionary); others map to "OTHER". */
export const KNOWN_CATEGORIES = [
  "AVAILABILITY",
  "ERROR",
  "SLOWDOWN",
  "RESOURCE_CONTENTION",
  "CUSTOM_ALERT",
  "MONITORING_UNAVAILABLE",
  "INFO",
] as const;

const CATEGORY_ALIASES: Record<string, string> = {
  RESOURCE: "RESOURCE_CONTENTION",
  CUSTOM: "CUSTOM_ALERT",
  PERFORMANCE: "SLOWDOWN",
};

// ─── primitive coercion ──────────────────────────────────────────────────────

export function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v.length > 0 ? v : undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "bigint") return v.toString();
  return undefined;
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  if (typeof v === "number") return v !== 0;
  return undefined;
}

/** Epoch ms from ISO string / number (s, ms, µs or ns by magnitude) / Date. */
export function asTimestamp(v: unknown): number | undefined {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : undefined;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d+(\.\d+)?$/.test(s)) return asTimestamp(Number(s));
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : undefined;
  }
  const n = asNumber(v);
  if (n === undefined || n <= 0) return undefined;
  if (n >= 1e17) return Math.floor(n / 1e6); // ns
  if (n >= 1e14) return Math.floor(n / 1e3); // µs
  if (n >= 1e11) return Math.floor(n); // ms
  return Math.floor(n * 1000); // s
}

/** Array of strings from an array, a JSON array string or a comma-separated string. */
export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => asString(x) ?? entityFromUnknown(x)?.id).filter((x): x is string => !!x);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(s);
        if (Array.isArray(parsed)) return asStringArray(parsed);
      } catch {
        /* fall through */
      }
    }
    return s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  const one = asString(v);
  return one ? [one] : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pick(rec: RawRecord, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function entityFromUnknown(v: unknown): EntityRef | undefined {
  if (typeof v === "string") return v ? { id: v } : undefined;
  if (!isRecord(v)) return undefined;
  const id = asString(v["id"]) ?? asString(v["entityId"]) ?? asString(v["dt.entity.id"]);
  if (!id) return undefined;
  const name = asString(v["name"]) ?? asString(v["entity.name"]);
  const type = asString(v["type"]) ?? asString(v["entity.type"]);
  return { id, ...(name ? { name } : {}), ...(type ? { type } : {}) };
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function normalizeCategory(v: unknown): string | undefined {
  const s = asString(v)?.trim().toUpperCase();
  if (!s) return undefined;
  const c = CATEGORY_ALIASES[s] ?? s;
  return (KNOWN_CATEGORIES as readonly string[]).includes(c) ? c : "OTHER";
}

function severityOf(v: unknown): number | undefined {
  const n = asNumber(v);
  if (n === undefined) return undefined;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : undefined;
}

// ─── shared extraction ───────────────────────────────────────────────────────

export function extractEntities(rec: RawRecord): EntityRef[] {
  const out: EntityRef[] = [];
  const seen = new Set<string>();
  const add = (e: EntityRef | undefined) => {
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  };
  const ss = rec["smartscape.affected_entities"];
  if (Array.isArray(ss)) ss.forEach((x) => add(entityFromUnknown(x)));
  else add(entityFromUnknown(ss));
  const ids = asStringArray(rec["affected_entity_ids"]);
  const names = asStringArray(rec["affected_entity_names"]);
  const types = asStringArray(rec["affected_entity_types"]);
  ids.forEach((id, i) => {
    const name = names[i];
    const type = types[i];
    add({ id, ...(name ? { name } : {}), ...(type ? { type } : {}) });
  });
  const src = asString(rec["dt.source_entity"]);
  if (src) {
    const name = asString(rec["dt.source_entity.name"]) ?? asString(rec["entity.name"]);
    const type = asString(rec["dt.source_entity.type"]) ?? asString(rec["entity.type"]);
    add({ id: src, ...(name ? { name } : {}), ...(type ? { type } : {}) });
  }
  return out.slice(0, 100);
}

export function extractRootCause(rec: RawRecord): Alert["rootCause"] {
  const ss = entityFromUnknown(rec["root_cause.smartscape_entity"]);
  const id = ss?.id ?? asString(rec["root_cause_entity_id"]);
  const name = ss?.name ?? asString(rec["root_cause_entity_name"]);
  if (!id && !name) return undefined;
  return { ...(id ? { id } : {}), ...(name ? { name } : {}) };
}

export function extractTags(rec: RawRecord): string[] {
  const tags = new Set<string>();
  for (const t of asStringArray(rec["entity_tags"])) tags.add(t);
  for (const t of asStringArray(rec["cc.tags"])) tags.add(t);
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith("primary_tags.")) {
      const name = k.slice("primary_tags.".length);
      for (const val of asStringArray(v)) tags.add(`${name}:${val}`);
    }
  }
  return Array.from(tags).slice(0, 100);
}

/** Flatten primitive (and array-of-primitive) top-level fields to strings. */
export function extractFields(rec: RawRecord): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(rec)) {
    if (n >= MAX_FIELDS) break;
    if (k === "event.description") continue;
    let s: string | undefined;
    if (Array.isArray(v)) {
      const arr = asStringArray(v);
      s = arr.length ? arr.join(",") : undefined;
    } else {
      s = asString(v);
    }
    if (s === undefined) continue;
    out[k] = clip(s, MAX_FIELD_VALUE);
    n++;
  }
  return out;
}

function baseAlert(
  source: AlertSource,
  sourceId: string,
  rec: RawRecord,
  now: number,
  status: "ACTIVE" | "CLOSED",
): Alert {
  const title = asString(pick(rec, "event.name", "title", "display_id")) ?? "Untitled alert";
  const description = asString(rec["event.description"]);
  const category = normalizeCategory(pick(rec, "event.category", "cc.category"));
  const severity = severityOf(pick(rec, "event.severity", "cc.severity"));
  const startedAt = asTimestamp(pick(rec, "event.start", "timestamp")) ?? now;
  const endedAt = status === "CLOSED" ? asTimestamp(rec["event.end"]) : undefined;
  const reopenedAt = asTimestamp(rec["dt.davis.last_reopen_timestamp"]);
  const affectedUsers = asNumber(rec["dt.davis.affected_users_count"]);
  const rootCause = extractRootCause(rec);
  const displayId = asString(rec["display_id"]);
  return {
    source,
    sourceId,
    dedupKey: dedupKeyFor(source, sourceId),
    ...(displayId ? { displayId } : {}),
    title: clip(title, MAX_TITLE),
    ...(description ? { description: clip(description, MAX_DESCRIPTION) } : {}),
    ...(category ? { category } : {}),
    ...(severity !== undefined ? { severity } : {}),
    sourceStatus: status,
    startedAt,
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(reopenedAt !== undefined ? { reopenedAt } : {}),
    entities: extractEntities(rec),
    ...(rootCause ? { rootCause } : {}),
    tags: extractTags(rec),
    underMaintenance: asBoolean(rec["maintenance.is_under_maintenance"]) ?? false,
    muted: (asString(rec["dt.davis.mute.status"]) ?? "").toUpperCase() === "MUTED",
    ...(affectedUsers !== undefined ? { affectedUsers } : {}),
    fields: extractFields(rec),
  };
}

function statusOf(rec: RawRecord): "ACTIVE" | "CLOSED" {
  const s = (asString(rec["event.status"]) ?? "").toUpperCase();
  const action = (asString(rec["cc.action"]) ?? "").toLowerCase();
  return s === "CLOSED" || action === "resolve" ? "CLOSED" : "ACTIVE";
}

// ─── per-source normalisers ──────────────────────────────────────────────────

/** dt.davis.problems record → Alert (undefined for duplicates or records without an id). */
export function normalizeProblem(rec: RawRecord, now: number): Alert | undefined {
  if (asBoolean(rec["dt.davis.is_duplicate"]) === true) return undefined;
  const id = asString(pick(rec, "event.id", "display_id"));
  if (!id) return undefined;
  return baseAlert("davis-problem", id, rec, now, statusOf(rec));
}

/**
 * dt.davis.events record → Alert. `cc.dedup_key` (if sent as an Events API property) is
 * used as the source id so re-sent events collapse; `fields["event.id"]` keeps the Davis id.
 */
export function normalizeDavisEvent(rec: RawRecord, now: number): Alert | undefined {
  const eventId = asString(rec["event.id"]);
  const id = asString(rec["cc.dedup_key"]) ?? eventId;
  if (!id) return undefined;
  return baseAlert("davis-event", id, rec, now, statusOf(rec));
}

function isSummaryRow(rec: RawRecord): boolean {
  return "last_action" in rec || "first_seen" in rec || "last_seen" in rec;
}

/**
 * Generic `events` records (raw or summarised by cc.dedup_key) → Alerts, one per dedup key.
 * Raw records of the same key are folded in timestamp order: the last action decides the
 * status, the first trigger is `startedAt`, a later trigger becomes `reopenedAt`.
 */
export function normalizeGenericEvents(records: RawRecord[], now: number): Alert[] {
  const groups = new Map<string, RawRecord[]>();
  const out: Alert[] = [];
  for (const rec of records) {
    if (isSummaryRow(rec)) {
      const a = normalizeGenericSummary(rec, now);
      if (a) out.push(a);
      continue;
    }
    const key =
      asString(rec["cc.dedup_key"]) ?? asString(rec["event.id"]) ?? asString(rec["event.name"]);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(rec);
    else groups.set(key, [rec]);
  }
  for (const [key, recs] of groups) {
    const sorted = recs
      .map((r, i) => ({ r, t: asTimestamp(pick(r, "timestamp", "event.start")) ?? now, i }))
      .sort((a, b) => a.t - b.t || a.i - b.i);
    const last = sorted[sorted.length - 1];
    if (!last) continue;
    const triggers = sorted.filter((x) => statusOf(x.r) === "ACTIVE");
    const merged: RawRecord = {};
    for (const x of sorted) Object.assign(merged, x.r);
    const status = statusOf(last.r);
    const first = triggers[0] ?? sorted[0];
    const lastTrigger = triggers[triggers.length - 1];
    const a = baseAlert("generic-event", key, merged, now, status);
    a.startedAt = first ? first.t : now;
    if (status === "CLOSED") a.endedAt = last.t;
    else delete a.endedAt;
    if (lastTrigger && first && lastTrigger.t > first.t) a.reopenedAt = lastTrigger.t;
    out.push(a);
  }
  return out;
}

function normalizeGenericSummary(rec: RawRecord, now: number): Alert | undefined {
  const key = asString(rec["cc.dedup_key"]) ?? asString(rec["dedup_key"]);
  if (!key) return undefined;
  const lastAction = (asString(rec["last_action"]) ?? "trigger").toLowerCase();
  const status = lastAction === "resolve" ? "CLOSED" : "ACTIVE";
  const first = asTimestamp(rec["first_seen"]) ?? now;
  const last = asTimestamp(rec["last_seen"]) ?? first;
  const flat: RawRecord = { ...rec };
  if (rec["title"] !== undefined && rec["event.name"] === undefined) flat["event.name"] = rec["title"];
  if (rec["priority"] !== undefined && rec["cc.priority"] === undefined) flat["cc.priority"] = rec["priority"];
  if (rec["service"] !== undefined && rec["cc.service"] === undefined) flat["cc.service"] = rec["service"];
  if (rec["tags"] !== undefined && rec["cc.tags"] === undefined) flat["cc.tags"] = rec["tags"];
  const a = baseAlert("generic-event", key, flat, now, status);
  a.startedAt = first;
  if (status === "CLOSED") a.endedAt = last;
  if (status === "ACTIVE" && last > first) a.reopenedAt = last;
  return a;
}

export interface RawSourceRecords {
  problems?: RawRecord[];
  davisEvents?: RawRecord[];
  genericEvents?: RawRecord[];
}

/** Normalise all sources (no dedup — see alerts/dedup.ts). */
export function normalizeRecords(src: RawSourceRecords, now: number): Alert[] {
  const out: Alert[] = [];
  for (const r of src.problems ?? []) {
    const a = normalizeProblem(r, now);
    if (a) out.push(a);
  }
  for (const r of src.davisEvents ?? []) {
    const a = normalizeDavisEvent(r, now);
    if (a) out.push(a);
  }
  out.push(...normalizeGenericEvents(src.genericEvents ?? [], now));
  return out;
}
