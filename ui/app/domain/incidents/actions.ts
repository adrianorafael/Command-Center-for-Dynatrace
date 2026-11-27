/**
 * Incident reducer shared by the engine (folding `act.*` records) and the UI (optimistic view).
 *
 * Guarantees:
 * - Pure: returns a new Incident, never mutates the input.
 * - Idempotent: when an `actionId` (the stored `act.*` key) is given, an action already
 *   folded (its id is recorded in a timeline entry) is a no-op — a failed delete cannot
 *   double-fold. Actions that are not applied (stale / not applicable) leave an
 *   "action_ignored" timeline entry so the operator sees why.
 * - "escalate" keeps the cycle and asks the engine to fire the next step immediately.
 * - Order-tolerant: actions are folded sorted by (at, key). A status action (ack, unack,
 *   resolve, reopen, snooze, escalate) whose `at` is older than the last status change made
 *   by another operator action is stale and ignored — so the outcome is the same whether
 *   actions arrive in one tick or across several ticks (last-writer-wins by operator time).
 *   Engine/source-driven changes (source resolve/reopen, snooze expiry) do not make human
 *   actions stale, which avoids losing an ack to client clock skew.
 * - Every state-restarting transition (unack, reopen, snooze expiry, source reopen) starts a
 *   new escalation cycle at `now` (cycle + 1), so elapsed steps never fire
 *   all at once and notification keys never collide with the previous cycle.
 */

import type { Stored } from "../../data/repository";
import {
  SCHEMA_VERSION,
  TIMELINE_CAP,
  type Alert,
  type Incident,
  type IncidentAction,
  type TimelineEntry,
} from "../contracts";
import { incidentIdFor } from "../ids";
import type { RouteDecision } from "../routing/match";
import { setEngineState } from "./meta";

export const MAX_NOTE_LENGTH = 4000;
export const UNKNOWN_ACTOR = "unknown";

const STATUS_ACTIONS = new Set<IncidentAction["type"]>([
  "ack",
  "unack",
  "resolve",
  "reopen",
  "snooze",
  "escalate",
]);

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Copy with fresh arrays/objects for the parts reducers touch. */
export function cloneIncident(inc: Incident): Incident {
  return {
    ...inc,
    alert: { ...inc.alert },
    tags: [...inc.tags],
    escalation: { ...inc.escalation },
    timeline: [...inc.timeline],
    ...(inc.assignee ? { assignee: { ...inc.assignee } } : {}),
  };
}

/** Append to the timeline, capping at TIMELINE_CAP (oldest dropped, the 'created' entry kept). */
export function pushTimeline(inc: Incident, entry: TimelineEntry): void {
  inc.timeline.push(entry);
  if (inc.timeline.length > TIMELINE_CAP) {
    const createdIdx = inc.timeline.findIndex((e) => e.type === "created");
    const excess = inc.timeline.length - TIMELINE_CAP;
    if (createdIdx === 0) inc.timeline.splice(1, excess);
    else inc.timeline.splice(0, excess);
  }
}

/** Start a new escalation cycle at `now`. */
export function restartEscalation(inc: Incident, now: number): void {
  inc.escalation = {
    cycle: inc.escalation.cycle + 1,
    startedAt: now,
    lastStepIndex: -1,
    repeatsDone: 0,
    exhausted: false,
  };
}

function wasFolded(inc: Incident, actionId: string): boolean {
  return inc.timeline.some((e) => e.data?.["actionId"] === actionId);
}

function lastStatusActionAt(inc: Incident): number {
  let max = -Infinity;
  for (const e of inc.timeline) if (e.data?.["statusAction"] === true && e.at > max) max = e.at;
  return max;
}

function clearAck(inc: Incident): void {
  delete inc.acknowledgedAt;
  delete inc.acknowledgedBy;
}

// ─── applyAction ─────────────────────────────────────────────────────────────

export interface ApplyOptions {
  /** Stable identity of the action (its `act.*` key) — enables idempotent folding. */
  actionId?: string;
}

export interface ApplyResult {
  incident: Incident;
  applied: boolean;
  /** Why an action was not applied: duplicate, stale, not-applicable. */
  reason?: "duplicate" | "stale" | "not-applicable" | "wrong-incident";
}

