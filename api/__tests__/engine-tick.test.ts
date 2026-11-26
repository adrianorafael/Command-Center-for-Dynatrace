import { describe, expect, it, vi } from "vitest";
import {
  SCHEMA_VERSION,
  type EngineHeartbeat,
  type EscalationPolicy,
  type Incident,
  type NotificationRecord,
  type Settings,
  type UserContact,
} from "../../ui/app/domain/contracts";
import { KEY } from "../../ui/app/data/repository";
import { MemoryRepository } from "../../ui/app/data/memoryRepository";
import { createStore } from "../../ui/app/data/store";
import { defaultSettings } from "../../ui/app/data/domainPort";
import type { RunQuery } from "../../ui/app/data/grail";
import { runEngineTick } from "../lib/engine";
import { runDeliveryReport } from "../lib/delivery";
import { enrichProblems } from "../lib/sources";

const NOW = Date.parse("2026-11-26T12:00:00Z");

/** Shape observed on a trial tenant (values replaced by placeholders). */
function problemRecord(status: "ACTIVE" | "CLOSED" = "ACTIVE") {
  return {
    timestamp: "2026-11-26T11:59:00.000000000Z",
    "event.id": "P-00001",
    display_id: "P-00001",
    "event.name": "Checkout latency high",
    "event.description": "# Checkout latency high",
    "event.category": "CUSTOM_ALERT",
    "event.severity": null,
    "event.status": status,
    "event.start": "2026-11-26T11:58:00.000000000Z",
    "event.end": status === "CLOSED" ? "2026-11-26T11:59:30.000000000Z" : null,
    "dt.davis.last_reopen_timestamp": null,
    "dt.davis.event_ids": ["0000000000000000001_0000000000001"],
    "dt.davis.affected_users_count": null,
    "dt.davis.mute.status": "NOT_MUTED",
    "maintenance.is_under_maintenance": false,
    "smartscape.affected_entities": null,
    "root_cause.smartscape_entity": null,
    affected_entity_ids: null,
    affected_entity_names: null,
    root_cause_entity_name: null,
    entity_tags: null,
  };
}

const eventProps = {
  "event.id": "0000000000000000001_0000000000001",
  "event.type": "CUSTOM_ALERT",
  "event.provider": "EVENTS_REST_API_INGEST",
  "cc.service": "checkout",
  "cc.priority": "P2",
};

function settings(): Settings {
  const s = defaultSettings();
  s.defaults.policyId = "pol-1";
  s.providers = s.providers.map((p) =>
    p.id === "twilio-sms" ? { ...p, enabled: true, credentialVaultId: "CREDENTIALS_VAULT-PLACEHOLDER", params: { from: "+15550000001" } } : p,
  );
  return s;
}

const policy: EscalationPolicy = {
  schemaVersion: SCHEMA_VERSION,
  id: "pol-1",
  name: "Default",
  rev: 1,
  repeat: 0,
  steps: [{ delayMinutes: 0, targets: [{ type: "user", uid: "user-0001" }] }],
};

const contact: UserContact = {
  schemaVersion: SCHEMA_VERSION,
  uid: "user-0001",
  rev: 1,
  displayName: "Ana Example",
  methods: [{ id: "m1", channel: "sms", address: "+15550000002" }],
  rules: [{ maxPriority: "P5", methodId: "m1", delayMinutes: 0 }],
};

function seededRepo(over: Partial<Settings> = {}) {
  return new MemoryRepository(
    [
      { key: KEY.settings, value: { ...settings(), ...over } },
      { key: KEY.policy("pol-1"), value: policy },
      { key: KEY.contact("user-0001"), value: contact },
    ],
    { now: () => NOW },
  );
}

function grail(records: Record<string, unknown>[] = [problemRecord()]): RunQuery & ReturnType<typeof vi.fn> {
  return vi.fn((q: string) => {
    if (q.startsWith("fetch dt.davis.problems")) return Promise.resolve(records);
    if (q.startsWith("fetch dt.davis.events") && q.includes("in(event.id")) return Promise.resolve([eventProps]);
    return Promise.resolve([]);
  }) as unknown as RunQuery & ReturnType<typeof vi.fn>;
}

