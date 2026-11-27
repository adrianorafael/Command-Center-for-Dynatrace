/**
 * Configuration export/import (Settings → Backup). Import is validate-first:
 *  1. the whole document is checked (shape, every target key via isValidKey, domain validators);
 *     on any problem nothing is written;
 *  2. settings are deep-merged per section over the CURRENT settings (a partial or older export
 *     never blanks newer fields; the current engine workflow id is kept when the file has none);
 *  3. entities are written one by one and every failure is reported, so a partial import is visible.
 */

import {
  SCHEMA_VERSION,
  type EscalationPolicy,
  type RoutingRules,
  type Schedule,
  type Service,
  type Settings,
  type Team,
  type UserContact,
} from "../domain/contracts";
import { isValidKey } from "../domain/keys";
import {
  validatePolicy,
  validateRules,
  validateSchedule,
  validateService,
  validateSettings,
  validateTeam,
  validateUserContact,
  type RefContext,
} from "../domain/validation/validate";
import { KEY, type Store } from "./repository";

/** `kind` marker that identifies a Command Center export file. */
export const CONFIG_EXPORT_KIND = "command-center-config";

/** The Settings → Backup file. `exportedAt` is an ISO timestamp. */
export interface ConfigExport {
  kind: typeof CONFIG_EXPORT_KIND;
  schemaVersion: number;
  exportedAt: string;
  settings: Settings;
  teams: Team[];
  schedules: Schedule[];
  policies: EscalationPolicy[];
  services: Service[];
  rules: RoutingRules;
  contacts: UserContact[];
}

export interface ImportProblem {
  path: string;
  message: string;
}

/** `written` / `failed` hold App State keys; `ok` only when there were no problems and no failed writes. */
export interface ImportResult {
  ok: boolean;
  /** Validation problems — when present nothing was written. */
  problems: ImportProblem[];
  written: string[];
  failed: { key: string; error: string }[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Per-section merge of an imported (possibly partial) settings object over the current one. */
export function mergeImportedSettings(current: Settings, imported: Partial<Settings>): Settings {
  const i = imported;
  const merged: Settings = {
    ...current,
    ...i,
    schemaVersion: SCHEMA_VERSION,
    rev: Math.max(current.rev, typeof i.rev === "number" ? i.rev : 0) + 1,
    sources: {
      davisProblems: { ...current.sources.davisProblems, ...i.sources?.davisProblems },
      davisEvents: { ...current.sources.davisEvents, ...i.sources?.davisEvents },
      genericEvents: { ...current.sources.genericEvents, ...i.sources?.genericEvents },
    },
    defaults: {
      ...current.defaults,
      ...i.defaults,
      priorityBySeverity: { ...current.defaults.priorityBySeverity, ...i.defaults?.priorityBySeverity },
      priorityByCategory: { ...current.defaults.priorityByCategory, ...i.defaults?.priorityByCategory },
    },
    engine: { ...current.engine, ...i.engine },
    retention: { ...current.retention, ...i.retention },
    ui: { ...current.ui, ...i.ui },
    providers: Array.isArray(i.providers) ? i.providers : current.providers,
  };
  if (!merged.engine.workflowId) merged.engine.workflowId = current.engine.workflowId;
  return merged;
}

/** Parse + validate an export document. Returns problems (empty = safe to import). */
export function checkConfigExport(
  doc: unknown,
  current: Settings,
  existing: RefContext = {},
): { problems: ImportProblem[]; settings?: Settings } {
  const problems: ImportProblem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  if (!isObject(doc) || doc["kind"] !== CONFIG_EXPORT_KIND) {
    add("kind", "Not a Command Center configuration export");
    return { problems };
  }
  const d = doc as Partial<ConfigExport>;
  if (d.schemaVersion !== undefined && d.schemaVersion !== SCHEMA_VERSION) {
    add("schemaVersion", `Unsupported schema version ${String(d.schemaVersion)}`);
  }
  const list = <T>(name: string, v: unknown): T[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      add(name, "Must be a list");
      return [];
    }
    return v as T[];
  };
  const teams = list<Team>("teams", d.teams);
  const schedules = list<Schedule>("schedules", d.schedules);
  const policies = list<EscalationPolicy>("policies", d.policies);
  const services = list<Service>("services", d.services);
  const contacts = list<UserContact>("contacts", d.contacts);

  // References may point at entities in the file or already stored (file wins on id clash).
  const union = <T extends { id: string }>(a: T[], b: T[] = []) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];
  const ctx: RefContext = {
    teams: union(teams, existing.teams),
    schedules: union(schedules, existing.schedules),
    policies: union(policies, existing.policies),
    services: union(services, existing.services),
  };
  const checkKeys = <T>(name: string, items: T[], idOf: (x: T) => unknown, key: (id: string) => string) => {
    const seen = new Set<string>();
    items.forEach((x, n) => {
      const id = isObject(x) ? idOf(x) : undefined;
      if (typeof id !== "string" || !isValidKey(key(id))) add(`${name}[${n}]`, "Missing or invalid id");
      else if (seen.has(id)) add(`${name}[${n}]`, `Duplicate id ${id}`);
      else seen.add(id);
    });
  };
  checkKeys("teams", teams, (x) => x.id, KEY.team);
  checkKeys("schedules", schedules, (x) => x.id, KEY.schedule);
  checkKeys("policies", policies, (x) => x.id, KEY.policy);
  checkKeys("services", services, (x) => x.id, KEY.service);
  checkKeys("contacts", contacts, (x) => x.uid, KEY.contact);
  if (problems.length) return { problems };