/** Apply one operator action; detailed result. */
export function applyActionDetailed(
  incident: Incident,
  action: IncidentAction,
  by: string,
  now: number,
  opts: ApplyOptions = {},
): ApplyResult {
  if (action.incidentId !== incident.id) {
    return { incident, applied: false, reason: "wrong-incident" };
  }
  if (opts.actionId && wasFolded(incident, opts.actionId)) {
    return { incident, applied: false, reason: "duplicate" };
  }
  // Never trust a client clock beyond the server's: clamp to ≤ now (callers also clamp to the
  // record's server lastModifiedTime), so a future-dated action cannot freeze the status.
  if (action.at > now) action = { ...action, at: now };
  const actor = by || UNKNOWN_ACTOR;
  /** Not applied: keep an audit entry (only for stored actions, which have an identity). */
  const ignored = (reason: "stale" | "not-applicable", why: string): ApplyResult => {
    if (!opts.actionId) return { incident, applied: false, reason };
    const copy = cloneIncident(incident);
    pushTimeline(copy, {
      at: action.at,
      type: "action_ignored",
      by: actor,
      detail: `${action.type}: ${why}`,
      data: { actionId: opts.actionId, action: action.type, reason },
    });
    return { incident: copy, applied: false, reason };
  };
  const isStatus = STATUS_ACTIONS.has(action.type);
  if (isStatus && action.at < lastStatusActionAt(incident)) {
    return ignored("stale", "superseded by a newer operator action");
  }
  const inc = cloneIncident(incident);
  const data: Record<string, string | number | boolean> = {};
  if (opts.actionId) data["actionId"] = opts.actionId;
  if (isStatus) data["statusAction"] = true;
  const entry = (type: string, detail?: string, extra?: Record<string, string | number | boolean>) =>
    pushTimeline(inc, {
      at: action.at,
      type,
      by: actor,
      ...(detail ? { detail } : {}),
      data: { ...data, ...(extra ?? {}) },
    });
  const notApplicable = (): ApplyResult => ignored("not-applicable", `not applicable while ${incident.status}`);

  switch (action.type) {
    case "ack":
      if (inc.status !== "triggered" && inc.status !== "snoozed") return notApplicable();
      inc.status = "acknowledged";
      inc.acknowledgedAt = action.at;
      inc.acknowledgedBy = actor;
      delete inc.snoozedUntil;
      entry("acknowledged");
      break;
    case "unack":
      if (inc.status !== "acknowledged") return notApplicable();
      inc.status = "triggered";
      clearAck(inc);
      restartEscalation(inc, now);
      entry("unacknowledged", undefined, { cycle: inc.escalation.cycle });
      break;
    case "resolve":
      if (inc.status === "resolved") return notApplicable();
      inc.status = "resolved";
      inc.resolvedAt = action.at;
      inc.resolvedBy = actor;
      delete inc.snoozedUntil;
      entry("resolved");
      break;
    case "reopen":
      if (inc.status !== "resolved") return notApplicable();
      inc.status = "triggered";
      delete inc.resolvedAt;
      delete inc.resolvedBy;
      clearAck(inc);
      restartEscalation(inc, now);
      entry("reopened", undefined, { cycle: inc.escalation.cycle });
      break;
    case "snooze":
      if (inc.status === "resolved") return notApplicable();
      if (!(Number.isFinite(action.until) && action.until > action.at)) return notApplicable();
      inc.status = "snoozed";
      inc.snoozedUntil = action.until;
      clearAck(inc);
      entry("snoozed", undefined, { until: action.until });
      break;
    case "escalate":
      // Fires the NEXT step of the current cycle immediately (the engine shifts the clock).
      if (inc.status === "resolved") return notApplicable();
      inc.status = "triggered";
      clearAck(inc);
      delete inc.snoozedUntil;
      setEngineState(inc, { escalateRequestedAt: now });
      entry("escalated", "Escalated manually — next step now", { cycle: inc.escalation.cycle });
      break;
    case "reassign": {
      const a = action.assignee;
      if (!a || !a.id) return notApplicable();
      inc.assignee = { type: a.type, id: a.id };
      entry("reassigned", `${a.type}:${a.id}`, { assigneeType: a.type, assigneeId: a.id });
      break;
    }
    case "priority":
      if (inc.priority === action.priority) return notApplicable();
      entry("priority", `${inc.priority} → ${action.priority}`, { from: inc.priority, to: action.priority });
      inc.priority = action.priority;
      break;
    case "note": {
      const text = (action.text ?? "").trim();
      if (!text) return notApplicable();
      entry("note", text.slice(0, MAX_NOTE_LENGTH));
      break;
    }
    case "tag": {
      const add = (action.add ?? []).map((t) => t.trim()).filter(Boolean);
      const remove = new Set((action.remove ?? []).map((t) => t.trim()));
      const before = inc.tags.join("\u0000");
      inc.tags = inc.tags.filter((t) => !remove.has(t));
      for (const t of add) if (!inc.tags.includes(t)) inc.tags.push(t);
      if (inc.tags.join("\u0000") === before) return notApplicable();
      entry("tag", [...add.map((t) => `+${t}`), ...[...remove].map((t) => `-${t}`)].join(" "));
      break;
    }
    default:
      return notApplicable();
  }
  return { incident: inc, applied: true };
}

