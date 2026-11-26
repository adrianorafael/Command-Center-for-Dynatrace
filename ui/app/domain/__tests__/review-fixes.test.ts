/** Regression tests for the independent review findings (#1, #4, #6, #10, #14). */
import { describe, expect, it } from "vitest";
import type { EscalationPolicy, Team } from "../contracts";
import { archiveResolvedBound, ARCHIVE_ABSENT_TICKS, tick, type TickInput } from "../engine/tick";
import { foldActions } from "../incidents/actions";
import { PLAN_CATCHUP_MS } from "../notifications/plan";
import { act, alert, allRequests, delivered, input, MIN, persist, settings, T0, teams } from "./test-utils";

const H = 3_600_000;

function resolvedState(): TickInput {
  const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
  const st = delivered({ ...i0, ...persist(i0, tick(i0)) });
  const r1 = act({ incidentId: "dp-p-1", at: T0 + MIN, type: "resolve" });
  const o1 = tick({ ...st, now: T0 + 2 * MIN, pendingActions: [r1], alerts: [alert({ sourceId: "P-1" })] });
  return { ...st, ...persist({ ...st, pendingActions: [r1] }, o1) };
}

describe("#1 resolved incidents never resurrect", () => {
  it("one empty query does not archive; the alert coming back does not re-page", () => {
    let st = resolvedState();
    const o2 = tick({ ...st, now: T0 + 25 * H, alerts: [] });
    expect(o2.archives).toHaveLength(0);
    st = { ...st, ...persist(st, o2) };
    const o3 = tick({ ...st, now: T0 + 25 * H + MIN, alerts: [alert({ sourceId: "P-1" })] });
    expect(allRequests(o3)).toHaveLength(0);
    expect(o3.counts.incidentsCreated).toBe(0);
    const inc = o3.incidentsToWrite.find((i) => i.id === "dp-p-1")!;
    expect(inc.status).toBe("resolved");
    expect((inc as { absentTicks?: number }).absentTicks).toBeUndefined(); // reset when seen again
  });
  it("failed or truncated source queries never count as absence", () => {
    let st = resolvedState();
    for (let m = 0; m < 6; m++) {
      const o = tick({ ...st, now: T0 + 25 * H + m * MIN, alerts: [], sourceStatus: { "davis-problem": m % 2 ? "failed" : "truncated" } });
      expect(o.archives).toHaveLength(0);
      st = { ...st, ...persist(st, o) };
    }
    // other sources failing does not block it
    for (let m = 0; m < ARCHIVE_ABSENT_TICKS; m++) {
      const o = tick({ ...st, now: T0 + 26 * H + m * MIN, alerts: [], sourceStatus: { "davis-problem": "ok", "generic-event": "failed" } });
      expect(o.archives.length).toBe(m === ARCHIVE_ABSENT_TICKS - 1 ? 1 : 0);
      st = { ...st, ...persist(st, o) };
    }
  });
  it("archived ids are not re-created by a still-returned alert, unless re-opened later", () => {
    const st = resolvedState();
    const resolvedAt = T0 + MIN;
    const base = { ...st, incidents: [], now: T0 + 30 * H };
    // Set form: bound = now − resolvedVisibleHours
    expect(tick({ ...base, archived: new Set(["dp-p-1"]), alerts: [alert({ sourceId: "P-1" })] }).incidentsToWrite).toHaveLength(0);
    expect(tick({ ...base, archived: new Set(["dp-p-1"]), alerts: [alert({ sourceId: "P-1", sourceStatus: "CLOSED", endedAt: T0 + 29 * H })] }).incidentsToWrite).toHaveLength(0);
    // Map form with a reopen older than the resolve → still skipped
    expect(tick({ ...base, archived: new Map([["dp-p-1", resolvedAt]]), alerts: [alert({ sourceId: "P-1", reopenedAt: resolvedAt - MIN })] }).incidentsToWrite).toHaveLength(0);
    // newer reopen → re-created, with a cycle above the old ledger records, and pages
    const o = tick({ ...base, archived: new Map([["dp-p-1", resolvedAt]]), alerts: [alert({ sourceId: "P-1", reopenedAt: T0 + 29 * H })] });
    const inc = o.incidentsToWrite[0]!;
    expect(inc.status).toBe("triggered");
    expect(inc.escalation.cycle).toBe(2);
    expect(inc.timeline.some((e) => e.type === "reopened")).toBe(true);
    expect(allRequests(o).map((r) => r.cycle)).toEqual([2]);
  });
  it("archive key helper gives an upper bound of the resolve time", () => {
    expect(archiveResolvedBound("arc.20261102.dp-p-1")).toEqual({ id: "dp-p-1", bound: Date.UTC(2026, 10, 3) - 1 });
    expect(archiveResolvedBound("inc.x")).toBeUndefined();
  });
});

