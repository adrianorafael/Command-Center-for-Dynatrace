/**
 * DQL query builders (spec §7).
 *
 * Evidence (2026-11-26, trial tenant, see spec evidence notes):
 *  - Q1, Q2, Q4 were EXECUTED against a live trial tenant and returned records for a test
 *    CUSTOM_ALERT ingested via the Events API v2 (problem + Davis event). Field shapes observed:
 *    timestamps are ISO-8601 strings with nanoseconds ("…T21:39:03.750000000Z"), event.end is
 *    null while ACTIVE, event.severity was null, event.id == display_id for problems ("P-…"),
 *    dt.davis.event_ids is a string array linking to dt.davis.events event.id, custom
 *    properties posted with the event (cc.*) appear as top-level fields on dt.davis.events only
 *    (not on the problem), and `fieldsKeep` omits fields that are absent on a record.
 *  - Q3 PARSED and executed without error but returned no records (no generic events with the
 *    convention were ingested) → semantics ⚠️ UNVALIDATED.
 *  - Q5 (one problem's newest status, for the Problem trigger) — evidence at buildProblemStatusQuery.
 *  - Davis tables hold one record per status change: every query dedups by event.id keeping the
 *    newest record BEFORE filtering on status, so a stale ACTIVE cannot outlive a CLOSED.
 *
 * Every interpolated value is allow-listed or clamped here — no user text reaches DQL verbatim.
 */

import type { Settings } from "../domain/contracts";

/** `| limit` of every list query; a result this long counts as truncated (asGrailResult). */
export const DQL_LIMIT = 1000;

/** Clamp an hour lookback to 1…720 h (integer). */
export function clampHours(h: number, fallback = 72): number {
  const n = Number.isFinite(h) ? Math.floor(h) : fallback;
  return Math.min(720, Math.max(1, n));
}

const EVENT_TYPE_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Allow-list event type tokens (e.g. CUSTOM_ALERT, command_center.alert). Drops anything else. */
export function safeEventTypes(types: readonly string[]): string[] {
  return [...new Set(types.map((t) => t.trim()).filter((t) => EVENT_TYPE_RE.test(t)))];
}

/** Allow-list event / problem ids (e.g. "P-…", Davis event ids); duplicates removed. */
export function safeEventIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((t) => EVENT_ID_RE.test(t)))];
}