/** Apply one operator action (returns the new incident; unchanged when not applicable). */
export function applyAction(
  incident: Incident,
  action: IncidentAction,
  by: string,
  now: number,
  opts: ApplyOptions = {},
): Incident {
  return applyActionDetailed(incident, action, by, now, opts).incident;
}

// ─── folding ─────────────────────────────────────────────────────────────────

type PendingAction = Stored<IncidentAction> | IncidentAction;

function isStored(a: PendingAction): a is Stored<IncidentAction> {
  return typeof (a as Stored<IncidentAction>).key === "string" && "value" in a;
}

interface Normalised {
  key: string;
  action: IncidentAction;
  by: string;
}

/**
 * Stored actions are ordered and stale-checked by SERVER time: when App State reports the
 * record's `lastModifiedTime`, it replaces the client's `at` (a client clock in the future or
 * past cannot reorder or freeze anything). Without it, `at` is used (clamped to ≤ now later).
 */
function normalise(a: PendingAction): Normalised {
  if (isStored(a)) {
    const server = a.lastModifiedTime;
    const action = server !== undefined && Number.isFinite(server) && a.value.at !== server ? { ...a.value, at: server } : a.value;
    return { key: a.key, action, by: a.lastModifiedBy ?? a.value.by ?? UNKNOWN_ACTOR };
  }
  return { key: `${a.at}.${a.clientId}.${a.type}`, action: a, by: a.by ?? UNKNOWN_ACTOR };
}