describe("engine-tick", () => {
  it("creates an incident from a problem, plans an SMS and writes ledger + heartbeat", async () => {
    const repo = seededRepo();
    const q = grail();
    const res = await runEngineTick({ reason: "schedule" }, { repo, runQuery: q, now: () => NOW });

    expect(res.ok).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(res.counts.incidentsCreated).toBe(1);
    expect(res.batches.sms).toHaveLength(1);
    expect(res.batches.sms[0]).toMatchObject({ providerId: "twilio-sms", to: { uid: "user-0001", address: "+15550000002" } });
    expect(res.providers.find((p) => p.id === "twilio-sms")).toMatchObject({ credentialVaultId: "CREDENTIALS_VAULT-PLACEHOLDER" });

    const store = createStore(repo);
    const incidents = await store.listIncidents();
    expect(incidents).toHaveLength(1);
    // cc.* properties of the problem's Davis event were merged in for routing (Q4)
    expect(incidents[0].alert.fields["cc.service"]).toBe("checkout");
    const ledger = await store.listNotifications();
    expect(ledger.map((r) => r.status)).toEqual(["planned"]);
    const hb = (await repo.get<EngineHeartbeat>(KEY.heartbeat))?.value;
    expect(hb).toMatchObject({ lastTickAt: NOW, counts: { incidentsCreated: 1 } });
    expect(await repo.get(KEY.lock)).toBeUndefined(); // lease released

    const queries = q.mock.calls.map((c) => String(c[0]));
    expect(queries.some((s) => s.startsWith("fetch dt.davis.problems"))).toBe(true);
    expect(queries.some((s) => s.includes('array("0000000000000000001_0000000000001")'))).toBe(true);
  });

  it("is idempotent: a second tick plans nothing new", async () => {
    const repo = seededRepo();
    await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail(), now: () => NOW });
    const again = await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail(), now: () => NOW + 1000 });
    expect(again.counts.incidentsCreated).toBe(0);
    expect(again.batches.sms).toHaveLength(0);
  });

  it("folds an operator ack and deletes the action key; ack stops paging", async () => {
    const repo = seededRepo();
    await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail(), now: () => NOW });
    const store = createStore(repo);
    const [inc] = await store.listIncidents();
    repo.actor = "user-0002";
    await store.appendAction({ schemaVersion: SCHEMA_VERSION, incidentId: inc.id, at: NOW + 500, clientId: "c1", type: "ack" });
    expect(await store.listActions(inc.id)).toHaveLength(1);

    const res = await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail(), now: () => NOW + 60_000 });
    expect(res.counts.actionsFolded).toBe(1);
    expect(await store.listActions()).toHaveLength(0);
    const after = (await store.getIncident(inc.id)) as Incident;
    expect(after.status).toBe("acknowledged");
    expect(after.acknowledgedBy).toBe("user-0002");
  });

  it("resolves on an explicit CLOSED record, never on absence", async () => {
    const repo = seededRepo();
    await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail(), now: () => NOW });
    const store = createStore(repo);
    await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail([]), now: () => NOW + 60_000 });
    expect((await store.listIncidents())[0].status).toBe("triggered");
    await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail([problemRecord("CLOSED")]), now: () => NOW + 120_000 });
    expect((await store.listIncidents())[0].status).toBe("resolved");
  });

  it("a failing query is reported, not fatal", async () => {
    const repo = seededRepo();
    const q = vi.fn(() => Promise.reject(new Error("403 storage:events:read missing"))) as unknown as RunQuery;
    const res = await runEngineTick({ reason: "schedule" }, { repo, runQuery: q, now: () => NOW });
    expect(res.ok).toBe(true);
    expect(res.errors.join(" ")).toMatch(/Q1 problems: 403/);
    expect((await repo.get<EngineHeartbeat>(KEY.heartbeat))?.value.lastError).toMatch(/Q1 problems/);
  });

  it("skips when another holder owns a fresh lease, and when the engine is disabled", async () => {
    const repo = seededRepo();
    await repo.put(KEY.lock, { holder: "other", acquiredAt: NOW - 10_000 }, 120_000);
    const q = grail();
    expect((await runEngineTick({ reason: "schedule" }, { repo, runQuery: q, now: () => NOW })).skipped).toBe("locked");
    expect(q).not.toHaveBeenCalled();
    // stale lease (older than lockTtlSec = 90 s) is taken over
    await repo.put(KEY.lock, { holder: "other", acquiredAt: NOW - 100_000 }, 120_000);
    expect((await runEngineTick({ reason: "schedule" }, { repo, runQuery: q, now: () => NOW })).skipped).toBeUndefined();

    const s = settings();
    s.engine.enabled = false;
    const disabled = seededRepo({ engine: s.engine });
    expect((await runEngineTick({ reason: "schedule" }, { repo: disabled, runQuery: grail(), now: () => NOW })).skipped).toBe(
      "disabled",
    );
  });

  it("reason 'test' builds one synthetic request without touching state", async () => {
    const repo = seededRepo();
    const before = repo.keys();
    const q = grail();
    const res = await runEngineTick(
      { reason: "test", testRequest: { providerId: "twilio-sms", channel: "sms", address: "+15550000009" } },
      { repo, runQuery: q, now: () => NOW },
    );
    expect(res.ok).toBe(true);
    expect(res.batches.sms).toHaveLength(1);
    expect(res.batches.sms[0]).toMatchObject({ providerId: "twilio-sms", to: { address: "+15550000009" }, incidentId: "test" });
    expect(res.batches.sms[0].key).toMatch(/^test\./);
    expect(q).not.toHaveBeenCalled();
    expect(repo.keys()).toEqual(before);

    const bad = await runEngineTick(
      { reason: "test", testRequest: { providerId: "twilio-sms", channel: "slack", address: "x" } },
      { repo, runQuery: q, now: () => NOW },
    );
    expect(bad.ok).toBe(false);
  });
});

