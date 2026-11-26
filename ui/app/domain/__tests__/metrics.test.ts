import { describe, expect, it } from "vitest";
import { applyRollupDelta, emptyDelta, formatDuration, incidentTimings, openIncidentKpis, rollupsFromIncidents, summarizeRollups } from "../reports/metrics";
import type { Incident } from "../contracts";
import { T0 } from "./test-utils";

const inc = (p: Partial<Incident>): Incident => ({ id: "i", status: "triggered", priority: "P3", createdAt: T0, tags: [], timeline: [], alert: { source: "davis-problem" }, escalation: {}, ...p }) as Incident;

describe("metrics", () => {
  it("rollup delta accumulates", () => {
    const d = emptyDelta("2026-11-02");
    d.created = 2; d.byPriority.P1 = 1; d.byTeam["noc"] = 2; d.ttaSumMs = 1000; d.ttaCount = 1;
    const r1 = applyRollupDelta(undefined, d);
    const r2 = applyRollupDelta(r1, d);
    expect(r2).toMatchObject({ day: "2026-11-02", created: 4, byPriority: { P1: 2 }, byTeam: { noc: 4 }, ttaSumMs: 2000, ttaCount: 2 });
    const s = summarizeRollups([r2, { ...r1, day: "2026-11-01", notificationsSent: 9, notificationsFailed: 1 }], "2026-11-01", "2026-11-02");
    expect(s.created).toBe(6);
    expect(s.mttaMs).toBe(1000);
    expect(s.deliverySuccessRate).toBe(0.9);
    expect(s.daily.map((x) => x.day)).toEqual(["2026-11-01", "2026-11-02"]);
  });
  it("timings, kpis, rebuild from incidents", () => {
    const list = [
      inc({ id: "a", status: "resolved", acknowledgedAt: T0 + 60_000, resolvedAt: T0 + 600_000, priority: "P1" }),
      inc({ id: "b", status: "acknowledged", acknowledgedAt: T0 + 180_000 }),
      inc({ id: "c" }),
    ];
    expect(incidentTimings(list)).toMatchObject({ mttaMs: 120_000, mttrMs: 600_000, acked: 2, resolved: 1 });
    expect(openIncidentKpis(list)).toMatchObject({ open: 2, triggered: 1, acknowledged: 1, byPriority: { P3: 2 } });
    const r = rollupsFromIncidents(list, T0 - 1, T0 + 86_400_000);
    expect(r[0]).toMatchObject({ created: 3, resolved: 1, ttaCount: 2 });
    expect(formatDuration(65 * 60_000)).toBe("1h 05m");
    expect(formatDuration(undefined)).toBe("—");
  });
});
