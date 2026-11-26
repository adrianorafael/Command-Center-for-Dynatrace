/**
 * Configuration as code: export and import the whole Command Center configuration
 * (settings, teams, schedules, policies, services, routing rules, contacts).
 *
 * Used by the `config` app function so admins can version configuration in Git or
 * seed a new environment from CI. Every entity is validated before anything is written.
 */

import type {
  EscalationPolicy,
  RoutingRules,
  Schedule,
  Service,
  Settings,
  Team,
  UserContact,
} from "../../ui/app/domain/contracts";
import type { Repository } from "../../ui/app/data/repository";
import { createStore, mergeSettings } from "../../ui/app/data/store";
import {
  validatePolicy,
  validateRules,
  validateSchedule,
  validateService,
  validateSettings,
  validateTeam,
  validateUserContact,
  type ValidationError,
} from "../../ui/app/domain/validation/validate";

export interface ConfigBundle {
  settings?: Partial<Settings>;
  teams?: Team[];
  schedules?: Schedule[];
  policies?: EscalationPolicy[];
  services?: Service[];
  rules?: RoutingRules;
  contacts?: UserContact[];
}

export type ConfigRequest =
  | { op: "export" }
  | { op: "import"; bundle: ConfigBundle; dryRun?: boolean };

export interface ConfigResponse {
  ok: boolean;
  bundle?: Required<Omit<ConfigBundle, "settings">> & { settings: Settings };
  written?: Record<string, number>;
  errors?: { entity: string; path: string; message: string }[];
}

export async function runConfig(req: ConfigRequest, repo: Repository): Promise<ConfigResponse> {
  const store = createStore(repo);

  if (req.op === "export") {
    const [settings, teams, schedules, policies, services, rules, contacts] = await Promise.all([
      store.getSettings(),
      store.listTeams(),
      store.listSchedules(),
      store.listPolicies(),
      store.listServices(),
      store.getRules(),
      store.listContacts(),
    ]);
    return { ok: true, bundle: { settings, teams, schedules, policies, services, rules, contacts } };
  }

  if (req.op !== "import" || !req.bundle || typeof req.bundle !== "object") {
    return { ok: false, errors: [{ entity: "request", path: "op", message: "Expected op 'export' or 'import' with a bundle" }] };
  }

  const b = req.bundle;
  // Merge with what already exists so references to entities not in the bundle still resolve.
  const [curTeams, curSchedules, curPolicies, curServices] = await Promise.all([
    store.listTeams(),
    store.listSchedules(),
    store.listPolicies(),
    store.listServices(),
  ]);
  const byId = <T extends { id: string }>(cur: T[], next: T[] | undefined): T[] => {
    const m = new Map(cur.map((x) => [x.id, x]));
    for (const x of next ?? []) m.set(x.id, x);
    return [...m.values()];
  };
  const ctx = {
    teams: byId(curTeams, b.teams),
    schedules: byId(curSchedules, b.schedules),
    policies: byId(curPolicies, b.policies),
    services: byId(curServices, b.services),
  };

  const errors: NonNullable<ConfigResponse["errors"]> = [];
  const collect = (entity: string, errs: ValidationError[]): void => {
    for (const e of errs) errors.push({ entity, path: e.path, message: e.message });
  };
  const settings = b.settings ? mergeSettings({ ...(await store.getSettings()), ...b.settings }) : undefined;
  if (settings) collect("settings", validateSettings(settings, ctx));
  for (const t of b.teams ?? []) collect(`team:${t.id}`, validateTeam(t, ctx));
  for (const s of b.schedules ?? []) collect(`schedule:${s.id}`, validateSchedule(s, ctx));
  for (const p of b.policies ?? []) collect(`policy:${p.id}`, validatePolicy(p, ctx));
  for (const s of b.services ?? []) collect(`service:${s.id}`, validateService(s, ctx));
  if (b.rules) collect("rules", validateRules(b.rules, ctx));
  for (const c of b.contacts ?? []) collect(`contact:${c.uid}`, validateUserContact(c));

  if (errors.length > 0) return { ok: false, errors };

  const written: Record<string, number> = {
    settings: settings ? 1 : 0,
    teams: b.teams?.length ?? 0,
    schedules: b.schedules?.length ?? 0,
    policies: b.policies?.length ?? 0,
    services: b.services?.length ?? 0,
    rules: b.rules ? 1 : 0,
    contacts: b.contacts?.length ?? 0,
  };
  if (req.dryRun) return { ok: true, written };

  // Referenced entities first, so a concurrent engine tick never sees dangling ids.
  for (const t of b.teams ?? []) await store.saveTeam(t);
  for (const s of b.schedules ?? []) await store.saveSchedule(s);
  for (const p of b.policies ?? []) await store.savePolicy(p);
  for (const s of b.services ?? []) await store.saveService(s);
  for (const c of b.contacts ?? []) await store.saveContact(c);
  if (b.rules) await store.saveRules(b.rules);
  if (settings) await store.saveSettings(settings);
  return { ok: true, written };
}
