/** Regression tests for the independent review findings (numbers refer to the review list). */
import { describe, expect, it, vi } from "vitest";
import {
  SCHEMA_VERSION,
  type DailyRollup,
  type EscalationPolicy,
  type NotificationRecord,
  type Settings,
  type UserContact,
} from "../../ui/app/domain/contracts";
import { KEY } from "../../ui/app/data/repository";
import { MemoryRepository } from "../../ui/app/data/memoryRepository";
import { createStore, rollupDeltaKey } from "../../ui/app/data/store";
import { DEFAULT_LOCK_TTL_SEC, MIN_LOCK_TTL_SEC, defaultSettings } from "../../ui/app/data/domainPort";
import type { QueryRunner } from "../../ui/app/data/grail";
import { runEngineTick, type EngineHeartbeatWithStorage } from "../lib/engine";
import { runDeliveryReport } from "../lib/delivery";
import { fetchSources, HOLD_INCOMPLETE_MS } from "../lib/sources";
import { shedArchives, slimRecord } from "../lib/storage";

const NOW = Date.parse("2026-11-26T12:00:00Z");

function settings(): Settings {
  const s = defaultSettings();
  s.defaults.policyId = "pol-1";
  s.providers = s.providers.map((p) =>
    p.id === "twilio-sms" ? { ...p, enabled: true, credentialVaultId: "CREDENTIALS_VAULT-PLACEHOLDER", params: { from: "+15550000001" } } : p,
  );
  return s;
}
const policy: EscalationPolicy = {
  schemaVersion: SCHEMA_VERSION, id: "pol-1", name: "D", rev: 1, repeat: 0,
  steps: [{ delayMinutes: 0, targets: [{ type: "user", uid: "user-0001" }] }],
};
const contact: UserContact = {
  schemaVersion: SCHEMA_VERSION, uid: "user-0001", rev: 1,
  methods: [{ id: "m1", channel: "sms", address: "+15550000002" }],
  rules: [{ maxPriority: "P5", methodId: "m1", delayMinutes: 0 }],
};
function repo(nowFn: () => number = () => NOW) {
  return new MemoryRepository(
    [
      { key: KEY.settings, value: settings() },
      { key: KEY.policy("pol-1"), value: policy },
      { key: KEY.contact("user-0001"), value: contact },
    ],
    { now: nowFn },
  );
}
const problem = (start = "2026-11-26T11:58:00.000000000Z", ids: string[] = []) => ({
  "event.id": "P-00001",
  display_id: "P-00001",
  "event.name": "Checkout latency high",
  "event.status": "ACTIVE",
  "event.start": start,
  "event.end": null,
  "dt.davis.event_ids": ids,
});
const grail = (records: Record<string, unknown>[] = [problem()]): QueryRunner =>
  vi.fn((q: string) => Promise.resolve(q.startsWith("fetch dt.davis.problems") ? records : [])) as unknown as QueryRunner;

