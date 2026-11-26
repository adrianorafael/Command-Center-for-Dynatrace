import { describe, expect, it, vi } from "vitest";
import {
  buildDavisEventsQuery,
  buildGenericEventsQuery,
  buildProblemEventPropsQuery,
  buildProblemsQuery,
  clampHours,
  safeEventTypes,
} from "../dql";
import { createIamDirectory, createStaticDirectory, toDirectoryUser, type IamClientLike } from "../directory";
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

  it("resolves uids in batches of at most 25", async () => {
    const calls: string[][] = [];
    const client: IamClientLike = {
      getActiveUsersForOrganizationalLevel: ({ uuid }) => {
        calls.push(uuid ?? []);
        return Promise.resolve({ results: (uuid ?? []).map((uid) => ({ uid, email: `${uid}@example.com` })) });
      },
    };
    const uids = Array.from({ length: 60 }, (_, i) => `user-${String(i).padStart(4, "0")}`);
    const users = await createIamDirectory(client, () => "env").resolve([...uids, uids[0]]);
    expect(calls.map((c) => c.length)).toEqual([25, 25, 10]);
    expect(users).toHaveLength(60);
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
