/**
 * Grail query helper over @dynatrace-sdk/client-query 1.29 — usable from the UI and app functions.
 *
 * Verified against node_modules/@dynatrace-sdk/client-query/types/index.d.ts:
 *  - queryExecutionClient.queryExecute({ body: ExecuteRequest }) → QueryStartResponse
 *    { state, requestToken?, result?: { records, types, metadata } }   (≈ l.1330, l.1482)
 *  - queryExecutionClient.queryPoll({ requestToken, requestTimeoutMilliseconds? }) → QueryPollResponse
 *    { state: NOT_STARTED|RUNNING|SUCCEEDED|RESULT_GONE|CANCELLED|FAILED, result? }   (≈ l.1401, l.1442)
 *  - ExecuteRequest: query, requestTimeoutMilliseconds, maxResultRecords, defaultScanLimitGbytes ("Default scan limit
 *    in gigabytes. Can be overridden in DQL", minimum -1), … (≈ l.357)
 *  - GrailMetadata: notifications, sampled, scannedBytes ("Number of scanned bytes during the query execution") (≈ l.562)
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
    metadata?: { grail?: { notifications?: NotificationLike[]; sampled?: boolean; scannedBytes?: number } };
  };
}

/** Records plus whether Grail cut the result short (limits, scan limit, sampling). */
export interface GrailResult {
  records: GrailRecord[];
  truncated: boolean;
  /** Notification types / messages that caused `truncated` (short, no data). */
  notices: string[];
  /** Bytes Grail scanned for this query (metadata.grail.scannedBytes), when reported. Drives query cost. */
  scannedBytes?: number;
}

/** Subset of QueryExecutionClient (injectable for tests). */
export interface QueryClientLike {
  queryExecute(config: {
    body: { query: string; requestTimeoutMilliseconds?: number; maxResultRecords?: number; defaultScanLimitGbytes?: number };
  }): Promise<ResultLike>;
  queryPoll(config: { requestToken: string; requestTimeoutMilliseconds?: number }): Promise<ResultLike>;
}

export interface RunQueryOptions {
  /** Overall budget for the query, ms (default 30 s; app functions have 120 s in total). */
  timeoutMs?: number;
  maxResultRecords?: number;
  /**
   * Cost guard: ExecuteRequest.defaultScanLimitGbytes, the most data one query may scan (Grail query cost is billed
   * by scanned data). Whole gigabytes ≥ 1: on the trial tenant (2026-11-27) Grail rejected 0.001 with
   * INVALID_SCAN_LIMIT_GBYTES ("must be -1 (unlimited) or greater than 0", the value read as an integer) and accepted
   * 1 for every engine query (Q1–Q5). A DQL `scanLimitGBytes:` in the query would override it; dql.ts sets none.
   * Omitted: Grail's own default applies.
   */
  scanLimitGBytes?: number;
  client?: QueryClientLike;
}

/** Whole gigabytes ≥ 1, or undefined (no limit sent) for anything not a finite positive number. */
export function clampScanLimitGBytes(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return Math.max(1, Math.floor(v));
}

/**
 * A query that scanned at least this share of its scan limit is treated as cut by it. The SDK names no notification
 * code for a scan-limit cut and none could be provoked on the trial tenant (its largest query scanned ≈ 2 MB), so the
 * byte count is the signal that does not depend on a guessed code. A false positive needs a query that scans ≥ 90 %
 * of the cap, which deserves the warning anyway.
 */
export const SCAN_LIMIT_HIT_RATIO = 0.9;

/** Records only (truncation notices are dropped): never hand this to the engine, see runGrailQuery. */
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
 * Types per client-query 1.29 types/index.d.ts: GrailMetadata { notifications?: MetadataNotification[],
 * sampled?: boolean ("True if sampling was used for at least one segment"), scannedBytes?, … } and
 * MetadataNotification { notificationType? ("e.g. LIMIT_ADDED"), severity?, message? }. The SDK lists no
 * notification codes and has no "scan limit reached" flag, so a scan-limit or fetch-timeout cut is recognised
 * by its notification type or message only (pattern below, not verified against a live cut). Matching
 * errs on the side of "truncated": a truncated source is never used for absence decisions (archiving), so a
 * false positive costs a deferred archive, a false negative could archive an incident that is still open.
 */
const TRUNCATION_RE = /LIMIT|SCAN|SAMPL|TRUNCAT|PARTIAL|TIMEOUT|INCOMPLETE/i;

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
  const scanLimit = clampScanLimitGBytes(options.scanLimitGBytes);

  let r = await client.queryExecute({
    body: { query, requestTimeoutMilliseconds: slice, maxResultRecords, ...(scanLimit ? { defaultScanLimitGbytes: scanLimit } : {}) },
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
  const scanned = r.result?.metadata?.grail?.scannedBytes;
  const scannedBytes = typeof scanned === "number" && Number.isFinite(scanned) ? scanned : undefined;
  // Decimal gigabytes (1e9): if Grail counts GiB the threshold is only reached earlier, never later.
  if (scanLimit && scannedBytes !== undefined && scannedBytes >= SCAN_LIMIT_HIT_RATIO * scanLimit * 1e9 && !notices.some((n) => /SCAN/i.test(n))) {
    notices.push(`SCAN_LIMIT_${scanLimit}GB`);
  }
  return { records: recs, truncated: notices.length > 0, notices, ...(scannedBytes !== undefined ? { scannedBytes } : {}) };
}

/**
 * Records only. Grail's truncation notices (scan limit, sampling, …) are dropped here, so this is NOT the engine
 * runner: actions/run-engine.action.ts and api/engine-run.function.ts pass runGrailQuery, whose full result lets
 * api/lib/sources.ts mark a cut-short source "truncated" (and the domain then never treats it as proof of absence).
 */
export const runQuery: RunQuery = async (query, options = {}) => (await runGrailQuery(query, options)).records;

/**
 * Normalise either runner result form. The record-count check applies to both forms: a DQL `| limit n` cut carries
 * no Grail notification, so a full result object must still count as truncated when it reaches `limit` (the
 * caller's DQL limit may differ from the maxResultRecords runGrailQuery checked).
 */
export function asGrailResult(r: GrailRecord[] | GrailResult, limit = 1000): GrailResult {
  if (Array.isArray(r)) {
    return r.length >= limit
      ? { records: r, truncated: true, notices: [`RECORDS>=${limit}`] }
      : { records: r, truncated: false, notices: [] };
  }
  if (!r.truncated && r.records.length >= limit) return { ...r, truncated: true, notices: [...r.notices, `RECORDS>=${limit}`] };
  return r;
}

/** Error text safe to show/store: message only, no stack, capped. */
export function describeError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
  return m.slice(0, 300);
}