describe("#2 failures never stop the heartbeat", () => {
  it("lease acquisition failure → ok:false and hb.lastError", async () => {
    const r = repo();
    const origGet = r.get.bind(r);
    r.get = (async (k: string) => {
      if (k === KEY.lock) throw new Error("state service unavailable");
      return origGet(k);
    }) as typeof r.get;
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/state service unavailable/);
    const hb = (await r.get<EngineHeartbeatWithStorage>(KEY.heartbeat))?.value;
    expect(hb?.lastError).toMatch(/state service unavailable/);
  });

  it("every write failing → ok:true/false but never throws, nothing sent", async () => {
    const r = repo();
    r.put = (() => Promise.reject(new Error("AppStateOverallSizeLimitExceeded"))) as typeof r.put;
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    expect(res.ok).toBe(false);
    expect(Object.values(res.batches).flat()).toHaveLength(0);
  });

  it("heartbeat carries a storage estimate per prefix", async () => {
    const r = repo();
    await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    const hb = (await r.get<EngineHeartbeatWithStorage>(KEY.heartbeat))?.value;
    expect(hb?.storage?.limitBytes).toBe(50 * 1024 * 1024);
    expect(hb?.storage?.byPrefix["contact."]?.keys).toBe(1);
    expect(hb?.storage?.byPrefix["arc."]).toBeDefined();
    expect(hb?.storage?.totalBytes).toBeGreaterThan(0);
  });

  it("final ledger records drop the message body; rollups get a 90-day TTL", async () => {
    let now = NOW;
    const r = repo(() => now);
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => now });
    const key = res.batches.sms[0].key;
    await runDeliveryReport({ results: [{ key, status: "sent", at: NOW + 1000 }] }, { repo: r, now: () => NOW + 2000 });
    const rec = (await r.get<NotificationRecord>(KEY.notification(key)))?.value;
    expect(rec).toMatchObject({ status: "sent", text: "" });
    expect(rec?.subject).toBeTruthy();
    expect(rec).not.toHaveProperty("speech");
    expect(r.keys().filter((k) => k.startsWith("rpt.")).length).toBeGreaterThan(0); // main + delta key
    now += 91 * 24 * 3600_000;
    expect(r.keys().filter((k) => k.startsWith("rpt."))).toHaveLength(0);
  });

  it("slimRecord keeps identity and subject", () => {
    const s = slimRecord({ key: "k", text: "long", speech: "x", subject: "s" } as NotificationRecord);
    expect(s).toEqual({ key: "k", text: "", subject: "s" });
  });

  it("sheds the oldest archives first above the threshold", async () => {
    const r = new MemoryRepository();
    const rows = ["arc.20261101.a", "arc.20261020.b", "arc.20261110.c"].map((key) => ({ key, value: { pad: "x".repeat(100) } }));
    for (const row of rows) await r.put(row.key, row.value);
    const res = await shedArchives(r, rows, 400, 200);
    expect(res.deleted).toBe(2);
    expect(r.keys()).toEqual(["arc.20261110.c"]);
  });
});

describe("#3 a failed ledger write is not sent", () => {
  it("drops the request and does not re-send it every tick", async () => {
    const r = repo();
    const put = r.put.bind(r);
    r.put = ((k: string, v: unknown, ttl?: number) =>
      k.startsWith("ntf.") ? Promise.reject(new Error("AppStateOverallSizeLimitExceeded")) : put(k, v, ttl)) as typeof r.put;
    for (let i = 0; i < 3; i++) {
      const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW + i * 60_000 });
      expect(res.batches.sms).toHaveLength(0);
      expect(res.errors.join(" ")).toMatch(/write notification|not sent/);
    }
  });
});

describe("#9 lease", () => {
  it("defaults to a TTL above the longest tick", () => {
    expect(defaultSettings().engine.lockTtlSec).toBeGreaterThanOrEqual(MIN_LOCK_TTL_SEC);
    expect(DEFAULT_LOCK_TTL_SEC).toBe(130);
  });

  it("aborts without writing when the lease is lost during the tick", async () => {
    const r = repo();
    const q = vi.fn(async (query: string) => {
      // another tick steals the lease while this one is querying
      await r.put(KEY.lock, { holder: "intruder", acquiredAt: NOW }, 150_000);
      return query.startsWith("fetch dt.davis.problems") ? [problem()] : [];
    }) as unknown as QueryRunner;
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: q, now: () => NOW });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/lease lost/);
    expect(Object.values(res.batches).flat()).toHaveLength(0);
    expect(await createStore(r).listIncidents()).toHaveLength(0);
    expect((await r.get<{ holder: string }>(KEY.lock))?.value.holder).toBe("intruder");
  });
});

