/**
 * Regression tests for three review findings:
 *  1. Grail truncation / sampling notices must reach the engine (runGrailQuery, not records-only runQuery), and a
 *     truncated source must never count as proof of absence (no archiving);
 *  2. the engine lease TTL follows the engine interval, so a crashed tick blocks as few scheduled runs as possible;
 *  3. the delivery-report window boundary.
 */
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type EscalationPolicy, type Settings, type UserContact } from "../../ui/app/domain/contracts";
import { KEY } from "../../ui/app/data/repository";
import { MemoryRepository } from "../../ui/app/data/memoryRepository";
import { createStore } from "../../ui/app/data/store";
import { defaultSettings, MIN_LOCK_TTL_SEC } from "../../ui/app/data/domainPort";
import { asGrailResult, runGrailQuery, type QueryClientLike, type QueryRunner } from "../../ui/app/data/grail";
import { ARCHIVE_ABSENT_TICKS } from "../../ui/app/domain/engine/tick";
import { incidentIdFor } from "../../ui/app/domain/ids";
import { effectiveLockTtlSec, runEngineTick } from "../lib/engine";
import { acquireLease } from "../lib/lease";
import { fetchSources } from "../lib/sources";
import { MIN_REPORT_WINDOW_MS, REPORT_WINDOW_MS, runDeliveryReport } from "../lib/delivery";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const HOUR = 3600_000;

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
const problem = (status: "ACTIVE" | "CLOSED") => ({
  "event.id": "P-00001",
  display_id: "P-00001",
  "event.name": "Checkout latency high",
  "event.status": status,
  "event.start": "2026-11-26T11:58:00.000000000Z",
  "event.end": status === "CLOSED" ? "2026-11-26T11:59:00.000000000Z" : null,
  "dt.davis.event_ids": [],
});

type GrailMeta = { notifications?: { notificationType?: string; severity?: string; message?: string }[]; sampled?: boolean };

/**
 * The engine's real runner (runGrailQuery) over a fake query client: the problems query returns `problems` with the
 * given Grail metadata, every other query an empty, complete result. Same shape as the action passes the engine.
 */
function grailRunner(problems: Record<string, unknown>[], meta: GrailMeta = {}): QueryRunner {
  const client: QueryClientLike = {
    queryExecute: ({ body }) =>
      Promise.resolve({
        state: "SUCCEEDED" as const,
        result: body.query.startsWith("fetch dt.davis.problems")
          ? { records: problems, metadata: { grail: meta } }
          : { records: [], metadata: { grail: {} } },
      }),
    queryPoll: () => Promise.reject(new Error("unused")),
  };
  return (q, o) => runGrailQuery(q, { ...o, client });
}

// Notification type of a scan-limit cut: ASSUMED (the SDK types name no codes, only "e.g. LIMIT_ADDED"); the message
// text is matched too, so either one marks the result truncated.
const SCAN_LIMIT = { notificationType: "SCAN_LIMIT_GBYTES", severity: "WARNING", message: "Scan limit of 500 GB reached" };

describe("#1 Grail truncation notices reach the engine", () => {
  const s = settings();

  it("a scan-limit notice marks the source truncated", async () => {
    const out = await fetchSources(s, grailRunner([problem("ACTIVE")], { notifications: [SCAN_LIMIT] }), 1000, NOW);
    expect(out.status["davis-problem"]).toBe("truncated");
    expect(out.errors.join(" ")).toMatch(/Q1 problems: result truncated \(SCAN_LIMIT_GBYTES\)/);
    expect(out.problems).toHaveLength(1); // the records it got are still used
  });

  it("a sampled result marks the source truncated", async () => {
    const out = await fetchSources(s, grailRunner([problem("ACTIVE")], { sampled: true }), 1000, NOW);
    expect(out.status["davis-problem"]).toBe("truncated");
    expect(out.errors.join(" ")).toMatch(/SAMPLED/);
  });

  it("a plain result is ok", async () => {
    const out = await fetchSources(
      s,
      grailRunner([problem("ACTIVE")], { notifications: [{ notificationType: "INFO_ONLY", severity: "INFO", message: "fine" }], sampled: false }),
      1000,
      NOW,
    );
    expect(out.status).toEqual({ "davis-problem": "ok", "davis-event": "ok", "generic-event": "ok" });
    expect(out.errors).toEqual([]);
  });

  it("a full result object at the DQL limit still counts as truncated (| limit adds no notice)", () => {
    const records = Array.from({ length: 5 }, (_, i) => ({ i }));
    expect(asGrailResult({ records, truncated: false, notices: [] }, 5)).toEqual({ records, truncated: true, notices: ["RECORDS>=5"] });
    expect(asGrailResult({ records, truncated: false, notices: [] }, 6)).toEqual({ records, truncated: false, notices: [] });
  });

  it("a resolved incident whose source is truncated is never archived; an ok source archives it", async () => {
    let now = NOW;
    const r = repo(() => now);
    const id = incidentIdFor({ source: "davis-problem", sourceId: "P-00001" });
    const tickAt = async (t: number, q: QueryRunner) => {
      now = t;
      await r.delete(KEY.lock);
      return runEngineTick({ reason: "schedule" }, { repo: r, runQuery: q, now: () => t });
    };
    await tickAt(NOW, grailRunner([problem("ACTIVE")]));
    await tickAt(NOW + 60_000, grailRunner([problem("CLOSED")]));
    expect((await createStore(r).listIncidents()).find((i) => i.id === id)?.status).toBe("resolved");

    // Past retention (24 h) and absent from every query, but each result is cut short by a scan limit.
    const late = NOW + 25 * HOUR;
    for (let i = 0; i < ARCHIVE_ABSENT_TICKS + 2; i++) {
      await tickAt(late + i * 60_000, grailRunner([], { notifications: [SCAN_LIMIT] }));
    }
    expect((await createStore(r).listIncidents()).map((i) => i.id)).toContain(id);
    expect(r.keys().filter((k) => k.startsWith("arc."))).toHaveLength(0);
    const hb = (await r.get<{ lastError?: string }>(KEY.heartbeat))?.value;
    expect(hb?.lastError).toMatch(/result truncated/);

    // Complete results: archived after ARCHIVE_ABSENT_TICKS absent ticks.
    for (let i = 0; i < ARCHIVE_ABSENT_TICKS; i++) {
      await tickAt(late + (10 + i) * 60_000, grailRunner([]));
    }
    expect((await createStore(r).listIncidents()).map((i) => i.id)).not.toContain(id);
    expect(r.keys().filter((k) => k.startsWith("arc.") && k.endsWith(id))).toHaveLength(1);
  });
});

