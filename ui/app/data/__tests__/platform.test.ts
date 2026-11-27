import { describe, expect, it, vi } from "vitest";
import {
  buildDavisEventsQuery,
  buildGenericEventsQuery,
  buildProblemEventPropsQuery,
  buildProblemsQuery,
  clampHours,
  safeEventTypes,
} from "../dql";
import { createIamDirectory, createStaticDirectory, DirectoryLookupError, isDirectoryUid, toDirectoryUser, type IamClientLike } from "../directory";
import { runQuery, type QueryClientLike } from "../grail";

const sources = (over: Record<string, unknown> = {}) =>
  ({
    sources: {
      davisProblems: { enabled: true, lookbackHours: 72, pageDuringMaintenance: false },
      davisEvents: { enabled: true, eventTypes: ["CUSTOM_ALERT", "ERROR_EVENT"] },
      genericEvents: { enabled: true, eventType: "command_center.alert" },
      ...over,
    },
  }) as Parameters<typeof buildProblemsQuery>[0];

describe("DQL builders", () => {
  it("Q1 dedups by event.id before filtering on status", () => {
    const q = buildProblemsQuery(sources());
    expect(q).toMatch(/^fetch dt\.davis\.problems, from: now\(\) - 72h/);
    expect(q.indexOf("dedup event.id")).toBeLessThan(q.indexOf('event.status == "ACTIVE"'));
    expect(q).toContain("| limit 1000");
  });

  it("clamps the lookback", () => {
    expect(clampHours(-5)).toBe(1);
    expect(clampHours(10_000)).toBe(720);
    expect(clampHours(Number.NaN)).toBe(72);
    expect(buildProblemsQuery(sources({ davisProblems: { enabled: true, lookbackHours: 9999.7, pageDuringMaintenance: false } }))).toContain("now() - 720h");
  });

  it("Q2 allow-lists event types and returns undefined when none are valid", () => {
    expect(safeEventTypes(['CUSTOM_ALERT', 'x") or true or ("', ' ERROR_EVENT ', 'CUSTOM_ALERT'])).toEqual(["CUSTOM_ALERT", "ERROR_EVENT"]);
    const q = buildDavisEventsQuery(sources());
    expect(q).toContain('filter in(event.type, array("CUSTOM_ALERT", "ERROR_EVENT"))');
    expect(q).toContain('"cc.*"');
    expect(buildDavisEventsQuery(sources({ davisEvents: { enabled: true, eventTypes: ["bad type!"] } }))).toBeUndefined();
  });

  it("Q3 sorts before takeLast and filters on the configured event type", () => {
    const q = buildGenericEventsQuery(sources())!;
    expect(q).toContain('filter event.type == "command_center.alert"');
    expect(q.indexOf("sort timestamp asc")).toBeLessThan(q.indexOf("summarize"));
    expect(buildGenericEventsQuery(sources({ genericEvents: { enabled: true, eventType: "a b" } }))).toBeUndefined();
  });

  it("Q4 only accepts id-shaped values", () => {
    const q = buildProblemEventPropsQuery(["123_456", 'x"); drop', "123_456"], 72)!;
    expect(q).toContain('array("123_456")');
    expect(buildProblemEventPropsQuery(['"'], 72)).toBeUndefined();
  });
});

describe("runQuery", () => {
  it("returns records from an immediate result", async () => {
    const client: QueryClientLike = {
      queryExecute: vi.fn().mockResolvedValue({ state: "SUCCEEDED", result: { records: [{ a: 1 }, null] } }),
      queryPoll: vi.fn(),
    };
    expect(await runQuery("fetch x", { client })).toEqual([{ a: 1 }]);
    expect(client.queryPoll).not.toHaveBeenCalled();
  });

  it("polls with the request token until the query succeeds", async () => {
    const client: QueryClientLike = {
      queryExecute: vi.fn().mockResolvedValue({ state: "RUNNING", requestToken: "tok-1" }),
      queryPoll: vi
        .fn()
        .mockResolvedValueOnce({ state: "RUNNING" })
        .mockResolvedValueOnce({ state: "SUCCEEDED", result: { records: [{ b: 2 }] } }),
    };
    expect(await runQuery("fetch x", { client })).toEqual([{ b: 2 }]);
    expect(client.queryPoll).toHaveBeenCalledWith(expect.objectContaining({ requestToken: "tok-1" }));
  });

  it("throws on a failed query", async () => {
    const client: QueryClientLike = {
      queryExecute: vi.fn().mockResolvedValue({ state: "FAILED" }),
      queryPoll: vi.fn(),
    };
    await expect(runQuery("fetch x", { client })).rejects.toThrow(/FAILED/);
  });
});

