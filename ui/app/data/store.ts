/**
 * Store facade (frozen interface `Store` in ./repository.ts) over any Repository adapter.
 * Missing keys yield defaults (domain defaultSettings(), empty RoutingRules) — a fresh tenant
 * has no state yet and that is not an error (app-lifecycle: "404 Unknown key" is expected).
 *
 * DOM-free: shared by the UI and the app functions.
 */

import {
  SCHEMA_VERSION,
  type DailyRollup,
  type EngineHeartbeat,
  type EscalationPolicy,
  type Incident,
  type IncidentAction,
  type NotificationRecord,
  type RoutingRules,
  type Schedule,
  type Service,
  type Settings,
  type Team,
  type UserContact,
} from "../domain/contracts";
import { KEY, PREFIX, type Repository, type Store, type Stored } from "./repository";
import { defaultSettings } from "./domainPort";
import { applyRollupDelta } from "../domain/reports/metrics";
import type { WarRoom } from "../domain/warrooms";

/** Rollup delta keys `rpt.<day>.d.<rand>` (writers outside the engine lease); summed on read. */
export const ROLLUP_DELTA_MARK = ".d.";
export function rollupDeltaKey(day: string, rand: string): string {
  return `${KEY.rollup(day)}${ROLLUP_DELTA_MARK}${rand}`;
}

/** Sum `rpt.<day>` with any pending `rpt.<day>.d.*` deltas, one rollup per day (sorted by day). */
export function sumRollups(rows: Stored<DailyRollup>[]): DailyRollup[] {
  const byDay = new Map<string, DailyRollup>();
  for (const r of rows) {
    const day = r.value.day;
    const { schemaVersion: _v, ...delta } = r.value;
    void _v;
    byDay.set(day, applyRollupDelta(byDay.get(day), delta));
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Operator actions expire if the engine never folds them (spec §4: act.* TTL now+7d). */
export const ACTION_TTL_MS = 7 * 24 * 3600_000;

export function emptyRules(): RoutingRules {
  return { schemaVersion: SCHEMA_VERSION, rev: 0, rules: [] };
}

/**
 * Stored settings merged over defaults section by section, so a settings object written by an
 * older build still gets fields added later.
 */
export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  if (!stored) return d;
  const merged: Settings = {
    ...d,
    ...stored,
    sources: {
      davisProblems: { ...d.sources.davisProblems, ...stored.sources?.davisProblems },
      davisEvents: { ...d.sources.davisEvents, ...stored.sources?.davisEvents },
      genericEvents: { ...d.sources.genericEvents, ...stored.sources?.genericEvents },
    },
    defaults: { ...d.defaults, ...stored.defaults },
    engine: { ...d.engine, ...stored.engine },
    retention: { ...d.retention, ...stored.retention },
    ui: { ...d.ui, ...stored.ui },
    // Stored providers win; providers added by a later version are appended (switched off).
    providers: stored.providers ? [...stored.providers, ...d.providers.filter((p) => !stored.providers?.some((s) => s.id === p.id))] : d.providers,
  };
  if (!merged.engine.workflowId) merged.engine.workflowId = d.engine.workflowId;
  return merged;
}

function values<T>(rows: Stored<T>[]): T[] {
  return rows.map((r) => r.value);
}

function randomSuffix(): string {
  // Non-security id: only needs to make concurrent writers' keys distinct.
  let s = "";
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export function createStore(repo: Repository): Store {
  return {
    repo,

    async getSettings() {
      const s = await repo.get<Partial<Settings>>(KEY.settings);
      return mergeSettings(s?.value);
    },
    saveSettings: (s) => repo.put(KEY.settings, s),

    listTeams: async () => values(await repo.list<Team>(PREFIX.team)),
    saveTeam: (t) => repo.put(KEY.team(t.id), t),
    deleteTeam: (id) => repo.delete(KEY.team(id)),

    listSchedules: async () => values(await repo.list<Schedule>(PREFIX.schedule)),
    saveSchedule: (s) => repo.put(KEY.schedule(s.id), s),
    deleteSchedule: (id) => repo.delete(KEY.schedule(id)),

    listPolicies: async () => values(await repo.list<EscalationPolicy>(PREFIX.policy)),
    savePolicy: (p) => repo.put(KEY.policy(p.id), p),
    deletePolicy: (id) => repo.delete(KEY.policy(id)),

    listServices: async () => values(await repo.list<Service>(PREFIX.service)),
    saveService: (s) => repo.put(KEY.service(s.id), s),
    deleteService: (id) => repo.delete(KEY.service(id)),

    async getRules() {
      const r = await repo.get<RoutingRules>(KEY.rules);
      return r?.value ?? emptyRules();
    },
    saveRules: (r) => repo.put(KEY.rules, r),

    listContacts: async () => values(await repo.list<UserContact>(PREFIX.contact)),
    saveContact: (c) => repo.put(KEY.contact(c.uid), c),

    listIncidents: async () => values(await repo.list<Incident>(PREFIX.incident)),
    async getIncident(id) {
      return (await repo.get<Incident>(KEY.incident(id)))?.value;
    },

    async listActions(incidentId) {
      // Incident ids never contain '.', so `act.<id>.` cannot match another incident's keys.
      const prefix = incidentId ? `${PREFIX.action}${incidentId}.` : PREFIX.action;
      // Keys embed a zero-padded 13-digit timestamp → key order is chronological.
      return repo.list<IncidentAction>(prefix);
    },
    async appendAction(a) {
      await repo.put(KEY.action(a.incidentId, Math.max(0, Math.floor(a.at)), randomSuffix()), a, ACTION_TTL_MS);
    },

    async listNotifications(incidentId) {
      const prefix = incidentId ? `${PREFIX.notification}${incidentId}.` : PREFIX.notification;
      return values(await repo.list<NotificationRecord>(prefix));
    },

    listRollups: async () => sumRollups(await repo.list<DailyRollup>(PREFIX.rollup)),
    listWarRooms: async () => (await repo.list<WarRoom>(PREFIX.warRoom)).map((x) => x.value).sort((a, b) => b.openedAt - a.openedAt),
    saveWarRoom: (w) => repo.put(KEY.warRoom(w.id), w),
    deleteWarRoom: (id) => repo.delete(KEY.warRoom(id)),

    async getHeartbeat() {
      return (await repo.get<EngineHeartbeat>(KEY.heartbeat))?.value;
    },
  };
}
