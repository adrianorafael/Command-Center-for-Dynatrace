import { describe, expect, it } from "vitest";
import type { Incident } from "../contracts";
import { TIMELINE_CAP } from "../contracts";
import { applyAction, applyAlertUpdate, createIncident, effectiveIncident, foldActions, pushTimeline, unsnoozeIfDue } from "../incidents/actions";
import { routeAlert } from "../routing/match";
import { act, alert, MIN, services, settings, T0, teams } from "./test-utils";

function newInc(): Incident {
  const a = alert({ sourceId: "P-00001", displayId: "P-00001" });
  return createIncident(a, routeAlert(a, { rules: [], services, teams, settings: settings() }), T0);
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

const strip = (i: Incident) => ({ status: i.status, ack: i.acknowledgedBy, res: i.resolvedBy, snooze: i.snoozedUntil, cycle: i.escalation.cycle });

describe("createIncident", () => {
  it("creates triggered incident with created+routed timeline", () => {
    const inc = newInc();
    expect(inc.id).toBe("dp-p-00001");
    expect(inc.status).toBe("triggered");
    expect(inc.escalation).toEqual({ cycle: 1, startedAt: T0, lastStepIndex: -1, repeatsDone: 0, exhausted: false });
    expect(inc.timeline.map((e) => e.type)).toEqual(["created", "routed"]);
    expect(inc.assignee).toEqual({ type: "team", id: "noc" });
  });
});

describe("applyAction", () => {
  it("ack → unack restarts escalation with a new cycle", () => {
    let inc = newInc();
    inc = applyAction(inc, { schemaVersion: 1, incidentId: inc.id, at: T0 + MIN, clientId: "c", type: "ack" }, "user-0001", T0 + MIN);
    expect(inc).toMatchObject({ status: "acknowledged", acknowledgedBy: "user-0001", acknowledgedAt: T0 + MIN });
    inc = applyAction(inc, { schemaVersion: 1, incidentId: inc.id, at: T0 + 2 * MIN, clientId: "c", type: "unack" }, "user-0001", T0 + 3 * MIN);
    expect(inc.status).toBe("triggered");
    expect(inc.acknowledgedAt).toBeUndefined();
    expect(inc.escalation).toMatchObject({ cycle: 2, startedAt: T0 + 3 * MIN, lastStepIndex: -1 });
  });
  it("does not mutate input; non-applicable actions return the same object", () => {
    const inc = newInc();
    const before = JSON.stringify(inc);
    const r = applyAction(inc, { schemaVersion: 1, incidentId: inc.id, at: T0, clientId: "c", type: "reopen" }, "u", T0);
    expect(r).toBe(inc);
    applyAction(inc, { schemaVersion: 1, incidentId: inc.id, at: T0, clientId: "c", type: "resolve" }, "u", T0);
    expect(JSON.stringify(inc)).toBe(before);
  });
  it("reassign, priority, note, tag", () => {
    let inc = newInc();
    const base = { schemaVersion: 1 as const, incidentId: inc.id, clientId: "c" };
    inc = applyAction(inc, { ...base, at: T0 + 1, type: "reassign", assignee: { type: "user", id: "user-0002" } }, "u", T0);
    inc = applyAction(inc, { ...base, at: T0 + 2, type: "priority", priority: "P1" }, "u", T0);
    inc = applyAction(inc, { ...base, at: T0 + 3, type: "note", text: "  looking  " }, "u", T0);
    inc = applyAction(inc, { ...base, at: T0 + 4, type: "tag", add: ["db"], remove: [] }, "u", T0);
    expect(inc.assignee).toEqual({ type: "user", id: "user-0002" });
    expect(inc.priority).toBe("P1");
    expect(inc.tags).toContain("db");
    expect(inc.timeline.slice(-4).map((e) => e.type)).toEqual(["reassigned", "priority", "note", "tag"]);
    expect(inc.timeline.find((e) => e.type === "note")?.detail).toBe("looking");
  });
  it("snooze then expiry re-triggers with a new cycle", () => {
    let inc = newInc();
    inc = applyAction(inc, { schemaVersion: 1, incidentId: inc.id, at: T0 + MIN, clientId: "c", type: "snooze", until: T0 + 30 * MIN }, "u", T0 + MIN);
    expect(inc.status).toBe("snoozed");
    expect(unsnoozeIfDue(inc, T0 + 29 * MIN)).toBe(inc);
    const u = unsnoozeIfDue(inc, T0 + 30 * MIN);
    expect(u.status).toBe("triggered");
    expect(u.escalation.cycle).toBe(2);
  });
  it("escalate keeps the cycle, clears ack and flags 'next step now' for the engine", () => {
    let inc = newInc();
    const base = { schemaVersion: 1 as const, incidentId: inc.id, clientId: "c" };
    inc = applyAction(inc, { ...base, at: T0 + 1, type: "ack" }, "u", T0 + 1);
    inc = applyAction(inc, { ...base, at: T0 + 2, type: "escalate" }, "u", T0 + 5);
    expect(inc).toMatchObject({ status: "triggered", escalation: { cycle: 1, startedAt: T0 }, escalateRequestedAt: T0 + 5 });
    expect(inc.acknowledgedAt).toBeUndefined();
  });
  it("timeline is capped and keeps 'created'", () => {
    const inc = newInc();
    for (let i = 0; i < TIMELINE_CAP + 50; i++) pushTimeline(inc, { at: T0 + i, type: "note", by: "u" });
    expect(inc.timeline).toHaveLength(TIMELINE_CAP);
    expect(inc.timeline[0]!.type).toBe("created");
    expect(inc.timeline[inc.timeline.length - 1]!.at).toBe(T0 + TIMELINE_CAP + 49);
  });
});

describe("folding: idempotent and order-tolerant", () => {
  it("same stored action folded twice applies once", () => {
    const inc = newInc();
    const a = act({ incidentId: inc.id, at: T0 + MIN, type: "note", text: "hi" });
    const once = foldActions(inc, [a], T0 + MIN).incident;
    const twice = foldActions(once, [a], T0 + 2 * MIN);
    expect(twice.applied).toBe(0);
    expect(twice.incident.timeline.filter((e) => e.type === "note")).toHaveLength(1);
  });
  it("ack / snooze / resolve / reopen in any list order give the same result", () => {
    const inc = newInc();
    const acts = [
      act({ incidentId: inc.id, at: T0 + 1 * MIN, type: "ack" }, "user-0001"),
      act({ incidentId: inc.id, at: T0 + 2 * MIN, type: "snooze", until: T0 + 60 * MIN }, "user-0002"),
      act({ incidentId: inc.id, at: T0 + 3 * MIN, type: "resolve" }, "user-0001"),
      act({ incidentId: inc.id, at: T0 + 4 * MIN, type: "reopen" }, "user-0002"),
    ];
    const results = permutations(acts).map((p) => strip(foldActions(inc, p, T0 + 5 * MIN).incident));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toMatchObject({ status: "triggered", cycle: 2 });
  });
  it("cross-tick arrival: a late, older ack does not override a newer resolve/reopen", () => {
    const inc = newInc();
    const ack = act({ incidentId: inc.id, at: T0 + 1 * MIN, type: "ack" });
    const resolve = act({ incidentId: inc.id, at: T0 + 2 * MIN, type: "resolve" });
    const reopen = act({ incidentId: inc.id, at: T0 + 3 * MIN, type: "reopen" });
    const oneTick = foldActions(inc, [ack, resolve, reopen], T0 + 4 * MIN).incident;
    const t1 = foldActions(inc, [resolve, reopen], T0 + 4 * MIN).incident;
    const t2 = foldActions(t1, [ack], T0 + 5 * MIN).incident;
    expect(t2.status).toBe(oneTick.status);
    expect(t2.status).toBe("triggered");
    const r = foldActions(t1, [ack], T0 + 5 * MIN);
    expect(r.applied).toBe(0);
    expect(r.foldedKeys).toEqual([ack.key]);
  });
  it("actor comes from lastModifiedBy", () => {
    const inc = newInc();
    const a = act({ incidentId: inc.id, at: T0 + MIN, type: "ack", by: "spoofed" }, "user-0002");
    expect(foldActions(inc, [a], T0 + MIN).incident.acknowledgedBy).toBe("user-0002");
  });
  it("effectiveIncident matches the engine fold and ignores other incidents", () => {
    const inc = newInc();
    const acts = [act({ incidentId: inc.id, at: T0 + MIN, type: "ack" }), act({ incidentId: "other", at: T0, type: "resolve" })];
    const eff = effectiveIncident(inc, acts, T0 + MIN);
    expect(eff.status).toBe("acknowledged");
    expect(eff).toEqual(foldActions(inc, acts, T0 + MIN).incident);
    expect(effectiveIncident(inc, [])).toBe(inc);
  });
});

describe("source updates", () => {
  it("ACTIVE→CLOSED resolves by source; re-activation re-triggers", () => {
    const inc = newInc();
    const closed = applyAlertUpdate(inc, { ...inc.alert, sourceStatus: "CLOSED", endedAt: T0 + MIN }, T0 + 2 * MIN);
    expect(closed.change).toBe("resolved");
    expect(closed.incident).toMatchObject({ status: "resolved", resolvedBy: "source", resolvedAt: T0 + MIN });
    const again = applyAlertUpdate(closed.incident, { ...inc.alert, sourceStatus: "ACTIVE" }, T0 + 3 * MIN);
    expect(again.change).toBe("reopened");
    expect(again.incident.escalation.cycle).toBe(2);
  });
  it("operator-resolved stays resolved while source ACTIVE, until a newer reopen timestamp", () => {
    let inc = newInc();
    inc = applyAction(inc, { schemaVersion: 1, incidentId: inc.id, at: T0 + MIN, clientId: "c", type: "resolve" }, "u", T0 + MIN);
    expect(applyAlertUpdate(inc, { ...inc.alert }, T0 + 2 * MIN).change).toBeUndefined();
    const r = applyAlertUpdate(inc, { ...inc.alert, reopenedAt: T0 + 3 * MIN }, T0 + 4 * MIN);
    expect(r.change).toBe("reopened");
  });
  it("operator re-opening a source-closed incident is respected", () => {
    const inc = newInc();
    const closed = applyAlertUpdate(inc, { ...inc.alert, sourceStatus: "CLOSED" }, T0 + MIN).incident;
    const reopened = applyAction(closed, { schemaVersion: 1, incidentId: inc.id, at: T0 + 2 * MIN, clientId: "c", type: "reopen" }, "u", T0 + 2 * MIN);
    const r = applyAlertUpdate(reopened, { ...inc.alert, sourceStatus: "CLOSED" }, T0 + 3 * MIN);
    expect(r.change).toBeUndefined();
    expect(r.incident.status).toBe("triggered");
  });
});
