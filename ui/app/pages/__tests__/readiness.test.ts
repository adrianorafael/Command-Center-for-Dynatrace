import { describe, expect, it } from "vitest";
import type { AppData } from "../../hooks/AppDataContext";
import type { Team } from "../../domain/contracts";
import { defaultSettings } from "../../domain/validation/defaults";
import { deliveryIssues, teamReadiness } from "../teams/readiness";

const team: Team = { schemaVersion: 1, id: "pay", name: "Payments", rev: 1, members: [{ uid: "user-0001", role: "responder" }, { uid: "user-0002", role: "observer" }] };

function data(over: Partial<AppData> = {}): AppData {
  return {
    settings: defaultSettings(),
    teams: [team],
    schedules: [],
    policies: [],
    services: [],
    rules: { schemaVersion: 1, rev: 0, rules: [] },
    contacts: [],
    incidents: [],
    notifications: [],
    rollups: [],
    warRooms: [],
    ...over,
  } as unknown as AppData;
}
const step = (d: AppData, key: string) => teamReadiness(team, d, (u) => u).find((i) => i.key === key)!;
const service = { schemaVersion: 1 as const, id: "checkout", name: "Checkout", teamId: "pay", rev: 1 };

describe("team readiness: step 5 only turns green when alerts really arrive", () => {
  it("a service alone is not enough (only events naming it in cc.service arrive)", () => {
    const r = step(data({ services: [service] }), "routing");
    expect(r.done).toBe(false);
    expect(r.detail).toMatch(/cc\.service/);
    expect(r.routingFix).toBe("default-team"); // no default team anywhere: one click fixes it
  });

  it("the default team receives everything no rule routes elsewhere", () => {
    const s = defaultSettings();
    s.defaults.teamId = "pay";
    expect(step(data({ settings: s }), "routing")).toMatchObject({ done: true });
  });

  it("an enabled rule to the team, or to one of its services, counts; disabled and suppressing rules don't", () => {
    const rule = (then: object, enabled = true) => ({ schemaVersion: 1 as const, rev: 1, rules: [{ id: "r1", name: "r", enabled, match: "all" as const, conditions: [], then }] });
    expect(step(data({ rules: rule({ teamId: "pay" }) }), "routing").done).toBe(true);
    expect(step(data({ services: [service], rules: rule({ serviceId: "checkout" }) }), "routing").done).toBe(true);
    expect(step(data({ rules: rule({ teamId: "pay" }, false) }), "routing").done).toBe(false);
    expect(step(data({ rules: rule({ teamId: "pay", suppress: true }) }), "routing").done).toBe(false);
  });

  it("with another default team, the fix is a routing rule", () => {
    const other: Team = { ...team, id: "noc", name: "NOC" };
    const s = defaultSettings();
    s.defaults.teamId = "noc";
    expect(step(data({ teams: [team, other], settings: s }), "routing")).toMatchObject({ done: false, routingFix: "rule", fixLabel: "Add routing rule" });
  });

  it("steps that need people first are blocked until someone gets paged", () => {
    const empty: Team = { ...team, members: [{ uid: "user-0002", role: "observer" }] };
    const items = teamReadiness(empty, data({ teams: [empty] }), (u) => u);
    expect(items.find((i) => i.key === "contacts")?.blocked).toBe(true);
    expect(items.find((i) => i.key === "schedule")?.blocked).toBe(true);
    expect(items.find((i) => i.key === "members")?.blocked).toBeFalsy();
  });
});

describe("delivery issues: 'Ready to page' must not promise more than can be sent", () => {
  const contacts = [{ schemaVersion: 1 as const, uid: "user-0001", rev: 1, methods: [{ id: "m1", channel: "sms" as const, address: "+15550100000" }], rules: [] }];
  const hb = {
    schemaVersion: 1 as const,
    lastTickAt: 1,
    durationMs: 1,
    counts: { alertsFetched: 0, incidentsCreated: 0, incidentsResolved: 0, actionsFolded: 0, notificationsPlanned: 0, notificationsRetried: 0 },
  };

  it("flags a channel the team uses without a provider switched on, and an engine that never ran", () => {
    const issues = deliveryIssues(team, data({ contacts }), false);
    expect(issues.map((i) => i.to)).toEqual(["/integrations?tab=outbound", "/integrations?tab=workflows"]);
    expect(issues[0]?.text).toMatch(/SMS/);
  });

  it("is empty once the provider is on and the engine has run", () => {
    const s = defaultSettings();
    s.providers = s.providers.map((p) => (p.channel === "sms" ? { ...p, enabled: true, credentialVaultId: "CREDENTIAL_VAULT_ENTRY-0000000000000001" } : p));
    expect(deliveryIssues(team, data({ contacts, settings: s, heartbeat: hb }), false)).toEqual([]);
  });

  it("observers' contact methods don't count, and demo mode has no engine to install", () => {
    const observerOnly = [{ ...contacts[0]!, uid: "user-0002", methods: [{ id: "m2", channel: "voice" as const, address: "+15550100001" }] }];
    expect(deliveryIssues(team, data({ contacts: observerOnly }), true)).toEqual([]);
  });
});
