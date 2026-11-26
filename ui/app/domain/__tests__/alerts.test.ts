import { describe, expect, it } from "vitest";
import { asTimestamp, normalizeDavisEvent, normalizeGenericEvents, normalizeProblem, normalizeRecords } from "../alerts/normalize";
import { dedupAlerts } from "../alerts/dedup";

const NOW = Date.UTC(2026, 10, 26, 22);

// Shapes taken from the live-tenant samples supplied by the lead (ids synthetic).
const liveEvent = {
  timestamp: "2026-11-26T21:39:08.386000000Z",
  "event.id": "4869410437100314995_1795729143750",
  "event.kind": "DAVIS_EVENT",
  "event.type": "CUSTOM_ALERT",
  "event.name": "Checkout latency",
  "event.status": "ACTIVE",
  "event.category": "CUSTOM_ALERT",
  "event.provider": "EVENTS_REST_API_INGEST",
  "cc.service": "checkout",
};
const liveProblem = {
  timestamp: "2026-11-26T21:39:17.312271511Z",
  "event.kind": "DAVIS_PROBLEM",
  "event.name": "Checkout latency",
  "dt.davis.is_duplicate": false,
  "dt.davis.is_frequent_event": false,
  "event.start": "2026-11-26T21:39:03.750000000Z",
  display_id: "P-00001",
  "event.id": "P-00001",
  "event.category": "CUSTOM_ALERT",
  "dt.davis.event_ids": ["4869410437100314995_1795729143750"],
  "dt.davis.impact_level": ["Environment"],
  "event.description": "# markdown",
  "event.status_transition": "CREATED",
  "event.status": "ACTIVE",
  "dt.davis.mute.status": "NOT_MUTED",
  "dt.analysis.ready": true,
  "maintenance.is_under_maintenance": false,
};

describe("timestamps", () => {
  it("handles ISO with ns fraction, ms, s, ns numbers", () => {
    expect(asTimestamp("2026-11-26T21:39:03.750000000Z")).toBe(Date.UTC(2026, 10, 26, 21, 39, 3, 750));
    expect(asTimestamp(1795729143750)).toBe(1795729143750);
    expect(asTimestamp(1795729143)).toBe(1795729143000);
    expect(asTimestamp(1795729143750123456)).toBe(1795729143750);
    expect(asTimestamp("1795729143750")).toBe(1795729143750);
    expect(asTimestamp("nope")).toBeUndefined();
    expect(asTimestamp(null)).toBeUndefined();
  });
});