function dqlString(s: string): string {
  // Values are allow-listed above; escaping is belt and braces.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Q1 — Davis problems (engine + console).
 * ✅ executed on a trial tenant (2026-11-26); field shapes above. Long-running problems
 * older than the lookback: ⚠️ UNVALIDATED (hence 72 h default and "never resolve on absence").
 */
export function buildProblemsQuery(settings: Pick<Settings, "sources">): string {
  const h = clampHours(settings.sources.davisProblems.lookbackHours);
  return [
    `fetch dt.davis.problems, from: now() - ${h}h`,
    `| filter not(dt.davis.is_duplicate)`,
    `| dedup event.id, sort: { timestamp desc }`,
    `| filter event.status == "ACTIVE" or event.end >= now() - 2h`,
    `| fields timestamp, event.id, display_id, event.name, event.description, event.category, event.severity,`,
    `         event.status, event.start, event.end, dt.davis.last_reopen_timestamp,`,
    `         dt.davis.event_ids, dt.davis.affected_users_count, dt.davis.mute.status,`,
    `         maintenance.is_under_maintenance, smartscape.affected_entities, root_cause.smartscape_entity,`,
    `         affected_entity_ids, affected_entity_names, root_cause_entity_name, entity_tags`,
    `| sort event.start desc`,
    `| limit ${DQL_LIMIT}`,
  ].join("\n");
}

/**
 * Q2 — Davis events (optional source). Returns undefined when no valid event type is configured.
 * ✅ executed on a trial tenant (2026-11-26). `fieldsKeep` + "cc.*" carries custom properties.
 */
export function buildDavisEventsQuery(settings: Pick<Settings, "sources">): string | undefined {
  const types = safeEventTypes(settings.sources.davisEvents.eventTypes);
  if (types.length === 0) return undefined;
  return [
    `fetch dt.davis.events, from: now() - 24h`,
    `| filter in(event.type, array(${types.map(dqlString).join(", ")}))`,
    `| dedup event.id, sort: { timestamp desc }`,
    `| filter event.status == "ACTIVE" or event.end >= now() - 2h`,
    `| fieldsKeep timestamp, event.id, event.name, event.description, event.type, event.category, event.severity,`,
    `         event.status, event.start, event.end, event.provider, dt.davis.is_frequent_event,`,
    `         maintenance.is_under_maintenance, dt.source_entity, entity_tags, "cc.*"`,
    `| limit ${DQL_LIMIT}`,
  ].join("\n");
}

/**
 * Q3 — generic events convention (optional source):
 * event.type == <settings.sources.genericEvents.eventType>, cc.dedup_key, cc.action (trigger|resolve),
 * cc.priority, cc.service, cc.tags.
 * ⚠️ UNVALIDATED semantics: parsed and executed without error on a trial tenant, but no matching
 * records existed. `takeLast` depends on record order, hence the explicit ascending sort.
 */
export function buildGenericEventsQuery(settings: Pick<Settings, "sources">): string | undefined {
  const [type] = safeEventTypes([settings.sources.genericEvents.eventType]);
  if (!type) return undefined;
  return [
    `fetch events, from: now() - 24h`,
    `| filter event.type == ${dqlString(type)}`,
    `| filter isNotNull(cc.dedup_key)`,
    `| sort timestamp asc`,
    `| summarize { last_action = takeLast(cc.action), title = takeLast(event.name),`,
    `              description = takeLast(event.description), priority = takeLast(cc.priority),`,
    `              service = takeLast(cc.service), tags = takeLast(cc.tags),`,
    `              first_seen = min(timestamp), last_seen = max(timestamp) },`,
    `            by: { cc.dedup_key }`,
    `| limit ${DQL_LIMIT}`,
  ].join("\n");
}

/** Max event ids per Q4 call (keeps the query string short). */
export const Q4_CHUNK = 100;

/**
 * Q4 — custom properties (cc.*) of the Davis events that make up problems, for routing.
 * Problems do not carry their events' properties (observed on the tenant).
 * ✅ executed on a trial tenant (2026-11-26).
 */
export function buildProblemEventPropsQuery(eventIds: readonly string[], lookbackHours: number): string | undefined {
  const ids = safeEventIds(eventIds).slice(0, Q4_CHUNK);
  if (ids.length === 0) return undefined;
  return [
    `fetch dt.davis.events, from: now() - ${clampHours(lookbackHours)}h`,
    `| filter in(event.id, array(${ids.map(dqlString).join(", ")}))`,
    `| dedup event.id, sort: { timestamp desc }`,
    `| fieldsKeep event.id, event.type, event.provider, "cc.*"`,
    `| limit ${DQL_LIMIT}`,
  ].join("\n");
}

const PROBLEM_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Q5 — the newest record of ONE problem: its status and the Davis events it links to. Used by the engine run
 * that the Problem trigger starts, to wait until the problem can be read (the trigger fires before the record
 * is queryable). Returns undefined for anything that is not a plain problem id.
 * ✅ executed on a trial tenant (2026-11-27): an active problem → ACTIVE, a closed one → CLOSED, an unknown id → no record.
 * Duplicates are left out, as in Q1: a duplicate never becomes an incident, so the run must not wait for one.
 */
export function buildProblemStatusQuery(problemId: string): string | undefined {
  const id = problemId.trim();
  if (!PROBLEM_ID_RE.test(id)) return undefined;
  return [
    `fetch dt.davis.problems, from: now() - 2h`,
    `| filter event.id == ${dqlString(id)}`,
    `| filter not(dt.davis.is_duplicate)`,
    `| sort timestamp desc`,
    `| limit 1`,
    `| fields event.id, event.status, dt.davis.event_ids`,
  ].join("\n");
}

/** Splits `items` into arrays of at most `size` (Q4 id batches). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
