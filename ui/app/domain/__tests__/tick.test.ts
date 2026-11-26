import { describe, expect, it } from "vitest";
import type { EscalationPolicy, Team } from "../contracts";
import { tick } from "../engine/tick";
import { applyDeliveryResults } from "../engine/delivery";
import { uidHash } from "../ids";
import { act, alert, allRequests, delivered, input, MIN, persist, settings, T0, teams } from "./test-utils";

const H = 3_600_000;

describe("engine tick", () => {
  it("creates an incident and pages step 0 (on-call at now)", () => {
    const out = tick(input({ alerts: [alert({ sourceId: "P-1" })] }));
    expect(out.counts).toMatchObject({ alertsFetched: 1, incidentsCreated: 1, notificationsPlanned: 1 });
    const reqs = allRequests(out);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ channel: "slack", to: { uid: "user-0002", address: "@sam", name: "Sam Demo" }, providerId: "slack", attempt: 1, step: 0, cycle: 1 });
    expect(reqs[0]!.key).toBe(`dp-p-1.1.0.${uidHash("user-0002")}.slack.1`);
    expect(out.batches.slack).toHaveLength(1);
    expect(out.notificationsToWrite).toHaveLength(1);
    expect(out.notificationsToWrite[0]).toMatchObject({ status: "planned", plannedAt: T0 });
    const inc = out.incidentsToWrite[0]!;
    expect(inc.timeline.map((e) => e.type)).toEqual(["created", "routed", "escalation_step", "notification_planned"]);
    expect(out.rollupDelta).toMatchObject({ day: "2026-11-02", created: 1, pagesByUser: { "user-0002": 1 } });
  });

  it("is deterministic and idempotent (same input → same output; persisted re-run → zero new)", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" }), alert({ sourceId: "P-2", title: "Disk full" })] });
    const a = tick(i0);
    const b = tick(i0);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const i1 = { ...i0, ...persist(i0, a) };
    const c = tick(i1);
    expect(allRequests(c)).toHaveLength(0);
    expect(c.notificationsToWrite).toHaveLength(0);
    expect(c.incidentsToWrite).toHaveLength(0);
    expect(c.counts.incidentsCreated).toBe(0);
  });

  it("absent from the query ≠ resolved; escalation keeps running", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const s0 = delivered({ ...i0, ...persist(i0, tick(i0)) });
    const i1 = { ...s0, now: T0 + 10 * MIN, alerts: [] };
    const out = tick(i1);
    expect(out.counts.incidentsResolved).toBe(0);
    const inc = out.incidentsToWrite.find((x) => x.id === "dp-p-1")!;
    expect(inc.status).toBe("triggered");
    // step 1 (user-0002 again, different ordinal → new key)
    const reqs = allRequests(out);
    expect(reqs.map((r) => r.step)).toEqual([1]);
  });

  it("source CLOSED resolves and stops paging", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const s0 = { ...i0, ...persist(i0, tick(i0)) };
    const out = tick({ ...s0, now: T0 + 10 * MIN, alerts: [alert({ sourceId: "P-1", sourceStatus: "CLOSED", endedAt: T0 + 9 * MIN })] });
    expect(out.counts.incidentsResolved).toBe(1);
    expect(out.incidentsToWrite[0]).toMatchObject({ status: "resolved", resolvedBy: "source", resolvedAt: T0 + 9 * MIN });
    expect(allRequests(out)).toHaveLength(0);
    expect(out.rollupDelta).toMatchObject({ resolved: 1, ttrCount: 1, ttrSumMs: 9 * MIN });
  });

  it("folds operator ack: deletes the key, stops paging, records TTA", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const s0 = { ...i0, ...persist(i0, tick(i0)) };
    const ack = act({ incidentId: "dp-p-1", at: T0 + 2 * MIN, type: "ack" }, "user-0002");
    const out = tick({ ...s0, now: T0 + 10 * MIN, pendingActions: [ack] });
    expect(out.actionKeysToDelete).toEqual([ack.key]);
    expect(out.counts.actionsFolded).toBe(1);
    expect(out.incidentsToWrite[0]).toMatchObject({ status: "acknowledged", acknowledgedBy: "user-0002" });
    expect(allRequests(out)).toHaveLength(0);
    expect(out.rollupDelta).toMatchObject({ ttaCount: 1, ttaSumMs: 2 * MIN });
  });

  it("snooze expiry re-triggers with a new cycle and pages again", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const s0 = { ...i0, ...persist(i0, tick(i0)) };
    const sn = act({ incidentId: "dp-p-1", at: T0 + MIN, type: "snooze", until: T0 + 30 * MIN });
    const o1 = tick({ ...s0, now: T0 + 2 * MIN, pendingActions: [sn] });
    expect(o1.incidentsToWrite[0]!.status).toBe("snoozed");
    const s1 = { ...s0, ...persist({ ...s0, pendingActions: [sn] }, o1) };
    const o2 = tick({ ...s1, now: T0 + 30 * MIN });
    expect(o2.incidentsToWrite[0]).toMatchObject({ status: "triggered", escalation: { cycle: 2 } });
    expect(allRequests(o2).map((r) => r.key.split(".").slice(1, 3).join("."))).toEqual(["2.0"]);
  });

  it("ledger: timeout → retry → … → final failure (once)", () => {
    const s = settings({ reportTimeoutSec: 180, maxAttempts: 3 });
    let state = input({ settings: s, alerts: [alert({ sourceId: "P-1" })] });
    const o0 = tick(state);
    state = { ...state, ...persist(state, o0), alerts: [] };
    // still planned before the timeout → nothing
    expect(allRequests(tick({ ...state, now: T0 + 179_000 }))).toHaveLength(0);
    // attempt 1 times out → attempt 2
    let o = tick({ ...state, now: T0 + 180_000 });
    expect(o.counts.notificationsRetried).toBe(1);
    expect(o.notificationsToWrite.find((r) => r.attempt === 1)?.status).toBe("timeout");
    expect(allRequests(o).map((r) => r.attempt)).toEqual([2]);
    state = { ...state, ...persist(state, o), now: T0 + 180_000 };
    // attempt 2 reported failed by the workflow → attempt 3 on next tick
    const key2 = allRequests(o)[0]!.key;
    const d = applyDeliveryResults({ now: T0 + 200_000, results: [{ key: key2, status: "failed", error: "HTTP 500", at: T0 + 200_000 }], ledger: state.ledger, incidents: state.incidents });
    expect(d.notificationsToWrite[0]).toMatchObject({ status: "failed", error: "HTTP 500" });
    state = { ...state, ledger: state.ledger.map((r) => d.notificationsToWrite.find((x) => x.key === r.key) ?? r), incidents: state.incidents.map((i) => d.incidentsToWrite.find((x) => x.id === i.id) ?? i) };
    o = tick({ ...state, now: T0 + 4 * MIN });
    expect(allRequests(o).map((r) => r.attempt)).toEqual([3]);
    state = { ...state, ...persist(state, o), now: T0 + 4 * MIN };
    // attempt 3 times out → final failure entry, no attempt 4
    o = tick({ ...state, now: T0 + 8 * MIN });
    expect(allRequests(o).filter((r) => r.attempt > 3)).toHaveLength(0);
    const inc = o.incidentsToWrite.find((x) => x.id === "dp-p-1")!;
    expect(inc.timeline.filter((e) => e.type === "notification_failed" && e.data?.["final"] === true)).toHaveLength(1);
    state = { ...state, ...persist(state, o), now: T0 + 8 * MIN };
    const again = tick({ ...state, now: T0 + 9 * MIN });
    const inc2 = again.incidentsToWrite.find((x) => x.id === "dp-p-1");
    expect((inc2 ?? inc).timeline.filter((e) => e.type === "notification_failed" && e.data?.["final"] === true)).toHaveLength(1);
  });

  it("caps per tick and drains the overflow next tick (overflow not written)", () => {
    const s = settings({ maxNotificationsPerTick: 1 });
    const i0 = input({ settings: s, alerts: [alert({ sourceId: "P-1", fields: { "cc.priority": "P4" } }), alert({ sourceId: "P-2", fields: { "cc.priority": "P1" } })] });
    const o0 = tick(i0);
    expect(allRequests(o0)).toHaveLength(1);
    expect(allRequests(o0)[0]!.incidentId).toBe("dp-p-2"); // most urgent first
    expect(o0.deferred).toBe(1);
    expect(o0.notificationsToWrite).toHaveLength(1);
    const s1 = { ...i0, ...persist(i0, o0), now: T0 + 30_000 };
    const o1 = tick(s1);
    expect(allRequests(o1).map((r) => r.incidentId)).toEqual(["dp-p-1"]);
  });

  it("user notification rules: priority filter and delayed rule fire later", () => {
    const direct: EscalationPolicy = { schemaVersion: 1, id: "pol-noc", name: "Direct", rev: 1, repeat: 0, steps: [{ delayMinutes: 0, targets: [{ type: "user", uid: "user-0001" }] }] };
    const i0 = input({ policies: [direct], alerts: [alert({ sourceId: "P-1", fields: { "cc.priority": "P1" } }), alert({ sourceId: "P-9", fields: { "cc.priority": "P3" } })] });
    const o0 = tick(i0);
    expect(allRequests(o0).map((r) => `${r.incidentId}:${r.channel}`).sort()).toEqual(["dp-p-1:sms", "dp-p-9:sms"]);
    const s1 = delivered({ ...i0, ...persist(i0, o0), alerts: [] });
    const o1 = tick({ ...s1, now: T0 + 5 * MIN });
    // voice rule is "≤ P2 after 5 min": only the P1 incident
    expect(allRequests(o1).map((r) => `${r.incidentId}:${r.channel}`)).toEqual(["dp-p-1:voice"]);
    expect(allRequests(o1)[0]!.speech).toContain("priority 1");
  });

  it("step channels are forced over user rules", () => {
    const forced: EscalationPolicy = { schemaVersion: 1, id: "pol-noc", name: "F", rev: 1, repeat: 0, steps: [{ delayMinutes: 0, channels: ["voice"], targets: [{ type: "user", uid: "user-0001" }] }] };
    const o = tick(input({ policies: [forced], alerts: [alert({ sourceId: "P-1" })] }));
    expect(allRequests(o).map((r) => r.channel)).toEqual(["voice"]);
  });

  it("maintenance suppresses paging; lifting it resumes with delays counted from then", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1", underMaintenance: true })] });
    const o0 = tick(i0);
    expect(allRequests(o0)).toHaveLength(0);
    expect(o0.incidentsToWrite[0]!.suppressed).toBe("maintenance");
    const s1 = { ...i0, ...persist(i0, o0) };
    const o1 = tick({ ...s1, now: T0 + 30 * MIN, alerts: [alert({ sourceId: "P-1" })] });
    const inc = o1.incidentsToWrite[0]!;
    expect(inc.suppressed).toBeUndefined();
    expect(inc.escalation.startedAt).toBe(T0 + 30 * MIN);
    expect(allRequests(o1).map((r) => r.step)).toEqual([0]);
  });

  it("quiet hours: hold for less urgent incidents, low-urgency filters channels", () => {
    const qTeams = (mode: "hold" | "low-urgency"): Team[] => [{ ...teams[0]!, quietHours: [{ timeZone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "24:00", minPriority: "P2", mode }] }];
    const direct: EscalationPolicy = { schemaVersion: 1, id: "pol-noc", name: "Direct", rev: 1, repeat: 0, steps: [{ delayMinutes: 0, targets: [{ type: "user", uid: "user-0001" }, { type: "user", uid: "user-0002" }] }] };
    const alerts = [alert({ sourceId: "P-lo", fields: { "cc.priority": "P3" } }), alert({ sourceId: "P-hi", fields: { "cc.priority": "P2" } })];
    const hold = tick(input({ teams: qTeams("hold"), policies: [direct], alerts }));
    expect(new Set(allRequests(hold).map((r) => r.incidentId))).toEqual(new Set(["dp-p-hi"]));
    expect(hold.incidentsToWrite.find((i) => i.id === "dp-p-lo")!.suppressed).toBe("quiet-hours");
    const low = tick(input({ teams: qTeams("low-urgency"), policies: [direct], alerts }));
    expect(allRequests(low).filter((r) => r.incidentId === "dp-p-lo").map((r) => r.channel)).toEqual(["slack"]);
  });

  it("routing rule suppression never pages", () => {
    const o = tick(input({ rules: { schemaVersion: 1, rev: 1, rules: [{ id: "mute", name: "m", enabled: true, match: "all", conditions: [], then: { suppress: true } }] }, alerts: [alert({ sourceId: "P-1" })] }));
    expect(allRequests(o)).toHaveLength(0);
    expect(o.incidentsToWrite[0]!.suppressed).toBe("rule");
  });

  it("dedups problem-owned Davis events into one incident", () => {
    const p = alert({ sourceId: "P-1", fields: { "dt.davis.event_ids": "ev-1" } });
    const e = alert({ source: "davis-event", sourceId: "ev-1", fields: { "event.id": "ev-1", "cc.service": "checkout" } });
    const o = tick(input({ alerts: [p, e] }));
    expect(o.incidentsToWrite.map((i) => i.id)).toEqual(["dp-p-1"]);
    expect(o.incidentsToWrite[0]!.serviceId).toBe("checkout");
  });

  it("archives incidents resolved longer than resolvedVisibleHours (not if source still ACTIVE)", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" }), alert({ sourceId: "P-2" })] });
    let st = { ...i0, ...persist(i0, tick(i0)) };
    const r1 = act({ incidentId: "dp-p-1", at: T0 + MIN, type: "resolve" });
    const r2 = act({ incidentId: "dp-p-2", at: T0 + MIN, type: "resolve" });
    const o1 = tick({ ...st, now: T0 + 2 * MIN, pendingActions: [r1, r2], alerts: [] });
    st = { ...st, ...persist({ ...st, pendingActions: [r1, r2] }, o1) };
    const o2 = tick({ ...st, now: T0 + 25 * H, alerts: [alert({ sourceId: "P-2" })] });
    expect(o2.archives.map((a) => [a.day, a.incident.id])).toEqual([["20261102", "dp-p-1"]]);
    expect(o2.incidentIdsToDelete).toEqual(["dp-p-1"]);
    expect(o2.incidentsToWrite.find((i) => i.id === "dp-p-1")).toBeUndefined();
  });

  it("closed alerts with no incident are only created when recently closed", () => {
    const old = alert({ sourceId: "P-old", sourceStatus: "CLOSED", endedAt: T0 - 48 * H });
    const recent = alert({ sourceId: "P-new", sourceStatus: "CLOSED", endedAt: T0 - H });
    const o = tick(input({ alerts: [old, recent] }));
    expect(o.incidentsToWrite.map((i) => [i.id, i.status])).toEqual([["dp-p-new", "resolved"]]);
    expect(allRequests(o)).toHaveLength(0);
  });

  it("missing contact / provider → notification_skipped once, error listed", () => {
    const s = settings();
    s.providers = s.providers.map((p) => (p.channel === "slack" ? { ...p, enabled: false } : p));
    const i0 = input({ settings: s, alerts: [alert({ sourceId: "P-1" })] });
    const o0 = tick(i0);
    expect(o0.errors.join(" ")).toContain("No enabled provider for slack");
    expect(o0.incidentsToWrite[0]!.timeline.filter((e) => e.type === "notification_skipped")).toHaveLength(1);
    const o1 = tick({ ...i0, ...persist(i0, o0), now: T0 + MIN });
    expect(o1.incidentsToWrite).toHaveLength(0);
  });

  it("escalate-now action restarts at step 0 with a new cycle", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const st = { ...i0, ...persist(i0, tick(i0)) };
    const esc = act({ incidentId: "dp-p-1", at: T0 + 3 * MIN, type: "escalate" });
    const o = tick({ ...st, now: T0 + 3 * MIN, pendingActions: [esc] });
    expect(allRequests(o).map((r) => [r.cycle, r.step])).toEqual([[2, 0]]);
  });
});

