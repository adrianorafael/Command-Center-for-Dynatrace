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

export type GrailRecord = Record<string, unknown>;

type QueryStateName = "NOT_STARTED" | "RUNNING" | "SUCCEEDED" | "RESULT_GONE" | "CANCELLED" | "FAILED";

interface ResultLike {
  state: QueryStateName;
  requestToken?: string;
  result?: { records: (Record<string, unknown> | null)[] };
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

export type RunQuery = (query: string, options?: RunQueryOptions) => Promise<GrailRecord[]>;

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

export const runQuery: RunQuery = async (query, options = {}) => {
  const client = options.client ?? (queryExecutionClient as unknown as QueryClientLike);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  const slice = Math.min(10_000, timeoutMs);

  let r = await client.queryExecute({
    body: {
      query,
      requestTimeoutMilliseconds: slice,
      maxResultRecords: options.maxResultRecords ?? 1000,
    },
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
  return records(r);
};

/** Error text safe to show/store: message only, no stack, capped. */
export function describeError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
  return m.slice(0, 300);
}
