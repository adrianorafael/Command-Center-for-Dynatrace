import type { Stored } from "../../data/repository";
import type { Alert, EscalationPolicy, Incident, IncidentAction, Schedule, Service, Settings, Team, UserContact, RoutingRules, NotificationRecord } from "../contracts";
import { dedupKeyFor } from "../ids";
import { defaultSettings } from "../validation/defaults";
import type { TickInput, TickOutput } from "../engine/tick";
import { KEY } from "../keys";

export const T0 = Date.UTC(2026, 10, 2, 12, 0, 0); // Mon 2 Nov 2026 12:00Z
export const MIN = 60_000;

export function alert(p: Partial<Alert> & { sourceId: string }): Alert {
  const source = p.source ?? "davis-problem";
  return {
    source,
    dedupKey: dedupKeyFor(source, p.sourceId),
    title: "CPU saturation on host-a",
    sourceStatus: "ACTIVE",
    startedAt: T0 - 5 * MIN,
    entities: [{ id: "HOST-DEMO000000000001", name: "host-a", type: "HOST" }],
    tags: [],
    underMaintenance: false,
    muted: false,
    fields: {},
    ...p,
  };
}

export function settings(over: Partial<Settings["engine"]> = {}): Settings {
  const s = defaultSettings();
  s.engine = { ...s.engine, ...over };
  s.defaults.teamId = "noc";
  s.defaults.policyId = "pol-noc";
  s.providers = s.providers.map((p) => ({ ...p, enabled: true, credentialVaultId: "CREDENTIALS_VAULT-0000000000000001" }));
  return s;
}

export const teams: Team[] = [
  { schemaVersion: 1, id: "noc", name: "NOC Core", rev: 1, members: [
    { uid: "user-0001", role: "admin" }, { uid: "user-0002", role: "responder" }, { uid: "user-0003", role: "observer" },
  ] },
];

export const schedules: Schedule[] = [
  { schemaVersion: 1, id: "sched-noc", name: "NOC primary", timeZone: "UTC", rev: 1, overrides: [], layers: [
    { id: "l1", name: "Primary", participants: ["user-0001", "user-0002"], rotation: { type: "daily" }, startsAt: Date.UTC(2026, 10, 1, 9), handoffTime: "09:00" },
  ] },
];

export const policy: EscalationPolicy = {
  schemaVersion: 1, id: "pol-noc", name: "NOC default", rev: 1, repeat: 1,
  steps: [
    { delayMinutes: 0, targets: [{ type: "schedule", scheduleId: "sched-noc" }] },
    { delayMinutes: 10, targets: [{ type: "user", uid: "user-0002" }] },
  ],
};

export const contacts: UserContact[] = [
  { schemaVersion: 1, uid: "user-0001", rev: 1, displayName: "Alex Demo", methods: [
    { id: "m1", channel: "sms", address: "+15550100001" }, { id: "m2", channel: "voice", address: "+15550100001" },
  ], rules: [{ maxPriority: "P5", methodId: "m1", delayMinutes: 0 }, { maxPriority: "P2", methodId: "m2", delayMinutes: 5 }] },
  { schemaVersion: 1, uid: "user-0002", rev: 1, displayName: "Sam Demo", methods: [
    { id: "m1", channel: "slack", address: "@sam" },
  ], rules: [] },
];

export const services: Service[] = [{ schemaVersion: 1, id: "checkout", name: "Checkout", teamId: "noc", policyId: "pol-noc", rev: 1 }];
export const rules: RoutingRules = { schemaVersion: 1, rev: 1, rules: [] };

export function input(p: Partial<TickInput> = {}): TickInput {
  return {
    now: T0, settings: settings(), teams, schedules, policies: [policy], services, rules, contacts,
    incidents: [], pendingActions: [], ledger: [], alerts: [], ...p,
  };
}

/** Apply a tick output to the state the next tick reads (what the app function persists). */
export function persist(prev: TickInput, out: TickOutput): Pick<TickInput, "incidents" | "ledger" | "pendingActions"> {
  const inc = new Map(prev.incidents.map((i) => [i.id, i]));
  for (const i of out.incidentsToWrite) inc.set(i.id, i);
  for (const id of out.incidentIdsToDelete) inc.delete(id);
  for (const a of out.archives) inc.delete(a.incident.id);
  const led = new Map(prev.ledger.map((r) => [r.key, r]));
  for (const r of out.notificationsToWrite) led.set(r.key, r);
  const del = new Set(out.actionKeysToDelete);
  return { incidents: [...inc.values()], ledger: [...led.values()], pendingActions: prev.pendingActions.filter((a) => !del.has(a.key)) };
}

let seq = 0;
export function act(a: Omit<IncidentAction, "schemaVersion" | "clientId"> & Record<string, unknown>, by = "user-0001"): Stored<IncidentAction> {
  const value = { schemaVersion: 1, clientId: "c1", ...a } as IncidentAction;
  seq++;
  return { key: KEY.action(value.incidentId, value.at, `r${String(seq).padStart(5, "0")}`), value, lastModifiedBy: by };
}

export function allRequests(out: TickOutput) {
  return Object.values(out.batches).flat();
}

export type { Incident, NotificationRecord };

/** Pretend the workflow delivered everything in the ledger. */
export function delivered<T extends { ledger: NotificationRecord[] }>(state: T): T {
  return { ...state, ledger: state.ledger.map((r) => (r.status === "planned" ? { ...r, status: "sent" as const, reportedAt: r.plannedAt + 1000 } : r)) };
}