describe("delivery report", () => {
  it("marks sent, writes timeline, is idempotent, never downgrades sent", () => {
    const i0 = input({ alerts: [alert({ sourceId: "P-1" })] });
    const o0 = tick(i0);
    const st = persist(i0, o0);
    const key = st.ledger[0]!.key;
    const res = { key, status: "sent" as const, providerRef: "SM-1", at: T0 + 10_000 };
    const d1 = applyDeliveryResults({ now: T0 + 10_000, results: [res, { key: "nope", status: "sent", at: T0 }], ledger: st.ledger, incidents: st.incidents });
    expect(d1.notificationsToWrite[0]).toMatchObject({ status: "sent", providerRef: "SM-1", reportedAt: T0 + 10_000 });
    expect(d1.unknownKeys).toEqual(["nope"]);
    expect(d1.incidentsToWrite[0]!.timeline.at(-1)).toMatchObject({ type: "notification_sent" });
    expect(d1.rollupDelta.notificationsSent).toBe(1);
    const d2 = applyDeliveryResults({ now: T0 + 20_000, results: [res], ledger: d1.notificationsToWrite, incidents: d1.incidentsToWrite });
    expect(d2.notificationsToWrite).toHaveLength(0);
    const d3 = applyDeliveryResults({ now: T0 + 20_000, results: [{ key, status: "failed", at: T0 + 20_000 }], ledger: d1.notificationsToWrite, incidents: d1.incidentsToWrite });
    expect(d3.notificationsToWrite).toHaveLength(0);
    // sent record is not retried by the next tick
    const st2 = { ...i0, ...st, ledger: d1.notificationsToWrite, now: T0 + 10 * 60_000 };
    expect(allRequests(tick(st2)).filter((r) => r.attempt > 1)).toHaveLength(0);
  });
});
