/**
 * Tenant user directory (IAM) — team members are IAM users, never free-text contacts.
 *
 * Verified against node_modules/@dynatrace-sdk/client-iam/types/index.d.ts:
 *  - usersAndGroupsClient → getActiveUsersForOrganizationalLevel with
 *    levelType ("account" | "environment"), levelId, partialString? (min 3, max 320),
 *    uuid?: string[] (max 25), pageSize? (≤1000)
 *    → RestUserPublicListResponse { results?: RestUserPublic[], nextPageKey?, totalCount? }   (l.230)
 *  - RestUserPublic { uid, email, name?, surname?, description? }                              (l.116)
 *  - "Providing value for at least one of the parameters: 'partialString' or 'uuid' is required."
 * Scope: iam:users:read. levelId = getEnvironmentId() (@dynatrace-sdk/app-environment).
 */

import { getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { usersAndGroupsClient } from "@dynatrace-sdk/client-iam";
import type { DirectoryUser } from "../domain/contracts";

export interface Directory {
  /** Users whose email contains / name starts with `query`. Fewer than 3 chars → []. */
  search(query: string): Promise<DirectoryUser[]>;
  /** Resolve uids to users; unknown uids are simply missing from the result. */
  resolve(uids: readonly string[]): Promise<DirectoryUser[]>;
}

/** IAM rejects a partialString shorter than this (see header). */
export const SEARCH_MIN_CHARS = 3;
/** IAM accepts at most this many uuids per lookup (see header). */
export const RESOLVE_BATCH = 25;

interface RestUserLike {
  uid: string;
  email?: string;
  name?: string;
  surname?: string;
}

/** The one IAM client method used, so tests can inject a fake. */
export interface IamClientLike {
  getActiveUsersForOrganizationalLevel(config: {
    levelType: string;
    levelId: string;
    partialString?: string;
    uuid?: string[];
    pageSize?: number;
  }): Promise<{ results?: RestUserLike[] }>;
}

/** Display name is "name surname", falling back to the email, then the uid. */
export function toDirectoryUser(u: RestUserLike): DirectoryUser {
  const name = [u.name, u.surname].filter((x) => x && x.trim()).join(" ").trim();
  return { uid: u.uid, name: name || u.email || u.uid, ...(u.email ? { email: u.email } : {}) };
}

/** Directory over the tenant's active IAM users (environment level). `resolve` makes one call per 25 uids. */
export function createIamDirectory(
  client: IamClientLike = usersAndGroupsClient,
  levelId: () => string = getEnvironmentId,
): Directory {
  return {
    async search(query) {
      const q = query.trim().slice(0, 320);
      if (q.length < SEARCH_MIN_CHARS) return [];
      const r = await client.getActiveUsersForOrganizationalLevel({
        levelType: "environment",
        levelId: levelId(),
        partialString: q,
        pageSize: 50,
      });
      return (r.results ?? []).map(toDirectoryUser);
    },
    async resolve(uids) {
      const unique = [...new Set(uids.filter(Boolean))];
      const out: DirectoryUser[] = [];
      for (let i = 0; i < unique.length; i += RESOLVE_BATCH) {
        const batch = unique.slice(i, i + RESOLVE_BATCH);
        const r = await client.getActiveUsersForOrganizationalLevel({
          levelType: "environment",
          levelId: levelId(),
          uuid: batch,
          pageSize: RESOLVE_BATCH,
        });
        out.push(...(r.results ?? []).map(toDirectoryUser));
      }
      return out;
    },
  };
}

/** Demo / test directory over a fixed synthetic list (same matching rules as IAM, roughly). */
export function createStaticDirectory(users: readonly DirectoryUser[]): Directory {
  return {
    search(query) {
      const q = query.trim().toLowerCase();
      if (q.length < SEARCH_MIN_CHARS) return Promise.resolve([]);
      return Promise.resolve(
        users.filter(
          (u) =>
            u.email?.toLowerCase().includes(q) ||
            u.name.toLowerCase().startsWith(q) ||
            u.name.toLowerCase().split(" ").reverse().join(" ").startsWith(q),
        ),
      );
    },
    resolve(uids) {
      const set = new Set(uids);
      return Promise.resolve(users.filter((u) => set.has(u.uid)));
    },
  };
}
