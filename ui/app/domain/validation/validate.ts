/**
 * Form validators. Each returns a list of {path, message}; empty = valid.
 * Cross-reference checks run only when the related collections are passed in `ctx`.
 */

import {
  CHANNELS,
  type Channel,
  type EscalationPolicy,
  type ProviderConfig,
  type RoutingRule,
  type RoutingRules,
  type Schedule,
  type Service,
  type Settings,
  type Team,
  type UserContact,
} from "../contracts";
import { isPriority } from "../priority";
import { RULE_FIELDS, regexSafetyIssue, safeRegex } from "../routing/match";
import { isValidTimeZone, parseHHmm } from "../time/tz";

export interface ValidationError {
  path: string;
  message: string;
}

export interface RefContext {
  teams?: Team[];
  schedules?: Schedule[];
  policies?: EscalationPolicy[];
  services?: Service[];
  /** Known IAM uids (when the UI resolved them). */
  uids?: string[];
}

/** Entity ids are embedded in dot-delimited keys: `[a-z0-9_-]`, 1…64 chars. */
export const ENTITY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const E164_RE = /^\+[1-9]\d{6,14}$/;
/** Classic (CREDENTIALS_VAULT-…) and platform (CREDENTIAL_VAULT_ENTRY-…) entry ids — the latter verified on a tenant. */
export const VAULT_ID_RE = /^(CREDENTIALS_VAULT|CREDENTIAL_VAULT_ENTRY)-[0-9A-F]{16}$/;
const MAX_NAME = 120;

const PHONE_CHANNELS: Channel[] = ["sms", "voice", "whatsapp"];

class Collector {
  readonly errors: ValidationError[] = [];
  add(path: string, message: string): void {
    this.errors.push({ path, message });
  }
  id(path: string, v: string | undefined): void {
    if (!v || !ENTITY_ID_RE.test(v)) this.add(path, "Use 1–64 lower-case letters, digits, '-' or '_'");
  }
  name(path: string, v: string | undefined): void {
    if (!v || !v.trim()) this.add(path, "Required");
    else if (v.length > MAX_NAME) this.add(path, `At most ${MAX_NAME} characters`);
  }
  hhmm(path: string, v: string | undefined): void {
    if (parseHHmm(v) === undefined) this.add(path, "Use HH:mm (00:00–24:00)");
  }
  tz(path: string, v: string | undefined): void {
    if (!v || !isValidTimeZone(v)) this.add(path, "Unknown IANA time zone");
  }
  days(path: string, v: number[] | undefined): void {
    if (!v || v.length === 0) this.add(path, "Pick at least one day");
    else if (v.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) this.add(path, "Days are 0 (Sun) … 6 (Sat)");
  }
  nonNegInt(path: string, v: number | undefined, max?: number): void {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) this.add(path, "Must be a whole number ≥ 0");
    else if (max !== undefined && v > max) this.add(path, `At most ${max}`);
  }
}

function dupIds(c: Collector, path: string, ids: string[]): void {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) c.add(`${path}[${i}].id`, `Duplicate id ${id}`);
    seen.add(id);
  });
}

export function validateTeam(team: Team, ctx: RefContext = {}): ValidationError[] {
  const c = new Collector();
  c.id("id", team.id);
  c.name("name", team.name);
  const seen = new Set<string>();
  team.members.forEach((m, i) => {
    if (!m.uid) c.add(`members[${i}].uid`, "Pick a Dynatrace user");
    if (seen.has(m.uid)) c.add(`members[${i}].uid`, "User is already a member");
    seen.add(m.uid);
    if (!["admin", "responder", "observer"].includes(m.role)) c.add(`members[${i}].role`, "Unknown role");
    if (ctx.uids && m.uid && !ctx.uids.includes(m.uid)) c.add(`members[${i}].uid`, "Not a user of this environment");
  });
  if (team.defaultPolicyId && ctx.policies && !ctx.policies.some((p) => p.id === team.defaultPolicyId)) {
    c.add("defaultPolicyId", "Escalation policy not found");
  }
  (team.quietHours ?? []).forEach((q, i) => {
    c.tz(`quietHours[${i}].timeZone`, q.timeZone);
    c.days(`quietHours[${i}].days`, q.days);
    c.hhmm(`quietHours[${i}].from`, q.from);
    c.hhmm(`quietHours[${i}].to`, q.to);
    if (!isPriority(q.minPriority)) c.add(`quietHours[${i}].minPriority`, "Pick a priority");
    if (q.mode !== "hold" && q.mode !== "low-urgency") c.add(`quietHours[${i}].mode`, "Pick hold or low-urgency");
  });
  return c.errors;
}