/** Same ordering the engine uses: by (server-clamped) `at`, then key. */
export function sortActions<T extends PendingAction>(actions: T[]): T[] {
  return [...actions].sort((x, y) => {
    const a = normalise(x);
    const b = normalise(y);
    return a.action.at - b.action.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
}

export interface FoldResult {
  incident: Incident;
  /** Keys of the actions considered (all, applied or not — they can be deleted). */
  foldedKeys: string[];
  applied: number;
  /** True when the incident changed (applied actions or action_ignored audit entries). */
  changed: boolean;
}

/** Fold pending actions (any order) into the incident. */
export function foldActions(incident: Incident, actions: PendingAction[], now: number): FoldResult {
  let inc = incident;
  let applied = 0;
  let changed = false;
  const foldedKeys: string[] = [];
  for (const a of sortActions(actions)) {
    const n = normalise(a);
    if (n.action.incidentId !== incident.id) continue;
    foldedKeys.push(n.key);
    const r = applyActionDetailed(inc, n.action, n.by, now, isStored(a) ? { actionId: n.key } : {});
    inc = r.incident;
    if (r.reason === "stale" || r.reason === "not-applicable") changed = changed || r.incident !== incident;
    if (r.applied) applied++;
  }
  return { incident: inc, foldedKeys, applied, changed: changed || applied > 0 };
}

/**
 * Incident as the UI should show it: stored incident + pending (unfolded) actions, using the
 * same reducer as the engine. `now` defaults to the newest action time.
 */
export function effectiveIncident(incident: Incident, pendingActions: PendingAction[], now?: number): Incident {
  const mine = pendingActions.filter((a) => normalise(a).action.incidentId === incident.id);
  if (mine.length === 0) return incident;
  const t = now ?? Math.max(...mine.map((a) => normalise(a).action.at));
  return foldActions(incident, mine, t).incident;
}

// ─── creation and source/engine transitions ──────────────────────────────────

/** New incident for an alert and its routing decision. */
export function createIncident(alert: Alert, route: RouteDecision, now: number): Incident {
  const tags = [...alert.tags];
  for (const t of route.addTags) if (!tags.includes(t)) tags.push(t);
  const closed = alert.sourceStatus === "CLOSED";
  const inc: Incident = {
    schemaVersion: SCHEMA_VERSION,
    id: incidentIdFor(alert),
    alert,
    status: closed ? "resolved" : "triggered",
    priority: route.priority,
    ...(route.serviceId ? { serviceId: route.serviceId } : {}),
    ...(route.teamId ? { teamId: route.teamId } : {}),
    ...(route.policyId ? { policyId: route.policyId } : {}),
    ...(route.ruleId ? { ruleId: route.ruleId } : {}),
    ...(route.teamId ? { assignee: { type: "team" as const, id: route.teamId } } : {}),
    createdAt: now,
    ...(closed ? { resolvedAt: alert.endedAt ?? now, resolvedBy: "source" } : {}),
    tags,
    ...(route.suppress ? { suppressed: "rule" as const } : {}),
    escalation: { cycle: 1, startedAt: now, lastStepIndex: -1, repeatsDone: 0, exhausted: false },
    timeline: [],
    lastSeenAt: now,
  };
  pushTimeline(inc, {
    at: now,
    type: "created",
    by: "source",
    detail: alert.title,
    data: { source: alert.source, sourceId: alert.sourceId },
  });
  const routeData: Record<string, string | number | boolean> = {
    priority: route.priority,
    prioritySource: route.prioritySource,
  };
  if (route.ruleId) routeData["ruleId"] = route.ruleId;
  if (route.serviceId) routeData["serviceId"] = route.serviceId;
  if (route.teamId) routeData["teamId"] = route.teamId;
  if (route.policyId) routeData["policyId"] = route.policyId;
  pushTimeline(inc, {
    at: now,
    type: "routed",
    by: "system",
    detail: route.ruleId ? `Matched rule ${route.ruleId}` : "Default routing",
    data: routeData,
  });
  if (route.suppress) {
    pushTimeline(inc, { at: now, type: "suppressed", by: "system", detail: "Suppressed by routing rule", data: { reason: "rule" } });
  }
  if (closed) {
    pushTimeline(inc, { at: now, type: "resolved", by: "source", detail: "Closed in source" });
  }
  return inc;
}

export type SourceChange = "resolved" | "reopened" | undefined;

/**
 * Update the alert snapshot from a fresh source record and apply source-driven transitions:
 * - ACTIVE → CLOSED in the source resolves an open incident (resolvedBy "source"). Only the
 *   transition counts, so an operator re-opening a source-closed incident is respected.
 * - A resolved incident re-triggers (new cycle) when the source is ACTIVE with a newer
 *   reopen timestamp than both the previous snapshot and the resolve time, or when the
 *   source itself had closed it and is ACTIVE again.
 * Absence from a query never resolves anything — this is only called for present alerts.
 */
export function applyAlertUpdate(incident: Incident, alert: Alert, now: number): { incident: Incident; change: SourceChange } {
  const prev = incident.alert;
  const inc = cloneIncident(incident);
  inc.alert = alert;
  inc.lastSeenAt = now;
  let change: SourceChange;
  if (alert.sourceStatus === "CLOSED") {
    if (prev.sourceStatus === "ACTIVE" && inc.status !== "resolved") {
      inc.status = "resolved";
      inc.resolvedAt = alert.endedAt && alert.endedAt <= now ? alert.endedAt : now;
      inc.resolvedBy = "source";
      delete inc.snoozedUntil;
      pushTimeline(inc, { at: now, type: "resolved", by: "source", detail: "Closed in source" });
      change = "resolved";
    }
  } else if (inc.status === "resolved") {
    const newer =
      alert.reopenedAt !== undefined &&
      alert.reopenedAt > Math.max(prev.reopenedAt ?? 0, inc.resolvedAt ?? 0);
    const sourceReactivated = inc.resolvedBy === "source" && prev.sourceStatus === "CLOSED";
    if (newer || sourceReactivated) {
      inc.status = "triggered";
      delete inc.resolvedAt;
      delete inc.resolvedBy;
      clearAck(inc);
      restartEscalation(inc, now);
      pushTimeline(inc, {
        at: now,
        type: "reopened",
        by: "source",
        detail: "Re-triggered by source",
        data: { cycle: inc.escalation.cycle },
      });
      change = "reopened";
    }
  }
  return { incident: inc, change };
}

/** Snooze expiry: snoozed with snoozedUntil ≤ now → triggered, new cycle. */
export function unsnoozeIfDue(incident: Incident, now: number): Incident {
  if (incident.status !== "snoozed" || incident.snoozedUntil === undefined || incident.snoozedUntil > now) {
    return incident;
  }
  const inc = cloneIncident(incident);
  inc.status = "triggered";
  delete inc.snoozedUntil;
  restartEscalation(inc, now);
  pushTimeline(inc, { at: now, type: "unsnoozed", by: "system", data: { cycle: inc.escalation.cycle } });
  return inc;
}

/** Is the incident currently open (not resolved)? */
export function isOpen(inc: Incident): boolean {
  return inc.status !== "resolved";
}