describe("#2 lease TTL follows the engine interval", () => {
  /**
   * A tick that took the lease `lateSec` after its slot (t = 0) crashed without releasing it. Counts the scheduled
   * runs k × interval (k = 1…6) that find the lease still held, each starting `earlySec` before its slot.
   */
  async function blockedRuns(intervalMinutes: number, configured: number, lateSec = 0, earlySec = 0): Promise<number> {
    const ttl = effectiveLockTtlSec(configured, intervalMinutes);
    let blocked = 0;
    for (let k = 1; k <= 6; k++) {
      const r = new MemoryRepository([{ key: KEY.lock, value: { holder: "crashed", acquiredAt: NOW + lateSec * 1000 } }]);
      const at = NOW + (k * intervalMinutes * 60 - earlySec) * 1000;
      if (!(await acquireLease(r, `run-${k}`, at, ttl, async () => undefined))) blocked++;
    }
    return blocked;
  }

  it.each([
    [1, 2],
    [2, 1],
    [5, 0],
  ])("at a %i-minute interval a crashed tick blocks %i scheduled run(s), whatever the configured TTL", async (interval, expected) => {
    for (const configured of [30, 130, 180, 600]) {
      expect(await blockedRuns(interval, configured)).toBe(expected);
      // Start jitter: the crashed tick took its lease 10 s late, the next run starts 5 s early.
      expect(await blockedRuns(interval, configured, 10, 5)).toBe(expected);
    }
  });

  it("keeps a live tick's lease for longer than one invocation (120 s) at every interval", () => {
    for (const interval of [1, 2, 5, undefined]) {
      for (const configured of [30, 130, 600, Number.NaN]) {
        const ttl = effectiveLockTtlSec(configured, interval);
        expect(ttl).toBeGreaterThanOrEqual(MIN_LOCK_TTL_SEC);
        expect(ttl).toBeGreaterThan(120);
        expect(ttl).toBeLessThanOrEqual(180);
      }
    }
  });

  it("uses the 1-minute cap when no interval is recorded", () => {
    expect(effectiveLockTtlSec(600)).toBe(effectiveLockTtlSec(600, 1));
    expect(effectiveLockTtlSec(600, 1)).toBe(165);
    expect(effectiveLockTtlSec(600, 2)).toBe(180);
    expect(effectiveLockTtlSec(600, 5)).toBe(180);
    expect(effectiveLockTtlSec(150, 5)).toBe(150);
  });
});

describe("#3 delivery-report window", () => {
  it("is at least the longest report timeout plus one invocation", () => {
    expect(MIN_REPORT_WINDOW_MS).toBe((3600 + 120) * 1000);
    expect(REPORT_WINDOW_MS).toBeGreaterThanOrEqual(MIN_REPORT_WINDOW_MS);
    expect(REPORT_WINDOW_MS).toBe(24 * HOUR);
  });

  async function reportAt(offsetMs: number) {
    const r = repo();
    const res = await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: grailRunner([problem("ACTIVE")]), now: () => NOW });
    const key = res.batches.sms[0].key; // planned at NOW
    return runDeliveryReport({ results: [{ key, status: "sent", at: NOW + offsetMs }] }, { repo: r, now: () => NOW + offsetMs });
  }

  it("accepts a result exactly at the window", async () => {
    expect(await reportAt(REPORT_WINDOW_MS)).toMatchObject({ applied: 1, unknown: 0 });
  });

  it("ignores (does not count as unknown) a result 1 ms past the window", async () => {
    const out = await reportAt(REPORT_WINDOW_MS + 1);
    expect(out).toMatchObject({ applied: 0, unknown: 0, ignored: 1 });
  });

  it("accepts a result arriving after the longest report timeout plus one invocation", async () => {
    expect(await reportAt(MIN_REPORT_WINDOW_MS)).toMatchObject({ applied: 1, unknown: 0 });
  });
});