export function validateSchedule(s: Schedule, ctx: RefContext = {}): ValidationError[] {
  const c = new Collector();
  c.id("id", s.id);
  c.name("name", s.name);
  c.tz("timeZone", s.timeZone);
  if (s.teamId && ctx.teams && !ctx.teams.some((t) => t.id === s.teamId)) c.add("teamId", "Team not found");
  if (s.layers.length === 0) c.add("layers", "Add at least one layer");
  dupIds(c, "layers", s.layers.map((l) => l.id));
  s.layers.forEach((l, i) => {
    const p = `layers[${i}]`;
    if (!l.id) c.add(`${p}.id`, "Required");
    c.name(`${p}.name`, l.name);
    if (l.participants.length === 0) c.add(`${p}.participants`, "Add at least one participant");
    if (l.participants.some((u) => !u)) c.add(`${p}.participants`, "Empty participant");
    if (!["daily", "weekly", "custom"].includes(l.rotation.type)) c.add(`${p}.rotation.type`, "Unknown rotation");
    if (l.rotation.type === "custom") {
      const h = l.rotation.lengthHours;
      if (typeof h !== "number" || !Number.isFinite(h) || h < 1 || h > 24 * 28) {
        c.add(`${p}.rotation.lengthHours`, "Between 1 and 672 hours");
      }
    }
    if (!Number.isFinite(l.startsAt) || l.startsAt <= 0) c.add(`${p}.startsAt`, "Pick a start date");
    c.hhmm(`${p}.handoffTime`, l.handoffTime);
    (l.restrictions ?? []).forEach((r, j) => {
      c.days(`${p}.restrictions[${j}].days`, r.days);
      c.hhmm(`${p}.restrictions[${j}].from`, r.from);
      c.hhmm(`${p}.restrictions[${j}].to`, r.to);
    });
  });
  dupIds(c, "overrides", s.overrides.map((o) => o.id));
  s.overrides.forEach((o, i) => {
    if (!o.uid) c.add(`overrides[${i}].uid`, "Pick a user");
    if (!(o.to > o.from)) c.add(`overrides[${i}].to`, "End must be after start");
  });
  return c.errors;
}

export function validatePolicy(p: EscalationPolicy, ctx: RefContext = {}): ValidationError[] {
  const c = new Collector();
  c.id("id", p.id);
  c.name("name", p.name);
  c.nonNegInt("repeat", p.repeat, 20);
  if (p.teamId && ctx.teams && !ctx.teams.some((t) => t.id === p.teamId)) c.add("teamId", "Team not found");
  if (p.steps.length === 0) c.add("steps", "Add at least one step");
  if (p.steps.length > 20) c.add("steps", "At most 20 steps");
  p.steps.forEach((s, i) => {
    const sp = `steps[${i}]`;
    c.nonNegInt(`${sp}.delayMinutes`, s.delayMinutes, 24 * 60);
    if (s.targets.length === 0) c.add(`${sp}.targets`, "Add at least one target");
    s.targets.forEach((t, j) => {
      const tp = `${sp}.targets[${j}]`;
      if (t.type === "schedule") {
        if (!t.scheduleId) c.add(tp, "Pick a schedule");
        else if (ctx.schedules && !ctx.schedules.some((x) => x.id === t.scheduleId)) c.add(tp, "Schedule not found");
      } else if (t.type === "team") {
        if (!t.teamId) c.add(tp, "Pick a team");
        else if (ctx.teams && !ctx.teams.some((x) => x.id === t.teamId)) c.add(tp, "Team not found");
      } else if (t.type === "user") {
        if (!t.uid) c.add(tp, "Pick a user");
      } else {
        c.add(tp, "Unknown target type");
      }
    });
    (s.channels ?? []).forEach((ch, j) => {
      if (!CHANNELS.includes(ch)) c.add(`${sp}.channels[${j}]`, "Unknown channel");
    });
  });
  return c.errors;
}

export function validateService(s: Service, ctx: RefContext = {}): ValidationError[] {
  const c = new Collector();
  c.id("id", s.id);
  c.name("name", s.name);
  if (!s.teamId) c.add("teamId", "Pick an owning team");
  else if (ctx.teams && !ctx.teams.some((t) => t.id === s.teamId)) c.add("teamId", "Team not found");
  if (s.policyId && ctx.policies && !ctx.policies.some((p) => p.id === s.policyId)) c.add("policyId", "Policy not found");
  if (s.defaultPriority !== undefined && !isPriority(s.defaultPriority)) c.add("defaultPriority", "Pick a priority");
  return c.errors;
}

const OPS = ["equals", "contains", "regex", "in", "exists", "lte", "gte"];