  const prefixed = (name: string, errs: { path: string; message: string }[]) =>
    errs.forEach((e) => add(`${name}.${e.path}`, e.message));
  teams.forEach((t, n) => prefixed(`teams[${n}]`, validateTeam(t, ctx)));
  schedules.forEach((s, n) => prefixed(`schedules[${n}]`, validateSchedule(s, ctx)));
  policies.forEach((p, n) => prefixed(`policies[${n}]`, validatePolicy(p, ctx)));
  services.forEach((s, n) => prefixed(`services[${n}]`, validateService(s, ctx)));
  contacts.forEach((c, n) => prefixed(`contacts[${n}]`, validateUserContact(c)));
  if (d.rules !== undefined) {
    if (!isObject(d.rules) || !Array.isArray((d.rules as Partial<RoutingRules>).rules)) add("rules", "Invalid routing rules");
    else prefixed("rules", validateRules(d.rules, ctx));
  }

  let settings: Settings | undefined;
  if (d.settings !== undefined) {
    if (!isObject(d.settings)) add("settings", "Invalid settings");
    else {
      settings = mergeImportedSettings(current, d.settings);
      prefixed("settings", validateSettings(settings, ctx));
    }
  }
  return { problems, settings };
}

/** Check, then write every entity (settings last). Writes are not atomic: see `failed` for a partial import. */
export async function importConfig(
  store: Store,
  doc: unknown,
  current: Settings,
  existing: RefContext = {},
): Promise<ImportResult> {
  const { problems, settings } = checkConfigExport(doc, current, existing);
  const result: ImportResult = { ok: false, problems, written: [], failed: [] };
  if (problems.length) return result;
  const d = doc as Partial<ConfigExport>;

  const write = async (key: string, fn: () => Promise<void>) => {
    try {
      await fn();
      result.written.push(key);
    } catch (e) {
      result.failed.push({ key, error: e instanceof Error ? e.message.slice(0, 200) : "write failed" });
    }
  };
  for (const t of d.teams ?? []) await write(KEY.team(t.id), () => store.saveTeam(t));
  for (const s of d.schedules ?? []) await write(KEY.schedule(s.id), () => store.saveSchedule(s));
  for (const p of d.policies ?? []) await write(KEY.policy(p.id), () => store.savePolicy(p));
  for (const s of d.services ?? []) await write(KEY.service(s.id), () => store.saveService(s));
  for (const c of d.contacts ?? []) await write(KEY.contact(c.uid), () => store.saveContact(c));
  const rules = d.rules;
  if (rules) await write(KEY.rules, () => store.saveRules(rules));
  // Settings last: they may reference the entities above.
  if (settings) await write(KEY.settings, () => store.saveSettings(settings));
  result.ok = result.failed.length === 0;
  return result;
}
