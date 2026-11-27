/**
 * Grail query helper over @dynatrace-sdk/client-query 1.29 — usable from the UI and app functions.
 *
 * Verified against node_modules/@dynatrace-sdk/client-query/types/index.d.ts:
 *  - queryExecutionClient.queryExecute({ body: ExecuteRequest }) → QueryStartResponse
 *    { state, requestToken?, result?: { records, types, metadata } }   (≈ l.1330, l.1482)
 *  - queryExecutionClient.queryPoll({ requestToken, requestTimeoutMilliseconds? }) → QueryPollResponse
 *    { state: NOT_STARTED|RUNNING|SUCCEEDED|RESULT_GONE|CANCELLED|FAILED, result? }   (≈ l.1401, l.1442)
 *  - ExecuteRequest: query, requestTimeoutMilliseconds, maxResultRecords, … (≈ l.357)
 * Scopes: storage:buckets:read + table scope (storage:events:read).
 */

import { queryExecutionClient } from "@dynatrace-sdk/client-query";

/** One Grail record: field name → value as returned (timestamps are ISO strings). */
export type GrailRecord = Record<string, unknown>;

type QueryStateName = "NOT_STARTED" | "RUNNING" | "SUCCEEDED" | "RESULT_GONE" | "CANCELLED" | "FAILED";

interface NotificationLike {
  notificationType?: string;
  severity?: string;
  message?: string;
}

interface ResultLike {
  state: QueryStateName;
  requestToken?: string;
  result?: {
    records: (Record<string, unknown> | null)[];
    metadata?: { grail?: { notifications?: NotificationLike[]; sampled?: boolean } };
  };
}

/** Records plus whether Grail cut the result short (limits, scan limit, sampling). */
export interface GrailResult {
  records: GrailRecord[];
  truncated: boolean;
  /** Notification types / messages that caused `truncated` (short, no data). */
  notices: string[];
}

/** Subset of QueryExecutionClient (injectable for tests). */
export interface QueryClientLike {
  queryExecute(config: {
    body: { query: string; requestTimeoutMilliseconds?: number; maxResultRecords?: number };
  }): Promise<ResultLike>;
  queryPoll(config: { requestToken: string; requestTimeoutMilliseconds?: number }): Promise<ResultLike>;
}

export interface RunQueryOptions {
  /** Overall budget for the query, ms (default 30 s; app functions have 120 s in total). */
  timeoutMs?: number;
  maxResultRecords?: number;
  client?: QueryClientLike;
}

/** Records only (truncation notices are dropped). */
export type RunQuery = (query: string, options?: RunQueryOptions) => Promise<GrailRecord[]>;
/** Engine dependency: either form is accepted (tests may return plain record arrays). */
export type QueryRunner = (query: string, options?: RunQueryOptions) => Promise<GrailRecord[] | GrailResult>;

/** A query that did not succeed or did not finish in time; `state` is the last query state seen. */
export class GrailQueryError extends Error {
  constructor(
    message: string,
    readonly state?: string,
  ) {
    super(message);
    this.name = "GrailQueryError";
  }
}

function records(r: ResultLike): GrailRecord[] {
  return (r.result?.records ?? []).filter((x): x is GrailRecord => x !== null && typeof x === "object");
}

/**
 * Truncation signals. Observed on a trial tenant (2026-11-26): a `maxResultRecords` cut yields
 * metadata.grail.notifications[{ notificationType: "API_RECORDS_LIMIT_ADDED", severity: "WARNING" }];
 * a DQL `| limit n` adds NO notification, so callers also compare the record count with their limit.
 * Types per client-query GrailMetadata { notifications?: MetadataNotification[], sampled? }.
 */
const TRUNCATION_RE = /LIMIT|SCAN|SAMPL|TRUNCAT|PARTIAL/i;

/** Notification types (or message heads) that mean the result is incomplete; "SAMPLED" for sampled results. */
export function truncationNotices(r: { result?: ResultLike["result"] }): string[] {
  const g = r.result?.metadata?.grail;
  const out: string[] = [];
  for (const n of g?.notifications ?? []) {
    const type = n.notificationType ?? "";
    if (TRUNCATION_RE.test(type) || TRUNCATION_RE.test(n.message ?? "")) out.push(type || (n.message ?? "").slice(0, 80));
  }
  if (g?.sampled) out.push("SAMPLED");
  return out;
}

/**
 * Execute and poll until the query ends or `timeoutMs` passes; each request waits at most 10 s server-side.
 * Throws GrailQueryError unless the final state is SUCCEEDED.
 */
export async function runGrailQuery(query: string, options: RunQueryOptions = {}): Promise<GrailResult> {
  const client = options.client ?? (queryExecutionClient as unknown as QueryClientLike);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  const slice = Math.min(10_000, timeoutMs);
  const maxResultRecords = options.maxResultRecords ?? 1000;

  let r = await client.queryExecute({
    body: { query, requestTimeoutMilliseconds: slice, maxResultRecords },
  });
  // Poll responses carry no token; keep the one from queryExecute.
  const requestToken = r.requestToken;
  while (r.state === "RUNNING" || r.state === "NOT_STARTED") {
    if (!requestToken) throw new GrailQueryError("Query is running but returned no request token", r.state);
    if (Date.now() >= deadline) throw new GrailQueryError(`Query did not finish within ${timeoutMs} ms`, r.state);
    r = await client.queryPoll({
      requestToken,
      requestTimeoutMilliseconds: Math.max(1, Math.min(slice, deadline - Date.now())),
    });
  }
  if (r.state !== "SUCCEEDED") throw new GrailQueryError(`Query ended in state ${r.state}`, r.state);
  const recs = records(r);
  const notices = truncationNotices(r);
  if (recs.length >= maxResultRecords && !notices.length) notices.push(`RECORDS>=${maxResultRecords}`);
  return { records: recs, truncated: notices.length > 0, notices };
}

/**
 * The runner the engine and actions use. It returns records only, so Grail's truncation notices are lost here and
 * asGrailResult can detect truncation only by record count.
 */
export const runQuery: RunQuery = async (query, options = {}) => (await runGrailQuery(query, options)).records;

/** Normalise either runner result form. */
export function asGrailResult(r: GrailRecord[] | GrailResult, limit = 1000): GrailResult {
  if (Array.isArray(r)) {
    return r.length >= limit
      ? { records: r, truncated: true, notices: [`RECORDS>=${limit}`] }
      : { records: r, truncated: false, notices: [] };
  }
  return r;
}

/** Error text safe to show/store: message only, no stack, capped. */
export function describeError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
  return m.slice(0, 300);
}