describe("#4 no page bursts", () => {
  const pol: EscalationPolicy = {
    schemaVersion: 1, id: "pol-noc", name: "x", rev: 1, repeat: 3,
    steps: [{ delayMinutes: 0, targets: [{ type: "user", uid: "user-0001" }] }, { delayMinutes: 10, targets: [{ type: "user", uid: "user-0001" }] }],
  };
  const a = [alert({ sourceId: "P-1", fields: { "cc.priority": "P4" } })];
  it("quiet-hours hold pauses the clock even after the first step fired", () => {
    const i0 = input({ policies: [pol], alerts: a });
    let st = delivered({ ...i0, ...persist(i0, tick(i0)) }); // ordinal 0 at T0
    const hold: Team[] = [{ ...teams[0]!, quietHours: [{ timeZone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], from: "12:05", to: "20:00", minPriority: "P2", mode: "hold" }] }];
    const o1 = tick({ ...st, teams: hold, now: T0 + 6 * MIN, alerts: a });
    expect(allRequests(o1)).toHaveLength(0);
    st = delivered({ ...st, ...persist(st, o1) });
    // hold ends at 20:00 (T0 + 8h): 4 min of the 10 min step delay were left
    const o2 = tick({ ...st, teams: hold, now: T0 + 8 * H, alerts: a });
    expect(allRequests(o2)).toHaveLength(0);
    const inc = o2.incidentsToWrite[0]!;
    expect(inc.escalation.startedAt).toBe(T0 + 8 * H - 6 * MIN);
    st = delivered({ ...st, ...persist(st, o2) });
    expect(allRequests(tick({ ...st, teams: hold, now: T0 + 8 * H + 3 * MIN, alerts: a }))).toHaveLength(0);
    expect(allRequests(tick({ ...st, teams: hold, now: T0 + 8 * H + 4 * MIN, alerts: a })).map((r) => r.step)).toEqual([1]);
  });
  it("after an outage only one page per target is sent (latest firing)", () => {
    const pol2: EscalationPolicy = { ...pol, repeat: 2, steps: [{ ...pol.steps[0]! }, { ...pol.steps[1]!, delayMinutes: 15 }] };
    const i0 = input({ policies: [pol2], alerts: a });
    let st = delivered({ ...i0, ...persist(i0, tick(i0)) });
    const o = tick({ ...st, now: T0 + 3 * H, alerts: [] });
    expect(allRequests(o).map((r) => r.step)).toEqual([5]);
    st = delivered({ ...st, ...persist(st, o) });
    // the superseded ordinals are never sent later either
    expect(allRequests(tick({ ...st, now: T0 + 3 * H + MIN, alerts: [] }))).toHaveLength(0);
  });
  it("different targets of different steps are each paged once", () => {
    const pol3: EscalationPolicy = { ...pol, repeat: 1, steps: [{ ...pol.steps[0]! }, { delayMinutes: 10, targets: [{ type: "user", uid: "user-0002" }] }] };
    const i0 = input({ policies: [pol3], alerts: a });
    const st = delivered({ ...i0, ...persist(i0, tick(i0)) });
    const o = tick({ ...st, now: T0 + 2 * H, alerts: [] });
    expect(allRequests(o).map((r) => `${r.to.uid}:${r.step}`).sort()).toEqual(["user-0001:2", "user-0002:3"]);
  });
});