describe("#16/#17 rollups and timeouts", () => {
  it("delivery outside the lease writes a delta key that the engine folds; readers sum both", async () => {
    const r = repo();
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    const key = res.batches.sms[0].key;
    await r.put(KEY.lock, { holder: "tick-other", acquiredAt: NOW + 1000 }, 150_000);
    await runDeliveryReport({ results: [{ key, status: "sent", at: NOW + 2000 }] }, { repo: r, now: () => NOW + 3000 });
    const deltas = r.keys().filter((k) => k.startsWith(rollupDeltaKey("2026-11-26", "")));
    expect(deltas).toHaveLength(1);
    const rollups = await createStore(r).listRollups();
    expect(rollups).toHaveLength(1);
    expect(rollups[0].notificationsSent).toBe(1);
    expect(rollups[0].created).toBe(1);

    await r.delete(KEY.lock);
    await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW + 60_000 });
    expect(r.keys().filter((k) => k.includes(".d."))).toHaveLength(0);
    const main = (await r.get<DailyRollup>(KEY.rollup("2026-11-26")))?.value;
    expect(main?.notificationsSent).toBe(1);
  });

  it("a timeout is not written over a record that became sent meanwhile, and no retry goes out", async () => {
    const r = repo();
    const first = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    const key = first.batches.sms[0].key;
    const later = NOW + 10 * 60_000; // beyond reportTimeoutSec → the tick plans a timeout + retry
    const q = vi.fn(async (query: string) => {
      const rec = (await r.get<NotificationRecord>(KEY.notification(key)))!.value;
      await r.put(KEY.notification(key), { ...rec, status: "sent", reportedAt: later - 1 });
      return query.startsWith("fetch dt.davis.problems") ? [problem()] : [];
    }) as unknown as QueryRunner;
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: q, now: () => later });
    expect((await r.get<NotificationRecord>(KEY.notification(key)))?.value.status).toBe("sent");
    expect(res.batches.sms.filter((n) => n.key.startsWith(key.slice(0, key.lastIndexOf("."))))).toHaveLength(0);
  });
});

describe("#7 delivery-report accepts only open records", () => {
  it("ignores results for records already final", async () => {
    const r = repo();
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    const key = res.batches.sms[0].key;
    await runDeliveryReport({ results: [{ key, status: "sent", providerRef: "a", at: NOW + 1000 }] }, { repo: r, now: () => NOW + 2000 });
    const out = await runDeliveryReport({ results: [{ key, status: "failed", error: "late", at: NOW + 3000 }] }, { repo: r, now: () => NOW + 4000 });
    expect(out).toMatchObject({ applied: 0, ignored: 1 });
    expect((await r.get<NotificationRecord>(KEY.notification(key)))?.value).toMatchObject({ status: "sent", providerRef: "a" });
  });

  it("ignores results for records planned outside the report window", async () => {
    const r = repo();
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    const key = res.batches.sms[0].key;
    const out = await runDeliveryReport({ results: [{ key, status: "sent", at: NOW }] }, { repo: r, now: () => NOW + 2 * 24 * 3600_000 });
    expect(out).toMatchObject({ applied: 0, ignored: 1 });
  });
});

describe("#15/#21 source health", () => {
  const s = settings();
  it("a failed query marks the source failed", async () => {
    const q = vi.fn(() => Promise.reject(new Error("boom"))) as unknown as QueryRunner;
    const out = await fetchSources(s, q, 1000, NOW);
    expect(out.status["davis-problem"]).toBe("failed");
  });

  it("a Grail truncation notice marks the source truncated", async () => {
    const q = vi.fn((query: string) =>
      Promise.resolve(
        query.startsWith("fetch dt.davis.problems")
          ? { records: [problem()], truncated: true, notices: ["API_RECORDS_LIMIT_ADDED"] }
          : [],
      ),
    ) as unknown as QueryRunner;
    const out = await fetchSources(s, q, 1000, NOW);
    expect(out.status["davis-problem"]).toBe("truncated");
    expect(out.errors.join(" ")).toMatch(/API_RECORDS_LIMIT_ADDED/);
  });

  it("a failed Q4 holds young problems back but lets older ones through", async () => {
    const q = (start: string) =>
      vi.fn((query: string) =>
        query.startsWith("fetch dt.davis.problems")
          ? Promise.resolve([problem(start, ["0000000000000000001_0000000000001"])])
          : query.includes("in(event.id")
            ? Promise.reject(new Error("q4 failed"))
            : Promise.resolve([]),
      ) as unknown as QueryRunner;
    const young = await fetchSources(s, q(new Date(NOW - 60_000).toISOString()), 1000, NOW);
    expect(young.problems).toHaveLength(0);
    expect(young.heldProblems).toBe(1);
    expect(young.status["davis-problem"]).toBe("truncated");
    const old = await fetchSources(s, q(new Date(NOW - HOLD_INCOMPLETE_MS - 1).toISOString()), 1000, NOW);
    expect(old.problems).toHaveLength(1);
  });
});

