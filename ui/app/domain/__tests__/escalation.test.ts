import { describe, expect, it } from "vitest";
import type { EscalationPolicy, Incident } from "../contracts";
import { advanceEscalation, allFirings, DEFAULT_REPEAT_GAP_MINUTES, passLengthMs, simulatePolicy } from "../escalation/machine";
import { expandTargets } from "../escalation/targets";
import { MIN, schedules, T0, teams } from "./test-utils";

const pol = (steps: number[], repeat = 0): EscalationPolicy => ({
  schemaVersion: 1, id: "p", name: "P", rev: 1, repeat,
  steps: steps.map((d) => ({ delayMinutes: d, targets: [{ type: "user", uid: "u" }] })),
});
const inc = (esc: Partial<Incident["escalation"]> = {}): Incident =>
  ({ id: "i", escalation: { cycle: 1, startedAt: T0, lastStepIndex: -1, repeatsDone: 0, exhausted: false, ...esc } }) as Incident;

describe("escalation machine", () => {
  it("cumulative delays", () => {
    expect(simulatePolicy(pol([0, 5, 10])).map((f) => f.atMinute)).toEqual([0, 5, 15]);
  });
  it("repeat cycles use the last step's delay as gap; ordinals are unique", () => {
    const p = pol([0, 10], 2);
    expect(passLengthMs(p)).toBe(20 * MIN);
    const f = simulatePolicy(p);
    expect(f.map((x) => x.atMinute)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(f.map((x) => x.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(f.map((x) => x.pass)).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it("zero-delay single step still has a positive pass length", () => {
    const p = pol([0], 3);
    expect(passLengthMs(p)).toBe(DEFAULT_REPEAT_GAP_MINUTES * MIN);
    expect(new Set(allFirings(p, 0).map((f) => f.dueAt)).size).toBe(4);
  });
  it("advance: newly due, progress, exhaustion", () => {
    const p = pol([0, 10], 1); // fires at 0,10,20,30; exhausted at 40
    let a = advanceEscalation(inc(), p, T0);
    expect(a.newlyDue.map((f) => f.ordinal)).toEqual([0]);
    expect(a.progress).toMatchObject({ lastStepIndex: 0, repeatsDone: 0 });
    expect(a.nextDueAt).toBe(T0 + 10 * MIN);
    a = advanceEscalation(inc(a.progress), p, T0 + 9 * MIN);
    expect(a.newlyDue).toEqual([]);
    a = advanceEscalation(inc(a.progress), p, T0 + 25 * MIN);
    expect(a.newlyDue.map((f) => f.ordinal)).toEqual([1, 2]);
    expect(a.progress).toMatchObject({ lastStepIndex: 0, repeatsDone: 1 });
    expect(a.due).toHaveLength(3);
    a = advanceEscalation(inc(a.progress), p, T0 + 39 * MIN);
    expect(a.newlyDue.map((f) => f.ordinal)).toEqual([3]);
    expect(a.becameExhausted).toBe(false);
    a = advanceEscalation(inc(a.progress), p, T0 + 40 * MIN);
    expect(a.becameExhausted).toBe(true);
    expect(a.progress.exhausted).toBe(true);
    expect(advanceEscalation(inc(a.progress), p, T0 + 60 * MIN).becameExhausted).toBe(false);
  });
  it("targets: schedule on-call at instant, user, team minus observers, deduped", () => {
    const at = Date.UTC(2026, 10, 2, 12); // second day of the rotation → user-0002
    const out = expandTargets(
      [{ type: "schedule", scheduleId: "sched-noc" }, { type: "team", teamId: "noc" }, { type: "user", uid: "user-0009" }, { type: "schedule", scheduleId: "missing" }],
      { schedules, teams }, at,
    );
    expect(out.map((x) => x.uid)).toEqual(["user-0002", "user-0001", "user-0009"]);
  });
});
