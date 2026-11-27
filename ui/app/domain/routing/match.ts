/**
 * Routing: ordered rules, first enabled match wins; then defaults.
 *
 * Condition semantics:
 * - Multi-valued fields (entity.*, tag) match when ANY value matches; `negate` inverts the
 *   whole condition result.
 * - equals / contains / in are case-insensitive; `in` takes a comma-separated list.
 * - regex is case-insensitive, pattern ≤ 500 chars, tested against ≤ 1 000 chars; invalid
 *   or potentially catastrophic patterns (see `regexSafetyIssue`) never match and never throw.
 * - lte / gte compare numerically (non-numeric values never match).
 * - exists: the field has at least one non-empty value.
 *
 * Priority derivation (most specific first):
 *   rule.then.priority → cc.priority field → service.defaultPriority →
 *   settings.defaults.priorityBySeverity[severity] → priorityByCategory[category] →
 *   settings.defaults.priority.
 */

import type {
  Alert,
  Priority,
  RoutingRule,
  RuleCondition,
  Service,
  Settings,
  Team,
} from "../contracts";
import { parsePriority } from "../priority";

export const MAX_REGEX_LENGTH = 500;
export const MAX_REGEX_INPUT = 1_000;

export const RULE_FIELDS = [
  "title",
  "description",
  "category",
  "severity",
  "source",
  "sourceStatus",
  "displayId",
  "entity.name",
  "entity.type",
  "entity.id",
  "tag",
  "rootCause.name",
  "rootCause.id",
] as const;

/** All values of a rule field on an alert (`fields.<name>` reads Alert.fields). */
export function fieldValues(alert: Alert, field: string): string[] {
  const opt = (v: string | number | undefined): string[] =>
    v === undefined || v === "" ? [] : [String(v)];
  switch (field) {
    case "title":
      return opt(alert.title);
    case "description":
      return opt(alert.description);
    case "category":
      return opt(alert.category);
    case "severity":
      return opt(alert.severity);
    case "source":
      return opt(alert.source);
    case "sourceStatus":
      return opt(alert.sourceStatus);
    case "displayId":
      return opt(alert.displayId);
    case "entity.name":
      return alert.entities.flatMap((e) => opt(e.name));
    case "entity.type":
      return alert.entities.flatMap((e) => opt(e.type));
    case "entity.id":
      return alert.entities.map((e) => e.id);
    case "tag":
      return alert.tags;
    case "rootCause.name":
      return opt(alert.rootCause?.name);
    case "rootCause.id":
      return opt(alert.rootCause?.id);
    default:
      if (field.startsWith("fields.")) return opt(alert.fields[field.slice("fields.".length)]);
      return [];
  }
}

/**
 * Heuristic ReDoS guard (in the spirit of the "safe-regex" star-height check). Returns a reason
 * when the pattern has:
 * - a quantified group that itself contains a quantifier — `(a+)+`, `(\w*x)*`, `(a{2,})+`;
 * - a quantified group containing alternation — `(a|aa)+`, `(x|y)*`;
 * - a back-reference (`\1`), which defeats linear-time reasoning;
 * - more than 10 quantifiers overall.
 * Conservative: some harmless patterns are rejected; rule authors can rewrite them.
 */