describe("directory", () => {
  it("maps IAM users and requires 3 characters to search", async () => {
    const client: IamClientLike = {
      getActiveUsersForOrganizationalLevel: vi.fn().mockResolvedValue({
        results: [{ uid: "user-0001", email: "ana@example.com", name: "Ana", surname: "Example" }],
      }),
    };
    const dir = createIamDirectory(client, () => "env-placeholder");
    expect(await dir.search("an")).toEqual([]);
    expect(await dir.search("ana")).toEqual([{ uid: "user-0001", name: "Ana Example", email: "ana@example.com" }]);
    expect(client.getActiveUsersForOrganizationalLevel).toHaveBeenCalledWith(
      expect.objectContaining({ levelType: "environment", levelId: "env-placeholder", partialString: "ana" }),
    );
  });

  /** Synthetic ids in the shape of IAM user ids. */
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("resolves uids in batches of at most 25", async () => {
    const calls: string[][] = [];
    const client: IamClientLike = {
      getActiveUsersForOrganizationalLevel: ({ uuid: ids }) => {
        calls.push(ids ?? []);
        return Promise.resolve({ results: (ids ?? []).map((uid) => ({ uid, email: `${uid}@example.com` })) });
      },
    };
    const uids = Array.from({ length: 60 }, (_, i) => uuid(i));
    const users = await createIamDirectory(client, () => "env").resolve([...uids, uids[0]!]);
    expect(calls.map((c) => c.length)).toEqual([25, 25, 10]);
    expect(users).toHaveLength(60);
  });

  it("never sends an id that cannot be an account user: one such id must not cost everyone their name", async () => {
    const sent: string[] = [];
    const client: IamClientLike = {
      getActiveUsersForOrganizationalLevel: ({ uuid: ids }) => {
        sent.push(...(ids ?? []));
        // What IAM does with a value that is not a UUID: it refuses the whole request.
        if ((ids ?? []).some((id) => !isDirectoryUid(id))) return Promise.reject(new Error("400 the values don't meet the requirements"));
        return Promise.resolve({ results: (ids ?? []).map((uid) => ({ uid, name: "Ana", surname: "Example" })) });
      },
    };
    const dir = createIamDirectory(client, () => "env");
    const users = await dir.resolve([uuid(1), "sim-ana", "system", "source", "demo-user", "", uuid(2)]);
    expect(sent).toEqual([uuid(1), uuid(2)]);
    expect(users.map((u) => u.name)).toEqual(["Ana Example", "Ana Example"]);
    // Nothing to ask: no request at all.
    sent.length = 0;
    expect(await dir.resolve(["sim-ana", "system"])).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a failing batch does not lose the other batches, and the failure is reported with what was found", async () => {
    let call = 0;
    const client: IamClientLike = {
      getActiveUsersForOrganizationalLevel: ({ uuid: ids }) => {
        call++;
        if (call === 2) throw new Error("User not authorized.");
        return Promise.resolve({ results: (ids ?? []).map((uid) => ({ uid, name: "Bruno", surname: "Sample" })) });
      },
    };
    const uids = Array.from({ length: 60 }, (_, i) => uuid(i));
    const failure = await createIamDirectory(client, () => "env")
      .resolve(uids)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(failure).toBeInstanceOf(DirectoryLookupError);
    const e = failure as DirectoryLookupError;
    expect(e.message).toBe("User not authorized.");
    expect(e.users).toHaveLength(35);
    expect((e.cause as Error).message).toBe("User not authorized.");
  });

  it("falls back to the email when IAM has no name", () => {
    expect(toDirectoryUser({ uid: "u1", email: "x@example.com" })).toEqual({ uid: "u1", name: "x@example.com", email: "x@example.com" });
  });

  it("static directory searches by name and email", async () => {
    const dir = createStaticDirectory([
      { uid: "user-0001", name: "Ana Example", email: "ana@example.com" },
      { uid: "user-0002", name: "Bruno Sample", email: "bruno@example.com" },
    ]);
    expect((await dir.search("sam")).map((u) => u.uid)).toEqual(["user-0002"]);
    expect((await dir.search("bruno@")).map((u) => u.uid)).toEqual(["user-0002"]);
    expect((await dir.resolve(["user-0001", "nobody"])).map((u) => u.uid)).toEqual(["user-0001"]);
  });
});