describe("delivery-report", () => {
  it("marks ledger records sent and tolerates unknown/test keys and garbage", async () => {
    const repo = seededRepo();
    const res = await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail(), now: () => NOW });
    const key = res.batches.sms[0].key;
    const out = await runDeliveryReport(
      {
        results: [
          { key, status: "sent", providerRef: "SM-placeholder", at: NOW + 2000 },
          { key: "test.1.abc", status: "sent", at: NOW + 2000 },
          { nonsense: true },
        ],
      },
      { repo, now: () => NOW + 3000 },
    );
    expect(out.applied).toBe(1);
    expect(out.unknown).toBe(1);
    const rec = (await repo.get<NotificationRecord>(KEY.notification(key)))?.value;
    expect(rec).toMatchObject({ status: "sent", providerRef: "SM-placeholder" });
    const store = createStore(repo);
    const [inc] = await store.listIncidents();
    expect(inc.timeline.some((e) => e.type === "notification_sent")).toBe(true);
    expect((await store.listRollups())[0].notificationsSent).toBe(1);

    expect((await runDeliveryReport({ results: "x" }, { repo })).ok).toBe(false);
  });
});

describe("enrichProblems", () => {
  it("copies cc.* fields without overriding the problem's own", () => {
    const [p] = enrichProblems([{ ...problemRecord(), "cc.service": "own" }], [{ ...eventProps, "cc.team": "noc" }]);
    expect(p["cc.service"]).toBe("own");
    expect(p["cc.team"]).toBe("noc");
    expect(p["cc.priority"]).toBe("P2");
  });
});

describe("delivery-report race guard", () => {
  it("updates only the ledger while a tick holds the lease", async () => {
    const repo = seededRepo();
    const res = await runEngineTick({ reason: "schedule" }, { repo, runQuery: grail(), now: () => NOW });
    const key = res.batches.sms[0].key;
    await repo.put(KEY.lock, { holder: "tick-other", acquiredAt: NOW + 1000 }, 120_000);
    const out = await runDeliveryReport({ results: [{ key, status: "sent", at: NOW + 2000 }] }, { repo, now: () => NOW + 3000 });
    expect(out.timelineSkipped).toBe(true);
    expect((await repo.get<NotificationRecord>(KEY.notification(key)))?.value.status).toBe("sent");
    const [inc] = await createStore(repo).listIncidents();
    expect(inc.timeline.some((e) => e.type === "notification_sent")).toBe(false);
    expect((await repo.get<{ holder: string }>(KEY.lock))?.value.holder).toBe("tick-other");
  });
});