export function validateRule(r: RoutingRule, ctx: RefContext = {}, prefix = ""): ValidationError[] {
  const c = new Collector();
  c.id(`${prefix}id`, r.id);
  c.name(`${prefix}name`, r.name);
  if (r.match !== "all" && r.match !== "any") c.add(`${prefix}match`, "Pick all or any");
  r.conditions.forEach((cond, i) => {
    const p = `${prefix}conditions[${i}]`;
    const knownField = (RULE_FIELDS as readonly string[]).includes(cond.field) || /^fields\.[\w.:-]+$/.test(cond.field);
    if (!knownField) c.add(`${p}.field`, "Unknown field (use a listed field or fields.<name>)");
    if (!OPS.includes(cond.op)) c.add(`${p}.op`, "Unknown operator");
    if (cond.op !== "exists" && !(cond.value ?? "").trim()) c.add(`${p}.value`, "Required");
    if (cond.op === "regex" && cond.value) {
      const unsafe = regexSafetyIssue(cond.value);
      if (unsafe) c.add(`${p}.value`, unsafe);
      else if (!safeRegex(cond.value)) c.add(`${p}.value`, "Invalid regular expression");
    }
    if ((cond.op === "lte" || cond.op === "gte") && !Number.isFinite(Number(cond.value))) {
      c.add(`${p}.value`, "Must be a number");
    }
  });
  const t = r.then;
  if (t.priority !== undefined && !isPriority(t.priority)) c.add(`${prefix}then.priority`, "Pick a priority");
  if (t.serviceId && ctx.services && !ctx.services.some((s) => s.id === t.serviceId)) c.add(`${prefix}then.serviceId`, "Service not found");
  if (t.teamId && ctx.teams && !ctx.teams.some((x) => x.id === t.teamId)) c.add(`${prefix}then.teamId`, "Team not found");
  if (t.policyId && ctx.policies && !ctx.policies.some((x) => x.id === t.policyId)) c.add(`${prefix}then.policyId`, "Policy not found");
  if (!t.suppress && !t.serviceId && !t.teamId && !t.policyId && !t.priority && !(t.addTags ?? []).length) {
    c.add(`${prefix}then`, "The rule does nothing — set a service, team, policy, priority, tags or suppress");
  }
  return c.errors;
}

export function validateRules(rules: RoutingRules, ctx: RefContext = {}): ValidationError[] {
  const errors: ValidationError[] = [];
  const c = new Collector();
  dupIds(c, "rules", rules.rules.map((r) => r.id));
  errors.push(...c.errors);
  rules.rules.forEach((r, i) => errors.push(...validateRule(r, ctx, `rules[${i}].`)));
  return errors;
}

/** Heuristic: values that look like secrets/webhook URLs must live in the Credential Vault. */
export function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return true;
  if (/\b(token|secret|password|apikey|api_key)\b/i.test(v)) return true;
  if (/^[A-Za-z0-9_-]{32,}$/.test(v) || /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(v)) return true;
  return false;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateProvider(p: ProviderConfig, prefix = ""): ValidationError[] {
  const c = new Collector();
  c.id(`${prefix}id`, p.id);
  c.name(`${prefix}name`, p.name);
  if (!CHANNELS.includes(p.channel)) c.add(`${prefix}channel`, "Unknown channel");
  if (p.credentialVaultId && !VAULT_ID_RE.test(p.credentialVaultId)) {
    c.add(`${prefix}credentialVaultId`, "Use a Credential Vault entry id (CREDENTIAL_VAULT_ENTRY-… or CREDENTIALS_VAULT-…)");
  }
  if (p.kind === "workflow") {
    const wf = (p.params["workflowId"] ?? "").trim();
    if (wf && !UUID_RE.test(wf)) c.add(`${prefix}params.workflowId`, "Use the workflow's ID (a UUID, shown in the Workflows app URL)");
    if (p.enabled && !wf) c.add(`${prefix}params.workflowId`, "Required to enable the provider");
  } else if (p.enabled && !p.credentialVaultId) c.add(`${prefix}credentialVaultId`, "Required to enable the provider");
  for (const [k, v] of Object.entries(p.params)) {
    if (k === "workflowId" && UUID_RE.test(v.trim())) continue;
    if (looksLikeSecret(v)) c.add(`${prefix}params.${k}`, "Looks like a secret or URL — store it in the Credential Vault");
  }
  if (p.kind === "twilio" && p.enabled && p.params["from"] && !E164_RE.test(p.params["from"].replace(/^whatsapp:/, ""))) {
    c.add(`${prefix}params.from`, "Use an E.164 number, e.g. +15550100000");
  }
  return c.errors;
}

