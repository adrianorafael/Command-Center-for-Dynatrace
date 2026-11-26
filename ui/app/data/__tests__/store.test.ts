import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type IncidentAction, type Settings } from "../../domain/contracts";
import { DEFAULT_ENGINE_WORKFLOW_ID, defaultSettings } from "../domainPort";
import { MemoryRepository } from "../memoryRepository";
import { KEY } from "../repository";
import { ACTION_TTL_MS, createStore, mergeSettings } from "../store";

describe("store defaults", () => {
  it("returns default settings (with the fixed workflow id) and empty rules on a fresh tenant", async () => {
    const store = createStore(new MemoryRepository());
    const s = await store.getSettings();
    expect(s).toEqual(defaultSettings());
    expect(s.engine.workflowId).toBe(DEFAULT_ENGINE_WORKFLOW_ID);
    expect(await store.getRules()).toEqual({ schemaVersion: SCHEMA_VERSION, rev: 0, rules: [] });
    expect(await store.getHeartbeat()).toBeUndefined();
    expect(await store.listIncidents()).toEqual([]);
  });

  it("merges stored settings over defaults section by section", () => {
    const partial = { engine: { enabled: false, workflowId: "" }, retention: { archiveDays: 7 } } as unknown as Partial<Settings>;
    const s = mergeSettings(partial);
    expect(s.engine.enabled).toBe(false);
    expect(s.engine.maxAttempts).toBe(defaultSettings().engine.maxAttempts);
    expect(s.engine.workflowId).toBe(DEFAULT_ENGINE_WORKFLOW_ID);
    expect(s.retention).toEqual({ ...defaultSettings().retention, archiveDays: 7 });
  });

  it("saves and lists typed entities under their key prefixes", async () => {
    const repo = new MemoryRepository();
    const store = createStore(repo);
    await store.saveTeam({ schemaVersion: SCHEMA_VERSION, id: "noc", name: "NOC", rev: 1, members: [] });
    await store.saveService({ schemaVersion: SCHEMA_VERSION, id: "checkout", name: "Checkout", teamId: "noc", rev: 1 });
    expect(repo.keys()).toEqual(["svc.checkout", "team.noc"]);
    expect((await store.listTeams()).map((t) => t.id)).toEqual(["noc"]);
    await store.deleteTeam("noc");
    await store.deleteTeam("noc");
    expect(await store.listTeams()).toEqual([]);
  });

  it("appends actions append-only with a TTL, listed oldest first per incident", async () => {
    let now = 1_000_000;
    const repo = new MemoryRepository([], { now: () => now, actor: "user-0001" });
    const store = createStore(repo);
    const act = (incidentId: string, at: number): IncidentAction => ({
      schemaVersion: SCHEMA_VERSION,
      incidentId,
      at,
      clientId: "c",
      type: "ack",
    });
    await store.appendAction(act("inc-1", 2000));
    await store.appendAction(act("inc-1", 1000));
    await store.appendAction(act("inc-10", 1500));
    const mine = await store.listActions("inc-1");
    expect(mine.map((a) => a.value.at)).toEqual([1000, 2000]);
    expect(mine[0].key).toMatch(/^act\.inc-1\.0000000001000\.[a-z0-9]{6}$/);
    expect(mine[0].lastModifiedBy).toBe("user-0001");
    expect(await store.listActions()).toHaveLength(3);
    now += ACTION_TTL_MS + 1;
    expect(await store.listActions()).toHaveLength(0);
  });

  it("reads the heartbeat and notification ledger per incident", async () => {
    const repo = new MemoryRepository();
    const store = createStore(repo);
    await repo.put(KEY.heartbeat, { schemaVersion: 1, lastTickAt: 5, durationMs: 1, counts: {} });
    await repo.put(KEY.notification("inc-1.0.0.h.sms.1"), { key: "inc-1.0.0.h.sms.1", incidentId: "inc-1" });
    await repo.put(KEY.notification("inc-10.0.0.h.sms.1"), { key: "inc-10.0.0.h.sms.1", incidentId: "inc-10" });
    expect((await store.getHeartbeat())?.lastTickAt).toBe(5);
    expect((await store.listNotifications("inc-1")).map((n) => n.incidentId)).toEqual(["inc-1"]);
  });
});