describe("#6 future-dated actions", () => {
  it("clamps to server time, so a future ack cannot freeze the status", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const st = delivered({ ...i0, ...persist(i0, tick(i0)) });
    const ack = { ...act({ incidentId: "dp-p-1", at: T0 + 24 * H, type: "ack" }), lastModifiedTime: T0 + MIN };
    const o1 = tick({ ...st, now: T0 + MIN, pendingActions: [ack] });
    const inc1 = o1.incidentsToWrite[0]!;
    expect(inc1.acknowledgedAt).toBe(T0 + MIN);
    const st2 = { ...st, ...persist({ ...st, pendingActions: [ack] }, o1) };
    const res = { ...act({ incidentId: "dp-p-1", at: T0 + 2 * MIN, type: "resolve" }), lastModifiedTime: T0 + 2 * MIN };
    const o2 = tick({ ...st2, now: T0 + 3 * MIN, pendingActions: [res] });
    expect(o2.incidentsToWrite[0]!.status).toBe("resolved");
  });
  it("clamps to now when the server time is unknown", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const st = delivered({ ...i0, ...persist(i0, tick(i0)) });
    const ack = act({ incidentId: "dp-p-1", at: T0 + 24 * H, type: "ack" });
    const o1 = tick({ ...st, now: T0 + MIN, pendingActions: [ack] });
    expect(o1.incidentsToWrite[0]!.acknowledgedAt).toBe(T0 + MIN);
  });
  it("orders by server time and records ignored actions", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const inc = persist(i0, tick(i0)).incidents[0]!;
    // client clocks say resolve then ack, the server saw ack then resolve
    const resolve = { ...act({ incidentId: inc.id, at: T0 + MIN, type: "resolve" }), lastModifiedTime: T0 + 5 * MIN };
    const ack = { ...act({ incidentId: inc.id, at: T0 + 9 * MIN, type: "ack" }), lastModifiedTime: T0 + 4 * MIN };
    const dupAck = { ...act({ incidentId: inc.id, at: T0 + 3 * MIN, type: "ack" }, "user-0002"), lastModifiedTime: T0 + 4 * MIN + 1 };
    const r = foldActions(inc, [resolve, ack, dupAck], T0 + 6 * MIN);
    expect(r.incident.status).toBe("resolved");
    expect(r.applied).toBe(2);
    const ignored = r.incident.timeline.filter((e) => e.type === "action_ignored");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]).toMatchObject({ by: "user-0002", data: { action: "ack", reason: "not-applicable" } });
    // re-folding is idempotent (ignored entries carry the action id too)
    expect(foldActions(r.incident, [resolve, ack, dupAck], T0 + 7 * MIN).incident.timeline).toHaveLength(r.incident.timeline.length);
  });
});

describe("#10 missing policy", () => {
  it("falls back to the team default policy, then settings default", () => {
    const o = tick(input({ alerts: [alert({ sourceId: "P-1" })] }));
    const inc = { ...o.incidentsToWrite[0]!, policyId: "deleted-policy" };
    const st = { ...input(), incidents: [inc], now: T0 + MIN };
    expect(allRequests(tick(st))).toHaveLength(1);
    const teamDefault: Team[] = [{ ...teams[0]!, defaultPolicyId: "pol-noc" }];
    const s = settings();
    delete s.defaults.policyId;
    expect(allRequests(tick({ ...st, settings: s, teams: teamDefault }))).toHaveLength(1);
  });
  it("records one notification_skipped entry when nothing can page", () => {
    const s = settings();
    delete s.defaults.policyId;
    const i0 = input({ settings: s, policies: [], alerts: [alert({ sourceId: "P-1" })] });
    const o0 = tick(i0);
    const inc = o0.incidentsToWrite[0]!;
    expect(inc.timeline.filter((e) => e.type === "notification_skipped" && e.data?.["reason"] === "no-policy")).toHaveLength(1);
    expect(o0.errors.join(" ")).toContain("nobody is paged");
    const o1 = tick({ ...i0, ...persist(i0, o0), now: T0 + MIN });
    expect(o1.incidentsToWrite).toHaveLength(0);
  });
});

describe("#14 dropped first pages are visible", () => {
  it("a capped page older than PLAN_CATCHUP_MS is reported once, not silently dropped", () => {
    const single: EscalationPolicy = { schemaVersion: 1, id: "pol-noc", name: "one", rev: 1, repeat: 0, steps: [{ delayMinutes: 0, targets: [{ type: "user", uid: "user-0002" }] }] };
    const s = settings({ maxNotificationsPerTick: 0 });
    const i0 = input({ settings: s, policies: [single], alerts: [alert({ sourceId: "P-1" })] });
    let st = { ...i0, ...persist(i0, tick(i0)) };
    st = { ...st, ...persist(st, tick({ ...st, now: T0 + 30 * MIN })) };
    const late = T0 + PLAN_CATCHUP_MS + 2 * MIN;
    const o = tick({ ...st, settings: settings(), now: late });
    expect(allRequests(o)).toHaveLength(0);
    const inc = o.incidentsToWrite.find((i) => i.id === "dp-p-1")!;
    const skipped = inc.timeline.filter((e) => e.type === "notification_skipped" && e.data?.["reason"] === "expired");
    expect(skipped).toHaveLength(1);
    expect(o.errors.join(" ")).toContain("dropped");
    st = { ...st, ...persist(st, o) };
    const again = tick({ ...st, settings: settings(), now: late + MIN });
    expect(again.incidentsToWrite.find((i) => i.id === "dp-p-1")).toBeUndefined();
  });
});