describe("normalize", () => {
  it("maps a live-shaped problem", () => {
    const a = normalizeProblem(liveProblem, NOW)!;
    expect(a).toMatchObject({
      source: "davis-problem", sourceId: "P-00001", dedupKey: "davis-problem.p-00001", displayId: "P-00001",
      title: "Checkout latency", category: "CUSTOM_ALERT", sourceStatus: "ACTIVE", underMaintenance: false, muted: false,
      entities: [], tags: [],
    });
    expect(a.severity).toBeUndefined();
    expect(a.startedAt).toBe(Date.UTC(2026, 10, 26, 21, 39, 3, 750));
    expect(a.fields["dt.davis.event_ids"]).toBe("4869410437100314995_1795729143750");
    expect(a.fields["event.description"]).toBeUndefined();
  });
  it("skips duplicates; CLOSED + end", () => {
    expect(normalizeProblem({ ...liveProblem, "dt.davis.is_duplicate": true }, NOW)).toBeUndefined();
    const c = normalizeProblem({ ...liveProblem, "event.status": "CLOSED", "event.end": "2026-11-26T21:50:00Z" }, NOW)!;
    expect(c.sourceStatus).toBe("CLOSED");
    expect(c.endedAt).toBe(Date.UTC(2026, 10, 26, 21, 50));
  });
  it("reads smartscape and deprecated entity fields", () => {
    const a = normalizeProblem({
      ...liveProblem,
      "smartscape.affected_entities": [{ id: "HOST-DEMO000000000001", type: "HOST", name: "host-a" }],
      affected_entity_ids: ["HOST-DEMO000000000001", "SERVICE-DEMO00000000001"],
      affected_entity_names: ["host-a", "checkout-svc"],
      "root_cause.smartscape_entity": { id: "HOST-DEMO000000000001", name: "host-a" },
      entity_tags: ["env:prod"],
      "primary_tags.team": "payments",
      "event.severity": "2",
      "dt.davis.last_reopen_timestamp": "2026-11-26T21:45:00Z",
      "maintenance.is_under_maintenance": "true",
      "dt.davis.mute.status": "MUTED",
      "event.category": "RESOURCE",
    }, NOW)!;
    expect(a.entities).toEqual([
      { id: "HOST-DEMO000000000001", type: "HOST", name: "host-a" },
      { id: "SERVICE-DEMO00000000001", name: "checkout-svc" },
    ]);
    expect(a.rootCause).toEqual({ id: "HOST-DEMO000000000001", name: "host-a" });
    expect(a.tags).toEqual(["env:prod", "team:payments"]);
    expect(a.severity).toBe(2);
    expect(a.reopenedAt).toBe(Date.UTC(2026, 10, 26, 21, 45));
    expect(a.underMaintenance).toBe(true);
    expect(a.muted).toBe(true);
    expect(a.category).toBe("RESOURCE_CONTENTION");
    const legacy = normalizeProblem({ ...liveProblem, affected_entity_ids: "HOST-DEMO000000000002", root_cause_entity_name: "db-1", "event.category": "WEIRD" }, NOW)!;
    expect(legacy.entities).toEqual([{ id: "HOST-DEMO000000000002" }]);
    expect(legacy.rootCause).toEqual({ name: "db-1" });
    expect(legacy.category).toBe("OTHER");
  });
  it("maps a live-shaped Davis event with cc.* properties", () => {
    const a = normalizeDavisEvent(liveEvent, NOW)!;
    expect(a.source).toBe("davis-event");
    expect(a.sourceId).toBe("4869410437100314995_1795729143750");
    expect(a.fields["cc.service"]).toBe("checkout");
    const keyed = normalizeDavisEvent({ ...liveEvent, "cc.dedup_key": "Checkout/Latency" }, NOW)!;
    expect(keyed.dedupKey).toBe("davis-event.checkout-latency");
    expect(keyed.fields["event.id"]).toBe("4869410437100314995_1795729143750");
    expect(normalizeDavisEvent({ ...liveEvent, "cc.action": "resolve" }, NOW)!.sourceStatus).toBe("CLOSED");
  });
  it("folds raw generic events per dedup key", () => {
    const recs = [
      { timestamp: "2026-11-26T20:00:00Z", "event.type": "command_center.alert", "cc.dedup_key": "db-lag", "cc.action": "trigger", "event.name": "DB lag", "cc.priority": "P2", "cc.tags": "db,replica" },
      { timestamp: "2026-11-26T20:30:00Z", "event.type": "command_center.alert", "cc.dedup_key": "db-lag", "cc.action": "resolve" },
      { timestamp: "2026-11-26T21:00:00Z", "event.type": "command_center.alert", "cc.dedup_key": "db-lag", "cc.action": "trigger", "event.name": "DB lag again" },
      { timestamp: "2026-11-26T21:00:00Z", "event.type": "command_center.alert", "cc.dedup_key": "disk", "cc.action": "resolve", "event.name": "Disk" },
    ];
    const out = normalizeGenericEvents(recs, NOW);
    const db = out.find((a) => a.sourceId === "db-lag")!;
    expect(db.sourceStatus).toBe("ACTIVE");
    expect(db.title).toBe("DB lag again");
    expect(db.startedAt).toBe(Date.UTC(2026, 10, 26, 20));
    expect(db.reopenedAt).toBe(Date.UTC(2026, 10, 26, 21));
    expect(db.tags).toEqual(["db", "replica"]);
    expect(db.fields["cc.priority"]).toBe("P2");
    expect(out.find((a) => a.sourceId === "disk")!.sourceStatus).toBe("CLOSED");
  });
  it("maps summarised Q3 rows", () => {
    const [a] = normalizeGenericEvents([{ "cc.dedup_key": "k1", last_action: "trigger", title: "T", priority: "P1", service: "checkout", first_seen: "2026-11-26T20:00:00Z", last_seen: "2026-11-26T20:10:00Z" }], NOW);
    expect(a).toMatchObject({ source: "generic-event", title: "T", sourceStatus: "ACTIVE", reopenedAt: Date.UTC(2026, 10, 26, 20, 10) });
    expect(a!.fields["cc.priority"]).toBe("P1");
    expect(a!.fields["cc.service"]).toBe("checkout");
  });
});

describe("dedup", () => {
  it("drops problem-owned Davis events and merges their cc.* fields into the problem", () => {
    const alerts = normalizeRecords({ problems: [liveProblem], davisEvents: [liveEvent, { ...liveEvent, "event.id": "other-1", "cc.service": "x" }] }, NOW);
    const r = dedupAlerts(alerts);
    expect(r.ownedByProblem).toBe(1);
    expect(r.alerts.map((a) => a.source).sort()).toEqual(["davis-event", "davis-problem"]);
    const p = r.alerts.find((a) => a.source === "davis-problem")!;
    expect(p.fields["cc.service"]).toBe("checkout");
    // the input was not mutated
    expect(alerts.find((a) => a.source === "davis-problem")!.fields["cc.service"]).toBeUndefined();
  });
  it("drops frequent events and collapses same dedup key (latest wins)", () => {
    const alerts = normalizeRecords({ davisEvents: [
      { ...liveEvent, "event.id": "f1", "dt.davis.is_frequent_event": true },
      { ...liveEvent, "event.id": "a", "cc.dedup_key": "k", "event.start": "2026-11-26T20:00:00Z", "event.name": "old" },
      { ...liveEvent, "event.id": "b", "cc.dedup_key": "k", "event.start": "2026-11-26T21:00:00Z", "event.name": "new" },
    ] }, NOW);
    const r = dedupAlerts(alerts);
    expect(r.frequent).toBe(1);
    expect(r.collapsed).toBe(1);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]!.title).toBe("new");
  });
});
