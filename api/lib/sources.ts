/**
 * Fetch the enabled inbound sources (Q1–Q4, ui/app/data/dql.ts) and return raw records.
 * A failing source is reported in `errors` and skipped — never treated as "all alerts gone"
 * (an incident only resolves on an explicit CLOSED/resolve record).
 */

import type { Settings } from "../../ui/app/domain/contracts";
import {
  Q4_CHUNK,
  buildDavisEventsQuery,
  buildGenericEventsQuery,
  buildProblemEventPropsQuery,
  buildProblemsQuery,
  chunk,
  safeEventIds,
} from "../../ui/app/data/dql";
import { describeError, type GrailRecord, type RunQuery } from "../../ui/app/data/grail";

export interface SourceRecords {
  problems: GrailRecord[];
  davisEvents: GrailRecord[];
  genericEvents: GrailRecord[];
  errors: string[];
}

const EVENT_IDS = "dt.davis.event_ids";

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Copy the `cc.*` custom properties of a problem's Davis events onto the problem record
 * (problem records do not carry them — observed on a trial tenant), so routing rules can match
 * `fields.cc.service` etc. Fields already on the problem win; for several events the first wins.
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
        if (k.startsWith("cc.") && out[k] === undefined && v !== null && v !== undefined) out[k] = v;
      }
    }
    return out;
  });
}

export async function fetchSources(
  settings: Settings,
  runQuery: RunQuery,
  timeoutMs = 25_000,
): Promise<SourceRecords> {
  const out: SourceRecords = { problems: [], davisEvents: [], genericEvents: [], errors: [] };
  const run = async (label: string, q: string | undefined): Promise<GrailRecord[]> => {
    if (!q) return [];
    try {
      return await runQuery(q, { timeoutMs });
    } catch (e) {
      out.errors.push(`${label}: ${describeError(e)}`);
      return [];
    }
  };

  const src = settings.sources;
  const [problems, davisEvents, genericEvents] = await Promise.all([
    src.davisProblems.enabled ? run("Q1 problems", buildProblemsQuery(settings)) : Promise.resolve([]),
    src.davisEvents.enabled ? run("Q2 davis events", buildDavisEventsQuery(settings)) : Promise.resolve([]),
    src.genericEvents.enabled ? run("Q3 generic events", buildGenericEventsQuery(settings)) : Promise.resolve([]),
  ]);

  // Q4: custom properties of the events behind each problem (for routing).
  const ids = safeEventIds(problems.flatMap((p) => stringArray(p[EVENT_IDS]))).slice(0, 5 * Q4_CHUNK);
  const props: GrailRecord[] = [];
  for (const part of chunk(ids, Q4_CHUNK)) {
    props.push(...(await run("Q4 event properties", buildProblemEventPropsQuery(part, src.davisProblems.lookbackHours))));
  }

  out.problems = props.length ? enrichProblems(problems, props) : problems;
  out.davisEvents = davisEvents;
  out.genericEvents = genericEvents;
  return out;
}
