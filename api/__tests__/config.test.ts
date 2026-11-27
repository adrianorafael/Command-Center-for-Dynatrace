import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../../ui/app/data/memoryRepository";
import { createStore } from "../../ui/app/data/store";
import { runConfig, type ConfigBundle } from "../lib/config";
import type { EscalationPolicy, Team, UserContact } from "../../ui/app/domain/contracts";

const team: Team = {
  schemaVersion: 1,
  id: "noc",
  name: "NOC",
  rev: 1,
  members: [{ uid: "user-0001", role: "responder" }],
};
const policy: EscalationPolicy = {
  schemaVersion: 1,
  id: "noc-default",
  name: "NOC default",
  teamId: "noc",
  rev: 1,
  repeat: 0,
  steps: [{ delayMinutes: 0, targets: [{ type: "team", teamId: "noc" }] }],
};
const contact: UserContact = {
  schemaVersion: 1,
  uid: "user-0001",
  rev: 1,
  methods: [{ id: "m1", channel: "sms", address: "+15550100001" }],
  rules: [{ maxPriority: "P5", methodId: "m1", delayMinutes: 0 }],
};

describe("config function", () => {
  it("imports a valid bundle and exports it back", async () => {
    const repo = new MemoryRepository();
    const bundle: ConfigBundle = { teams: [team], policies: [policy], contacts: [contact] };
    const res = await runConfig({ op: "import", bundle }, repo);
    expect(res.ok).toBe(true);
    expect(res.written).toMatchObject({ teams: 1, policies: 1, contacts: 1 });

    const out = await runConfig({ op: "export" }, repo);
    expect(out.bundle?.teams.map((t) => t.id)).toEqual(["noc"]);
    expect(out.bundle?.policies[0].steps).toHaveLength(1);
    expect(out.bundle?.settings.schemaVersion).toBe(1);
  });

  it("rejects dangling references and writes nothing", async () => {
    const repo = new MemoryRepository();
    const bad = { ...policy, steps: [{ delayMinutes: 0, targets: [{ type: "team" as const, teamId: "ghost" }] }] };
    const res = await runConfig({ op: "import", bundle: { policies: [bad] } }, repo);
    expect(res.ok).toBe(false);
    expect(res.errors?.length).toBeGreaterThan(0);
    expect(await createStore(repo).listPolicies()).toEqual([]);
  });

  it("dry run validates without writing", async () => {
    const repo = new MemoryRepository();
    const res = await runConfig({ op: "import", bundle: { teams: [team] }, dryRun: true }, repo);
    expect(res.ok).toBe(true);
    expect(await createStore(repo).listTeams()).toEqual([]);
  });
});

describe("config import hardening", () => {
  it("merges settings per section instead of resetting siblings", async () => {
    const repo = new MemoryRepository();
    const store = createStore(repo);
    const before = await store.getSettings();
    await store.saveSettings({ ...before, engine: { ...before.engine, maxAttempts: 5 } });
    const res = await runConfig({ op: "import", bundle: { settings: { engine: { enabled: false } } as never } }, repo);
    expect(res.ok).toBe(true);
    const after = await store.getSettings();
    expect(after.engine.enabled).toBe(false);
    expect(after.engine.maxAttempts).toBe(5);
    expect(after.engine.workflowId).toBe(before.engine.workflowId);
  });

  it("rejects an invalid id before writing anything", async () => {
    const repo = new MemoryRepository();
    const badContact = { ...contact, uid: "Bad UID!" };
    const res = await runConfig({ op: "import", bundle: { teams: [team], contacts: [badContact] } }, repo);
    expect(res.ok).toBe(false);
    expect(await createStore(repo).listTeams()).toEqual([]);
  });
});
