/**
 * Repository port — FROZEN contract (lead-owned).
 *
 * Two adapters implement it: AppStateRepository (@dynatrace-sdk/client-state) and
 * MemoryRepository (demo mode + tests). The UI and the app functions only talk to this.
 *
 * Key schema (lower-case, [a-z0-9._-], ≤ 200 chars) — see specs/command-center-v2.md §4.
 */

import type {
  DailyRollup,
  EngineHeartbeat,
  EscalationPolicy,
  Incident,
  IncidentAction,
  NotificationRecord,
  RoutingRules,
  Schedule,
  Service,
  Settings,
  Team,
  UserContact,
} from "../domain/contracts";
import type { WarRoom } from "../domain/warrooms";

export const KEY = {
  settings: "cfg.settings",
  rules: "rules.main",
  heartbeat: "hb.engine",
  lock: "lock.engine",
  team: (id: string) => `team.${id}`,
  schedule: (id: string) => `sched.${id}`,
  policy: (id: string) => `pol.${id}`,
  service: (id: string) => `svc.${id}`,
  contact: (uid: string) => `contact.${uid}`,
  incident: (id: string) => `inc.${id}`,
  action: (incId: string, at: number, rand: string) =>
    `act.${incId}.${String(at).padStart(13, "0")}.${rand}`,
  notification: (key: string) => `ntf.${key}`,
  archive: (yyyymmdd: string, incId: string) => `arc.${yyyymmdd}.${incId}`,
  rollup: (day: string) => `rpt.${day}`,
  warRoom: (id: string) => `war.${id}`,
} as const;

export const PREFIX = {
  team: "team.",
  schedule: "sched.",
  policy: "pol.",
  service: "svc.",
  contact: "contact.",
  incident: "inc.",
  action: "act.",
  notification: "ntf.",
  archive: "arc.",
  rollup: "rpt.",
  warRoom: "war.",
} as const;

/** A stored record plus server-side modification info, when the adapter knows it. */
export interface Stored<T> {
  key: string;
  value: T;
  lastModifiedBy?: string;
  lastModifiedTime?: number;
}

export interface Repository {
  /** Generic key-value access (adapters JSON-encode values). */
  get<T>(key: string): Promise<Stored<T> | undefined>;
  list<T>(prefix: string): Promise<Stored<T>[]>;
  /** ttlMs: optional time-to-live (adapter clamps to the platform's 1 min … 90 d window). */
  put<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Typed convenience facade over a Repository. Implemented once, in data/store.ts. */
export interface Store {
  readonly repo: Repository;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listTeams(): Promise<Team[]>;
  saveTeam(t: Team): Promise<void>;
  deleteTeam(id: string): Promise<void>;
  listSchedules(): Promise<Schedule[]>;
  saveSchedule(s: Schedule): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  listPolicies(): Promise<EscalationPolicy[]>;
  savePolicy(p: EscalationPolicy): Promise<void>;
  deletePolicy(id: string): Promise<void>;
  listServices(): Promise<Service[]>;
  saveService(s: Service): Promise<void>;
  deleteService(id: string): Promise<void>;
  getRules(): Promise<RoutingRules>;
  saveRules(r: RoutingRules): Promise<void>;
  listContacts(): Promise<UserContact[]>;
  saveContact(c: UserContact): Promise<void>;
  listIncidents(): Promise<Incident[]>;
  getIncident(id: string): Promise<Incident | undefined>;
  /** Pending (not yet folded) operator actions, oldest first. */
  listActions(incidentId?: string): Promise<Stored<IncidentAction>[]>;
  /** Append-only operator action (UI). */
  appendAction(a: IncidentAction): Promise<void>;
  listNotifications(incidentId?: string): Promise<NotificationRecord[]>;
  listRollups(): Promise<DailyRollup[]>;
  getHeartbeat(): Promise<EngineHeartbeat | undefined>;
  listWarRooms(): Promise<WarRoom[]>;
  saveWarRoom(w: WarRoom): Promise<void>;
  deleteWarRoom(id: string): Promise<void>;
}
