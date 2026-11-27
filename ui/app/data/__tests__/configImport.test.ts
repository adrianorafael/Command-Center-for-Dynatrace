import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Settings } from "../../domain/contracts";
import { checkConfigExport, importConfig, mergeImportedSettings } from "../configImport";
import { defaultSettings } from "../domainPort";
import { MemoryRepository } from "../memoryRepository";
import { createStore } from "../store";

const team = (id: string) => ({ schemaVersion: SCHEMA_VERSION, id, name: id, rev: 1, members: [] });
const doc = (over: Record<string, unknown> = {}) => ({
  kind: "command-center-config",
  schemaVersion: SCHEMA_VERSION,
  exportedAt: "2026-11-26T00:00:00Z",
  teams: [team("noc")],
  schedules: [],
  policies: [],
  services: [],
  contacts: [],
  ...over,
});

describe("#13 config import", () => {
  it("deep-merges settings per section over the current ones", () => {
    const current = defaultSettings();
    current.engine.maxAttempts = 5;
    const merged = mergeImportedSettings(current, { engine: { enabled: false } } as unknown as Partial<Settings>);
    expect(merged.engine.enabled).toBe(false);
    expect(merged.engine.maxAttempts).toBe(5);
    expect(merged.engine.workflowId).toBe(current.engine.workflowId);
    expect(merged.sources).toEqual(current.sources);
    expect(merged.rev).toBe(current.rev + 1);
  });

  it("validates every key before writing anything", async () => {
    const repo = new MemoryRepository();
    const store = createStore(repo);
    const bad = doc({ teams: [team("noc"), team("Bad Id!")], contacts: [{ schemaVersion: 1, uid: "../x", rev: 1, methods: [], rules: [] }] });
    const r = await importConfig(store, bad, defaultSettings());
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.path)).toEqual(expect.arrayContaining(["teams[1]", "contacts[0]"]));
    expect(repo.keys()).toEqual([]);
  });

  it("rejects duplicates and foreign documents", () => {
    expect(checkConfigExport({ kind: "other" }, defaultSettings()).problems).toHaveLength(1);
    expect(checkConfigExport(doc({ teams: [team("a"), team("a")] }), defaultSettings()).problems[0].message).toMatch(/Duplicate/);
  });

  it("writes entities then settings and reports partial failures", async () => {
    const repo = new MemoryRepository();
    const put = repo.put.bind(repo);
    repo.put = ((k: string, v: unknown, t?: number) => (k === "team.ops" ? Promise.reject(new Error("quota")) : put(k, v, t))) as typeof repo.put;
    const store = createStore(repo);
    const r = await importConfig(store, doc({ teams: [team("noc"), team("ops")], settings: { engine: { enabled: false } } }), defaultSettings());
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(false);
    expect(r.written).toEqual(["team.noc", "cfg.settings"]);
    expect(r.failed).toEqual([{ key: "team.ops", error: "quota" }]);
    expect((await store.getSettings()).engine.enabled).toBe(false);
  });

  it("accepts references to entities that already exist", () => {
    const existing = { policies: [{ schemaVersion: SCHEMA_VERSION, id: "pol-1", name: "p", rev: 1, repeat: 0, steps: [] }] };
    const withRef = doc({ teams: [{ ...team("noc"), defaultPolicyId: "pol-1" }] });
    const withoutCtx = checkConfigExport(withRef, defaultSettings()).problems;
    const withCtx = checkConfigExport(withRef, defaultSettings(), existing as never).problems;
    expect(withCtx.length).toBeLessThanOrEqual(withoutCtx.length);
    expect(withCtx.some((p) => /pol-1|policy/i.test(p.message))).toBe(false);
  });
});

describe("#21 grail truncation", () => {
  it("detects Grail limit notifications, sampling and record-count limits", async () => {
    const { runGrailQuery, truncationNotices, asGrailResult } = await import("../grail");
    const meta = (notifications: unknown[], sampled = false) => ({ result: { records: [], metadata: { grail: { notifications, sampled } } } });
    expect(truncationNotices(meta([{ notificationType: "API_RECORDS_LIMIT_ADDED", severity: "WARNING" }]) as never)).toEqual(["API_RECORDS_LIMIT_ADDED"]);
    expect(truncationNotices(meta([], true) as never)).toEqual(["SAMPLED"]);
    expect(truncationNotices(meta([{ notificationType: "INFO_ONLY", message: "fine" }]) as never)).toEqual([]);
    const client = {
      queryExecute: () => Promise.resolve({ state: "SUCCEEDED" as const, result: { records: [{ a: 1 }, { a: 2 }] } }),
      queryPoll: () => Promise.reject(new Error("unused")),
    };
    expect(await runGrailQuery("fetch x", { client, maxResultRecords: 2 })).toMatchObject({ truncated: true, notices: ["RECORDS>=2"] });
    expect(asGrailResult([{ a: 1 }], 1000)).toEqual({ records: [{ a: 1 }], truncated: false, notices: [] });
  });
});
