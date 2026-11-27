/**
 * Fetch the enabled inbound sources (Q1–Q4, ui/app/data/dql.ts) and return raw records.
 * A failing source is reported in `errors` and skipped — never treated as "all alerts gone"
 * (an incident only resolves on an explicit CLOSED/resolve record).
 */

import type { Settings } from "../../ui/app/domain/contracts";
import {
  DQL_LIMIT,
  Q4_CHUNK,
  buildDavisEventsQuery,
  buildGenericEventsQuery,
  buildProblemEventPropsQuery,
  buildProblemsQuery,
  chunk,
  safeEventIds,
} from "../../ui/app/data/dql";
import { asGrailResult, describeError, type GrailRecord, type QueryRunner } from "../../ui/app/data/grail";
import type { AlertSource } from "../../ui/app/domain/contracts";

/** Health of one inbound source in a tick; the engine passes it to the domain as `sourceStatus`. */
export type SourceHealth = "ok" | "failed" | "truncated";

/** Raw records of one tick plus per-source health. */
export interface SourceRecords {
  problems: GrailRecord[];
  davisEvents: GrailRecord[];
  genericEvents: GrailRecord[];
  /** Per source: failed query, truncated result (limits/sampling/incomplete Q4) or ok (also when disabled). */
  status: Record<AlertSource, SourceHealth>;
  /** Problems held back this tick because their routing properties could not be fetched or are not readable yet. */
  heldProblems: number;
  errors: string[];
}

/** Max event ids looked up per tick (5 Q4 chunks). */
export const Q4_MAX_IDS = 5 * Q4_CHUNK;
/** A problem whose routing properties are incomplete is held back while younger than this. */
export const HOLD_INCOMPLETE_MS = 3 * 60_000;
/**
 * A problem none of whose Davis events can be read yet is held back while younger than this. Records become
 * queryable some time after they are written (measured on a trial tenant, 2026-11-27: a problem 30–40 s after its
 * timestamp), and the problem can show up before its events. Routing happens once, when the incident is created,
 * so creating it without the events' cc.* properties would route it wrongly for good.
 */
export const HOLD_UNREADABLE_MS = 90_000;

const EVENT_IDS = "dt.davis.event_ids";
/** Event properties that must not change a problem's identity or status. */
const NOT_INHERITED = new Set(["cc.action", "cc.dedup_key"]);

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Copy the `cc.*` custom properties of a problem's Davis events onto the problem record
 * (problem records do not carry them — observed on a trial tenant), so routing rules can match
 * `fields.cc.service` etc. Fields already on the problem win; for several events the first wins.
 * cc.action / cc.dedup_key are never copied (they would resolve or re-key the problem).
 */
export function enrichProblems(problems: GrailRecord[], eventProps: GrailRecord[]): GrailRecord[] {
  const byId = new Map<string, GrailRecord>();
  for (const e of eventProps) {
    const id = e["event.id"];
    if (typeof id === "string" && !byId.has(id)) byId.set(id, e);
  }
  return problems.map((p) => {
    const out: GrailRecord = { ...p };
    for (const id of stringArray(p[EVENT_IDS])) {
      const e = byId.get(id);
      if (!e) continue;
      for (const [k, v] of Object.entries(e)) {
        if (!k.startsWith("cc.") || NOT_INHERITED.has(k)) continue;
        if (out[k] === undefined && v !== null && v !== undefined) out[k] = v;
      }
    }
    return out;
  });
}

