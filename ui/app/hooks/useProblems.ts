import { useDql } from "@dynatrace-sdk/react-hooks";
import { useMemo } from "react";
import type {
  Problem,
  ProblemStatus,
  HistoryEvent,
  HistoryEventType,
  EscalationContact,
  FilterStatus,
} from "../types/problems";
import { parseTimeframeDate } from "../utils/timeframe";
import type { Timeframe } from "@dynatrace/strato-components/core";

export type { Problem, ProblemStatus, HistoryEvent, HistoryEventType, EscalationContact, FilterStatus };

// ─── DQL record shape retornado pelo Grail ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DQL API boundary: field values are dynamically typed
type ProblemRecord = Record<string, any>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(value: number | string | null | undefined): string {
  if (!value) return "";
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  if (isNaN(ms)) return String(value);
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function mapStatus(raw: string | undefined): ProblemStatus {
  switch (raw?.toUpperCase()) {
    case "ACTIVE":
    case "OPEN":
      return "OPEN";
    case "CLOSED":
    case "RESOLVED":
      return "CLOSED";
    case "ACKNOWLEDGED":
      return "ACKNOWLEDGED";
    case "UNDER_MAINTENANCE":
    case "MAINTENANCE":
      return "MAINTENANCE";
    default:
      return "OPEN";
  }
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any -- return type is dynamically determined by arbitrary key lookup
function pick(record: ProblemRecord, ...keys: string[]): any {
  for (const k of keys) {
    if (record[k] !== undefined && record[k] !== null) return record[k];
  }
  return undefined;
}

function mapRecord(record: ProblemRecord): Problem {
  const isUnderMaintenance = record["maintenance.is_under_maintenance"] === true;
  const rawStatus = pick(record, "event.status", "status");
  const status: ProblemStatus = isUnderMaintenance
    ? "MAINTENANCE"
    : mapStatus(rawStatus);

  const startedStr = formatTimestamp(pick(record, "event.start", "startTime", "timestamp"));
  const endTime = pick(record, "event.end", "endTime", "endTimestamp");

  const history: HistoryEvent[] = [
    { type: "STARTED", timestamp: startedStr, by: "System" },
  ];

  if (status === "CLOSED" && endTime) {
    history.push({
      type: "CLOSED",
      timestamp: formatTimestamp(endTime),
      by: "System",
    });
  }

  if (status === "MAINTENANCE") {
    history.push({
      type: "MAINTENANCE",
      timestamp: startedStr,
      by: "System",
    });
  }

  const rootCause = pick(record, "root_cause_entity_name") ?? "—";

  const eventIds = record["dt.davis.event_ids"];
  const eventCount = Array.isArray(eventIds) ? eventIds.length : 0;

  return {
    id: pick(record, "event.id", "id") ?? "—",
    displayId: pick(record, "display_id", "displayId") ?? "",
    started: startedStr,
    summary: (() => {
      const name = pick(record, "event.name", "title") ?? "—";
      const affected = record["affected_entity_names"];
      const affectedStr = Array.isArray(affected) && affected.length > 0
        ? affected.join(", ")
        : typeof affected === "string" ? affected : null;
      return affectedStr ? `${name} affecting ${affectedStr}` : name;
    })(),
    rootCause,
    events: eventCount,
    assignedTo: "",
    status,
    detailsUrl: "#",
    history,
    escalationContact: { name: "—", phone: "—" },
  };
}

// ─── DQL Query ────────────────────────────────────────────────────────────────

const DQL_PROBLEM_LIMIT = 500;

function buildQuery(from?: string, to?: string): string {
  const timeframePart = from && to ? `, from: "${from}", to: "${to}"` : "";
  // Exclude problems that closed before the timeframe start — they are no longer relevant.
  // isNull(endTime) keeps open problems; endTime >= from keeps problems closed within the window.
  const endFilter = from ? `\n| filter isNull(endTime) or endTime >= "${from}"` : "";
  return `fetch dt.davis.problems${timeframePart}${endFilter}\n| sort startTime desc\n| limit ${DQL_PROBLEM_LIMIT}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseProblemsResult {
  problems: Problem[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
}

export function useProblems(timeframeObj?: Timeframe | { from: string; to: string } | null): UseProblemsResult {
  // timeframeStart/End only depend on timeframeObj — changing timeframe rebuilds the query string,
  // which causes useDql to auto-fetch as a new query. Autorefresh uses applyTimeframe on the same query.
  const timeframeStart = useMemo(
    () => (timeframeObj ? parseTimeframeDate(timeframeObj.from, false).toISOString() : undefined),
    [timeframeObj]
  );

  const timeframeEnd = useMemo(
    () => (timeframeObj ? parseTimeframeDate(timeframeObj.to, true).toISOString() : undefined),
    [timeframeObj]
  );

  // Guard: if start >= end (e.g. autorefresh fires exactly at midnight when @d === now()),
  // skip the DQL query entirely and surface a friendly error instead.
  const isTimeframeValid = useMemo(() => {
    if (!timeframeStart || !timeframeEnd) return true;
    return timeframeStart < timeframeEnd;
  }, [timeframeStart, timeframeEnd]);

  const query = useMemo(
    () => buildQuery(timeframeStart, timeframeEnd),
    [timeframeStart, timeframeEnd]
  );

  const { data, isLoading, isError: dqlIsError, error: dqlError, isFetching } = useDql<ProblemRecord>(query, {
    staleTime: 0,
    enabled: isTimeframeValid,
  });

  const problems = useMemo<Problem[]>(
    () => (data?.records ?? []).map(mapRecord),
    [data]
  );

  const isError = !isTimeframeValid || dqlIsError;
  const error = !isTimeframeValid
    ? new Error("INVALID_TIMEFRAME")
    : dqlError;

  return {
    problems,
    isLoading: isTimeframeValid ? isLoading : false,
    isFetching: isTimeframeValid ? isFetching : false,
    isError,
    error,
  };
}