export function regexSafetyIssue(pattern: string): string | undefined {
  if (pattern.length > MAX_REGEX_LENGTH) return `Pattern longer than ${MAX_REGEX_LENGTH} characters`;
  if (/\\[1-9]/.test(pattern) || /\\k</.test(pattern)) return "Back-references are not allowed";
  // Tokenise just enough: skip escapes and character classes.
  const stack: { hasQuant: boolean; hasAlt: boolean }[] = [];
  let quantifiers = 0;
  const isQuant = (i: number): boolean => {
    const c = pattern[i];
    if (c === "*" || c === "+" || c === "?") return true;
    return c === "{" && /^\{\d+(,\d*)?\}/.test(pattern.slice(i));
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") {
      i++;
      while (i < pattern.length && pattern[i] !== "]") {
        if (pattern[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "(") {
      stack.push({ hasQuant: false, hasAlt: false });
      continue;
    }
    if (c === "|") {
      const top = stack[stack.length - 1];
      if (top) top.hasAlt = true;
      continue;
    }
    if (c === ")") {
      const g = stack.pop() ?? { hasQuant: false, hasAlt: false };
      const quantified = isQuant(i + 1);
      // `?` alone (optional group) cannot blow up; only repetition can.
      const repeated = quantified && pattern[i + 1] !== "?";
      if (repeated && g.hasQuant) return "Nested quantifiers (e.g. (a+)+) can take exponential time";
      if (repeated && g.hasAlt) return "Alternation inside a repeated group (e.g. (a|aa)+) can take exponential time";
      const parent = stack[stack.length - 1];
      if (parent && (g.hasQuant || quantified)) parent.hasQuant = true;
      if (parent && g.hasAlt) parent.hasAlt = true;
      continue;
    }
    if (isQuant(i)) {
      // `?` directly after a quantifier makes it lazy — not a new quantifier.
      const prev = pattern[i - 1];
      if (c === "?" && (prev === "*" || prev === "+" || prev === "?" || prev === "}")) continue;
      // `(?:`, `(?=`, `(?!`, `(?<` — group modifiers, not quantifiers.
      if (c === "?" && prev === "(") continue;
      quantifiers++;
      const top = stack[stack.length - 1];
      if (top) top.hasQuant = true;
    }
  }
  if (quantifiers > 10) return "Too many quantifiers";
  return undefined;
}

const regexCache = new Map<string, RegExp | null>();

/** Compile safely (cached); null when invalid, too long or potentially catastrophic. */
export function safeRegex(pattern: string): RegExp | null {
  if (pattern.length > MAX_REGEX_LENGTH) return null;
  if (regexSafetyIssue(pattern)) return null;
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  let re: RegExp | null = null;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = null;
  }
  if (regexCache.size > 500) regexCache.clear();
  regexCache.set(pattern, re);
  return re;
}

function matchOne(value: string, cond: RuleCondition): boolean {
  const target = (cond.value ?? "").trim();
  const v = value.toLowerCase();
  switch (cond.op) {
    case "equals":
      return v === target.toLowerCase();
    case "contains":
      return target !== "" && v.includes(target.toLowerCase());
    case "in":
      return target
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .includes(v);
    case "regex": {
      const re = safeRegex(target);
      return re ? re.test(value.slice(0, MAX_REGEX_INPUT)) : false;
    }
    case "lte":
    case "gte": {
      const a = Number(value);
      const b = Number(target);
      if (value.trim() === "" || target === "" || !Number.isFinite(a) || !Number.isFinite(b)) return false;
      return cond.op === "lte" ? a <= b : a >= b;
    }
    case "exists":
      return value !== "";
    default:
      return false;
  }
}

export function evaluateCondition(alert: Alert, cond: RuleCondition): boolean {
  const values = fieldValues(alert, cond.field);
  const hit = cond.op === "exists" ? values.some((x) => x !== "") : values.some((x) => matchOne(x, cond));
  return cond.negate ? !hit : hit;
}

/** A rule matches when enabled and its conditions hold (no conditions = catch-all). */
export function ruleMatches(alert: Alert, rule: RoutingRule): boolean {
  if (!rule.enabled) return false;
  if (rule.conditions.length === 0) return true;
  return rule.match === "any"
    ? rule.conditions.some((c) => evaluateCondition(alert, c))
    : rule.conditions.every((c) => evaluateCondition(alert, c));
}

/** First enabled matching rule, if any. */
export function firstMatchingRule(alert: Alert, rules: RoutingRule[]): RoutingRule | undefined {
  return rules.find((r) => ruleMatches(alert, r));
}

export interface RouteDecision {
  ruleId?: string;
  serviceId?: string;
  teamId?: string;
  policyId?: string;
  priority: Priority;
  /** Which step of the derivation chain set the priority. */
  prioritySource: "rule" | "alert" | "service" | "severity" | "category" | "default";
  addTags: string[];
  suppress: boolean;
}

export interface RoutingContext {
  rules: RoutingRule[];
  services: Service[];
  teams: Team[];
  settings: Settings;
}

function findService(services: Service[], ref: string | undefined): Service | undefined {
  if (!ref) return undefined;
  const r = ref.trim().toLowerCase();
  return services.find((s) => s.id.toLowerCase() === r) ?? services.find((s) => s.name.toLowerCase() === r);
}

/** Priority from settings defaults only (severity map → category map → default). */
export function defaultPriority(alert: Alert, settings: Settings): { priority: Priority; source: RouteDecision["prioritySource"] } {
  const d = settings.defaults;
  if (alert.severity !== undefined) {
    const p = d.priorityBySeverity[String(alert.severity)];
    if (p) return { priority: p, source: "severity" };
  }
  if (alert.category) {
    const p = d.priorityByCategory[alert.category];
    if (p) return { priority: p, source: "category" };
  }
  return { priority: d.priority, source: "default" };
}

/** Full routing decision for an alert. */
export function routeAlert(alert: Alert, ctx: RoutingContext): RouteDecision {
  const rule = firstMatchingRule(alert, ctx.rules);
  const then = rule?.then ?? {};
  const service =
    findService(ctx.services, then.serviceId) ??
    (then.serviceId ? undefined : findService(ctx.services, alert.fields["cc.service"]));
  const teamId = then.teamId ?? service?.teamId ?? ctx.settings.defaults.teamId;
  const team = teamId ? ctx.teams.find((t) => t.id === teamId) : undefined;
  const policyId =
    then.policyId ?? service?.policyId ?? team?.defaultPolicyId ?? ctx.settings.defaults.policyId;

  let priority: Priority;
  let prioritySource: RouteDecision["prioritySource"];
  const alertPriority = parsePriority(alert.fields["cc.priority"]);
  if (then.priority) {
    priority = then.priority;
    prioritySource = "rule";
  } else if (alertPriority) {
    priority = alertPriority;
    prioritySource = "alert";
  } else if (service?.defaultPriority) {
    priority = service.defaultPriority;
    prioritySource = "service";
  } else {
    const d = defaultPriority(alert, ctx.settings);
    priority = d.priority;
    prioritySource = d.source;
  }

  return {
    ...(rule ? { ruleId: rule.id } : {}),
    ...(service ? { serviceId: service.id } : then.serviceId ? { serviceId: then.serviceId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(policyId ? { policyId } : {}),
    priority,
    prioritySource,
    addTags: [...(then.addTags ?? [])],
    suppress: then.suppress === true,
  };
}