export function validateSettings(s: Settings, ctx: RefContext = {}): ValidationError[] {
  const c = new Collector();
  const lb = s.sources.davisProblems.lookbackHours;
  if (!Number.isFinite(lb) || lb < 1 || lb > 24 * 14) c.add("sources.davisProblems.lookbackHours", "Between 1 and 336 hours");
  if (s.sources.genericEvents.enabled && !s.sources.genericEvents.eventType.trim()) {
    c.add("sources.genericEvents.eventType", "Required");
  }
  if (!isPriority(s.defaults.priority)) c.add("defaults.priority", "Pick a priority");
  for (const [k, v] of Object.entries(s.defaults.priorityBySeverity)) {
    if (!isPriority(v)) c.add(`defaults.priorityBySeverity.${k}`, "Pick a priority");
  }
  for (const [k, v] of Object.entries(s.defaults.priorityByCategory)) {
    if (!isPriority(v)) c.add(`defaults.priorityByCategory.${k}`, "Pick a priority");
  }
  if (s.defaults.policyId && ctx.policies && !ctx.policies.some((p) => p.id === s.defaults.policyId)) {
    c.add("defaults.policyId", "Policy not found");
  }
  if (s.defaults.teamId && ctx.teams && !ctx.teams.some((t) => t.id === s.defaults.teamId)) c.add("defaults.teamId", "Team not found");
  const e = s.engine;
  if (!(e.maxNotificationsPerTick >= 1 && e.maxNotificationsPerTick <= 500)) c.add("engine.maxNotificationsPerTick", "Between 1 and 500");
  if (!(e.reportTimeoutSec >= 30 && e.reportTimeoutSec <= 3600)) c.add("engine.reportTimeoutSec", "Between 30 and 3600 seconds");
  if (!(Number.isInteger(e.maxAttempts) && e.maxAttempts >= 1 && e.maxAttempts <= 10)) c.add("engine.maxAttempts", "Between 1 and 10");
  if (!(e.lockTtlSec >= 30 && e.lockTtlSec <= 600)) c.add("engine.lockTtlSec", "Between 30 and 600 seconds");
  if (e.workflowId && !/^[0-9a-f-]{36}$/i.test(e.workflowId)) c.add("engine.workflowId", "Must be a workflow UUID");
  if (!(s.retention.resolvedVisibleHours >= 1 && s.retention.resolvedVisibleHours <= 24 * 30)) {
    c.add("retention.resolvedVisibleHours", "Between 1 and 720 hours");
  }
  if (!(Number.isInteger(s.retention.archiveDays) && s.retention.archiveDays >= 1 && s.retention.archiveDays <= 90)) {
    c.add("retention.archiveDays", "Between 1 and 90 days (App State TTL limit)");
  }
  if (!(s.ui.autoRefreshSec === 0 || (s.ui.autoRefreshSec >= 5 && s.ui.autoRefreshSec <= 3600))) c.add("ui.autoRefreshSec", "Off, or between 5 and 3600 seconds");
  if (s.ui.timeZone && !isValidTimeZone(s.ui.timeZone)) c.add("ui.timeZone", "Unknown IANA time zone");
  dupIds(c, "providers", s.providers.map((p) => p.id));
  const errors = [...c.errors];
  s.providers.forEach((p, i) => errors.push(...validateProvider(p, `providers[${i}].`)));
  // The engine sends each channel through the first enabled provider of that channel: allow one.
  const byChannel = new Map<string, string>();
  s.providers.forEach((p, i) => {
    if (!p.enabled) return;
    const other = byChannel.get(p.channel);
    if (other) errors.push({ path: `providers[${i}].enabled`, message: `Only one provider per channel can be on: turn off ${other} first` });
    else byChannel.set(p.channel, p.name);
  });
  return errors;
}

export function validateUserContact(u: UserContact): ValidationError[] {
  const c = new Collector();
  if (!u.uid) c.add("uid", "Required");
  if (u.timeZone && !isValidTimeZone(u.timeZone)) c.add("timeZone", "Unknown IANA time zone");
  dupIds(c, "methods", u.methods.map((m) => m.id));
  u.methods.forEach((m, i) => {
    const p = `methods[${i}]`;
    if (!m.id) c.add(`${p}.id`, "Required");
    if (!CHANNELS.includes(m.channel)) c.add(`${p}.channel`, "Unknown channel");
    const addr = (m.address ?? "").trim();
    if (!addr) c.add(`${p}.address`, "Required");
    else if (PHONE_CHANNELS.includes(m.channel) && !E164_RE.test(addr)) c.add(`${p}.address`, "Use E.164, e.g. +15550100000");
    else if (m.channel === "telegram" && !/^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/.test(addr)) c.add(`${p}.address`, "Telegram chat id or @channel");
    else if (addr.length > 200) c.add(`${p}.address`, "Too long");
  });
  u.rules.forEach((r, i) => {
    const p = `rules[${i}]`;
    if (!isPriority(r.maxPriority)) c.add(`${p}.maxPriority`, "Pick a priority");
    if (!u.methods.some((m) => m.id === r.methodId)) c.add(`${p}.methodId`, "Contact method not found");
    c.nonNegInt(`${p}.delayMinutes`, r.delayMinutes, 24 * 60);
  });
  return c.errors;
}
