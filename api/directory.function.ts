/**
 * App function `directory` — tenant user search for automation and configuration scripts.
 *
 *   POST .../api/directory  { "query": "ana" }        → DirectoryUser[] (min 3 chars)
 *   POST .../api/directory  { "uids": ["…", "…"] }    → DirectoryUser[] (resolve)
 *
 * Uses the app's iam:users:read scope, so scripts do not need a token with that scope.
 */

import type { DirectoryUser } from "../ui/app/domain/contracts";
import { createIamDirectory, SEARCH_MIN_CHARS } from "../ui/app/data/directory";

export interface DirectoryRequest {
  query?: string;
  uids?: string[];
}

export default async function (payload: DirectoryRequest = {}): Promise<{ users: DirectoryUser[]; error?: string }> {
  const dir = createIamDirectory();
  try {
    if (Array.isArray(payload.uids) && payload.uids.length > 0) {
      return { users: await dir.resolve(payload.uids.slice(0, 200)) };
    }
    const q = (payload.query ?? "").trim();
    if (q.length < SEARCH_MIN_CHARS) return { users: [], error: `query needs at least ${SEARCH_MIN_CHARS} characters` };
    return { users: await dir.search(q) };
  } catch (e) {
    return { users: [], error: e instanceof Error ? e.message : "directory lookup failed" };
  }
}