function startedAt(p: GrailRecord): number | undefined {
  const v = p["event.start"] ?? p["timestamp"];
  const t = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Runs Q1–Q3 in parallel, then Q4 for the problems' event ids, holds back young problems whose routing properties are
 * missing, and copies `cc.*` onto the rest. `timeoutMs` applies to each query.
 */
export async function fetchSources(
  settings: Settings,
  runQuery: QueryRunner,
  timeoutMs = 25_000,
  now: number = Date.now(),
): Promise<SourceRecords> {
  const out: SourceRecords = {
    problems: [],
    davisEvents: [],
    genericEvents: [],
    status: { "davis-problem": "ok", "davis-event": "ok", "generic-event": "ok" },
    heldProblems: 0,
    errors: [],
  };
  const mark = (source: AlertSource, h: SourceHealth) => {
    if (out.status[source] === "failed") return;
    if (h === "failed" || out.status[source] === "ok") out.status[source] = h;
  };
  const run = async (
    label: string,
    source: AlertSource,
    q: string | undefined,
    onFail: SourceHealth = "failed",
  ): Promise<GrailRecord[] | undefined> => {
    if (!q) return [];
    try {
      const r = asGrailResult(await runQuery(q, { timeoutMs }), DQL_LIMIT);
      if (r.truncated) {
        mark(source, "truncated");
        out.errors.push(`${label}: result truncated (${r.notices.join(", ")})`);
      }
      return r.records;
    } catch (e) {
      mark(source, onFail);
      out.errors.push(`${label}: ${describeError(e)}`);
      return undefined;
    }
  };

  const src = settings.sources;
  const [problems, davisEvents, genericEvents] = await Promise.all([
    src.davisProblems.enabled ? run("Q1 problems", "davis-problem", buildProblemsQuery(settings)) : Promise.resolve([]),
    src.davisEvents.enabled ? run("Q2 davis events", "davis-event", buildDavisEventsQuery(settings)) : Promise.resolve([]),
    src.genericEvents.enabled
      ? run("Q3 generic events", "generic-event", buildGenericEventsQuery(settings))
      : Promise.resolve([]),
  ]);

  // Q4: custom properties of the events behind each problem (for routing). Chunks run in parallel
  // so the whole fetch stays within ~2 × timeoutMs (function limit 120 s).
  const allIds = safeEventIds((problems ?? []).flatMap((p) => stringArray(p[EVENT_IDS])));
  const ids = allIds.slice(0, Q4_MAX_IDS);
  const incomplete = new Set(allIds.slice(Q4_MAX_IDS));
  const chunks = chunk(ids, Q4_CHUNK);
  const results = await Promise.all(
    chunks.map((part) =>
      // Q1 itself succeeded: missing routing properties make the source "truncated", not "failed".
      run("Q4 event properties", "davis-problem", buildProblemEventPropsQuery(part, src.davisProblems.lookbackHours), "truncated"),
    ),
  );
  results.forEach((r, i) => {
    if (r === undefined) for (const id of chunks[i] ?? []) incomplete.add(id);
  });
  if (incomplete.size > 0) {
    mark("davis-problem", "truncated");
    if (allIds.length > Q4_MAX_IDS) out.errors.push(`Q4 event properties: ${allIds.length - Q4_MAX_IDS} event id(s) over the ${Q4_MAX_IDS} cap`);
  }
  const props = results.flatMap((r) => r ?? []);
  const readable = new Set(props.map((e) => e["event.id"]).filter((id): id is string => typeof id === "string"));

  // Problems whose routing properties are incomplete are held back for a few minutes (the next
  // tick usually completes them); older ones go through so a persistent failure never blocks paging.
  const kept: GrailRecord[] = [];
  for (const p of problems ?? []) {
    const eventIds = stringArray(p[EVENT_IDS]);
    const missing = eventIds.some((id) => incomplete.has(id));
    const start = startedAt(p);
    if (missing && start !== undefined && now - start < HOLD_INCOMPLETE_MS) {
      out.heldProblems++;
      continue;
    }
    // Q4 answered, but none of this young problem's events is queryable yet: wait for them (see HOLD_UNREADABLE_MS).
    const unreadable = !missing && eventIds.length > 0 && !eventIds.some((id) => readable.has(id));
    if (unreadable && start !== undefined && now - start < HOLD_UNREADABLE_MS) {
      out.heldProblems++;
      continue;
    }
    kept.push(p);
  }

  out.problems = props.length ? enrichProblems(kept, props) : kept;
  out.davisEvents = davisEvents ?? [];
  out.genericEvents = genericEvents ?? [];
  return out;
}
