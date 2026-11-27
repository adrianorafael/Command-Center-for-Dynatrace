import { describe, expect, it } from "vitest";
import type { Incident, IncidentStatus } from "../../domain/contracts";
import {
  applyFilters,
  createdBound,
  DEFAULT_STATUS,
  isDefaultFilter,
  readFilters,
  statusViewCounts,
  statusViewOf,
  STATUS_VIEWS,
  writeFilters,
} from "../console/filters";

describe("console status tabs", () => {
  it("maps each tab's status list back to its tab, in any order", () => {
    for (const v of STATUS_VIEWS) expect(statusViewOf(v.status)).toBe(v.id);
    expect(statusViewOf(["acknowledged", "triggered"])).toBe("open");
    // Every status listed is the same as no status filter.
    expect(statusViewOf(["triggered", "acknowledged", "snoozed", "resolved"])).toBe("all");
    // A list no tab covers (old bookmark) selects no tab.
    expect(statusViewOf(["triggered", "resolved"])).toBeUndefined();
  });

  it("round-trips through the URL: default is Open, 'All' is an empty status list", () => {
    expect(readFilters(new URLSearchParams("")).status).toEqual(DEFAULT_STATUS);
    const all = writeFilters(new URLSearchParams(""), { ...readFilters(new URLSearchParams("")), status: [] });
    expect(all.get("status")).toBe("");
    expect(statusViewOf(readFilters(all).status)).toBe("all");
  });
});

// Fri 27 Nov 2026 00:30 in Berlin (CET, UTC+1) is still Thu 26 Nov 23:30 UTC: local and UTC days differ.
const NOW = Date.UTC(2026, 10, 26, 23, 30);
const BERLIN = "Europe/Berlin";
const BERLIN_MIDNIGHT = Date.UTC(2026, 10, 26, 23, 0); // 27 Nov 00:00 CET
const HOUR = 3_600_000;

let seq = 0;
function inc(status: IncidentStatus, createdAt: number, ack?: string): Incident {
  seq++;
  return {
    id: `inc-${seq}`,
    status,
    priority: "P3",
    createdAt,
    tags: [],
    timeline: [],
    alert: { source: "generic-event", title: `Incident ${seq}`, entities: [] },
    escalation: { lastStepIndex: -1, exhausted: false, cycle: 0 },
    ...(ack ? { acknowledgedBy: ack, acknowledgedAt: createdAt + 60_000 } : {}),
  } as unknown as Incident;
}

describe("console 'Acknowledged by' filter", () => {
  const me = "user-0001";
  const list = [
    inc("acknowledged", NOW, me),
    inc("acknowledged", NOW, "user-0002"),
    inc("resolved", NOW, "user-0002"),
    inc("triggered", NOW),
  ];
  const base = { ...readFilters(new URLSearchParams("")), status: [] as IncidentStatus[] };

  it("is read from and written to the `ackby` URL key, and is not a default view", () => {
    const f = readFilters(new URLSearchParams("ackby=me,user-0002"));
    expect(f.ackby).toEqual(["me", "user-0002"]);
    expect(isDefaultFilter(f)).toBe(false);
    expect(writeFilters(new URLSearchParams(""), f).get("ackby")).toBe("me,user-0002");
    expect(writeFilters(new URLSearchParams("ackby=me"), { ...f, ackby: [] }).has("ackby")).toBe(false);
    expect(readFilters(new URLSearchParams("")).ackby).toEqual([]);
  });

  it("matches 'me' against the current user and uids against acknowledgedBy, never unacknowledged incidents", () => {
    expect(applyFilters(list, { ...base, ackby: ["me"] }, me).map((i) => i.acknowledgedBy)).toEqual([me]);
    // Resolved incidents keep their acknowledger.
    expect(applyFilters(list, { ...base, ackby: ["user-0002"] }, me)).toHaveLength(2);
    expect(applyFilters(list, { ...base, ackby: ["me", "user-0002"] }, me)).toHaveLength(3);
    expect(applyFilters(list, base, me)).toHaveLength(4);
  });
});

describe("console 'today' bound of Resolved and All", () => {
  it("bounds lists that can show resolved incidents to the start of today in the display zone", () => {
    expect(createdBound([], undefined, NOW, BERLIN)).toEqual({ createdAfter: BERLIN_MIDNIGHT, today: true });
    expect(createdBound(["resolved"], undefined, NOW, BERLIN)).toEqual({ createdAfter: BERLIN_MIDNIGHT, today: true });
    // An old bookmark that includes resolved is bounded too.
    expect(createdBound(["triggered", "resolved"], undefined, NOW, BERLIN).today).toBe(true);
    // In UTC the same instant is still 26 Nov.
    expect(createdBound([], undefined, NOW, "UTC").createdAfter).toBe(Date.UTC(2026, 10, 26));
  });

  it("leaves open views unbounded", () => {
    for (const s of [DEFAULT_STATUS, ["triggered"], ["acknowledged"], ["snoozed"]] as IncidentStatus[][])
      expect(createdBound(s, undefined, NOW, BERLIN)).toEqual({ today: false });
  });

  it("lets a picked Created timeframe win for every view", () => {
    const from = NOW - 7 * 24 * HOUR;
    for (const v of STATUS_VIEWS) expect(createdBound(v.status, from, NOW, BERLIN)).toEqual({ createdAfter: from, today: false });
  });

  it("counts each tab exactly as the table would show it", () => {
    const list = [
      inc("triggered", NOW - 3 * 24 * HOUR), // old open: in Open, not in All today
      inc("acknowledged", NOW - HOUR), // 26 Nov 23:30 CET: yesterday in Berlin
      inc("resolved", NOW - 2 * 24 * HOUR), // old resolved: hidden by today
      inc("resolved", BERLIN_MIDNIGHT + 60_000), // resolved today
      inc("snoozed", NOW),
    ];
    const f = readFilters(new URLSearchParams(""));
    for (const pickedFrom of [undefined, NOW - 7 * 24 * HOUR]) {
      const counts = statusViewCounts(list, f, "user-0001", pickedFrom, NOW, BERLIN);
      for (const v of STATUS_VIEWS) {
        const { createdAfter } = createdBound(v.status, pickedFrom, NOW, BERLIN);
        expect(counts[v.id]).toBe(applyFilters(list, { ...f, status: v.status }, "user-0001", createdAfter).length);
      }
    }
    const today = statusViewCounts(list, f, "user-0001", undefined, NOW, BERLIN);
    expect(today).toEqual({ open: 2, triggered: 1, acknowledged: 1, snoozed: 1, resolved: 1, all: 2 });
  });
});