describe("Grail cost guard (scan limit per query)", () => {
  /** A fake client that records each request body and answers with the given metadata. */
  function recordingRunner(meta: GrailMeta & { scannedBytes?: number } = {}) {
    const bodies: Record<string, unknown>[] = [];
    const client: QueryClientLike = {
      queryExecute: ({ body }) => {
        bodies.push(body);
        return Promise.resolve({ state: "SUCCEEDED" as const, result: { records: [], metadata: { grail: meta } } });
      },
      queryPoll: () => Promise.reject(new Error("unused")),
    };
    const run: QueryRunner = (q, o) => runGrailQuery(q, { ...o, client });
    return { run, bodies };
  }

  it("sends the limit as whole GB in defaultScanLimitGbytes, and nothing when unset", async () => {
    const { run, bodies } = recordingRunner();
    await run("fetch x", { scanLimitGBytes: 2.7 });
    await run("fetch x", {});
    await run("fetch x", { scanLimitGBytes: 0 });
    expect(bodies[0]).toMatchObject({ defaultScanLimitGbytes: 2 });
    expect(bodies[1]).not.toHaveProperty("defaultScanLimitGbytes");
    expect(bodies[2]).not.toHaveProperty("defaultScanLimitGbytes");
  });

  it("a query that scanned up to its limit is truncated even without a notice; below it is ok", async () => {
    const hit = await recordingRunner({ scannedBytes: 0.95e9 }).run("fetch x", { scanLimitGBytes: 1 });
    expect(hit).toMatchObject({ truncated: true, notices: ["SCAN_LIMIT_1GB"], scannedBytes: 0.95e9 });
    const fine = await recordingRunner({ scannedBytes: 1_400_000 }).run("fetch x", { scanLimitGBytes: 1 });
    expect(fine).toMatchObject({ truncated: false, notices: [], scannedBytes: 1_400_000 });
    // A scan-limit notice is not reported twice.
    const both = await recordingRunner({ scannedBytes: 1e9, notifications: [SCAN_LIMIT] }).run("fetch x", { scanLimitGBytes: 1 });
    expect(both).toMatchObject({ truncated: true, notices: ["SCAN_LIMIT_GBYTES"] });
  });

  it("every engine query carries the setting; a missing or invalid one falls back to 1 GB, never to no limit", async () => {
    const limits = async (v: number | undefined) => {
      const s = settings();
      s.engine.scanLimitGBytes = v;
      const { run, bodies } = recordingRunner({ scannedBytes: 1000 });
      const out = await fetchSources(s, run, 1000, NOW);
      return { sent: [...new Set(bodies.map((b) => b["defaultScanLimitGbytes"]))], out, n: bodies.length };
    };
    expect((await limits(5)).sent).toEqual([5]);
    expect((await limits(undefined)).sent).toEqual([1]);
    expect((await limits(0)).sent).toEqual([1]);
    expect((await limits(Number.NaN)).sent).toEqual([1]);
    expect((await limits(500)).sent).toEqual([100]);
    const { out, n } = await limits(1);
    expect(out.grail).toEqual({ queries: n, scannedBytes: n * 1000, scanLimitGBytes: 1 });
  });

  it("a source cut by the scan limit is truncated and the heartbeat records the run's Grail usage", async () => {
    const r = repo();
    const { run } = recordingRunner({ scannedBytes: 1e9 });
    await runEngineTick({ reason: "schedule" }, { repo: r, runQuery: run, now: () => NOW });
    const hb = (await r.get<{ lastError?: string; grail?: { queries: number; scannedBytes: number; scanLimitGBytes: number; incomplete?: string[] } }>(KEY.heartbeat))?.value;
    expect(hb?.lastError).toMatch(/result truncated \(SCAN_LIMIT_1GB\)/);
    expect(hb?.grail).toMatchObject({ queries: 1, scannedBytes: 1e9, scanLimitGBytes: 1, incomplete: ["davis-problem:truncated"] });
  });

  it("validates the setting as whole GB within 1–100 (optional for stored settings)", async () => {
    const { validateSettings } = await import("../../ui/app/domain/validation/validate");
    const errs = (v: number | undefined) => {
      const s = defaultSettings();
      s.engine.scanLimitGBytes = v;
      return validateSettings(s).filter((e) => e.path === "engine.scanLimitGBytes");
    };
    expect(defaultSettings().engine.scanLimitGBytes).toBe(1);
    for (const ok of [1, 100, undefined]) expect(errs(ok)).toEqual([]);
    for (const bad of [0, 1.5, 101, -1]) expect(errs(bad)).toHaveLength(1);
  });
});