describe("archived incidents and source status are wired into the tick", () => {
  it("does not resurrect an archived incident whose problem is still returned", async () => {
    const { incidentIdFor } = await import("../../ui/app/domain/ids");
    const r = repo();
    const id = incidentIdFor({ source: "davis-problem", sourceId: "P-00001" });
    await r.put(KEY.archive("20261126", id), { id, status: "resolved" });
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail([problem("2026-11-26T09:00:00.000000000Z")]), now: () => NOW });
    expect(res.counts.incidentsCreated).toBe(0);
    expect(await createStore(r).listIncidents()).toHaveLength(0);
  });

  it("archivedBounds maps archive keys to resolve-time bounds", async () => {
    const { archivedBounds } = await import("../lib/engine");
    const m = archivedBounds([{ key: "arc.20261125.dp-p-00001" }, { key: "nope" }]);
    expect([...m.keys()]).toEqual(["dp-p-00001"]);
    expect(m.get("dp-p-00001")).toBeGreaterThanOrEqual(Date.parse("2026-11-25T00:00:00Z"));
  });
});

describe("lease hygiene (late escalation steps diagnosed live)", () => {
  it("a locked skip only bumps skippedLocked/lastSkippedAt and keeps the running tick's heartbeat", async () => {
    const r = repo();
    await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    const hb1 = (await r.get<EngineHeartbeatWithStorage>(KEY.heartbeat))!.value;
    await r.put(KEY.lock, { holder: "running", acquiredAt: NOW + 50_000 }, 130_000);
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW + 60_000 });
    expect(res.skipped).toBe("locked");
    const hb2 = (await r.get<EngineHeartbeatWithStorage>(KEY.heartbeat))!.value;
    expect(hb2.lastTickAt).toBe(hb1.lastTickAt);
    expect(hb2).toMatchObject({ skippedLocked: 1, lastSkippedAt: NOW + 60_000 });
    // the next successful tick keeps the counter
    await r.delete(KEY.lock);
    await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW + 120_000 });
    expect((await r.get<EngineHeartbeatWithStorage>(KEY.heartbeat))!.value).toMatchObject({ skippedLocked: 1, lastTickAt: NOW + 120_000 });
  });

  it("always releases the lease; a failing delete is neutralised by an expired overwrite", async () => {
    const r = repo();
    r.delete = (() => Promise.reject(new Error("delete failed"))) as typeof r.delete;
    await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    const lock = (await r.get<{ holder: string; acquiredAt: number }>(KEY.lock))?.value;
    expect(lock?.acquiredAt).toBe(0);
    // the very next minute's tick is not blocked
    const next = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW + 60_000 });
    expect(next.skipped).toBeUndefined();
  });

  it("an expired lease left behind is overwritten, never waited for", async () => {
    const r = repo();
    await r.put(KEY.lock, { holder: "crashed", acquiredAt: NOW - 131_000 }, 600_000);
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grail(), now: () => NOW });
    expect(res.skipped).toBeUndefined();
    expect(await r.get(KEY.lock)).toBeUndefined();
  });

  it("clamps the configured TTL to 130…180 s", async () => {
    const { effectiveLockTtlSec } = await import("../lib/engine");
    expect(effectiveLockTtlSec(90)).toBe(130);
    expect(effectiveLockTtlSec(600)).toBe(180);
    expect(effectiveLockTtlSec(Number.NaN)).toBe(130);
  });
});
