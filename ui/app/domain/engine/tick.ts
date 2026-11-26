/**
 * Pure engine tick (spec §2 steps 2–9). Lease/heartbeat, DQL and persistence are the caller's.
 *
 * Order:
 *  2. de-duplicate alerts (problem-owned / frequent Davis events, same dedup key)
 *  3. find-or-create incidents, update snapshots, source resolve / re-trigger
 *     — "absent from the query" never resolves anything
 *  4. fold pending operator actions (sorted by at, key) with applyAction; all considered
 *     keys of known incidents are returned for deletion (folding is idempotent anyway)
 *  5. un-snooze due incidents (new cycle)
 *  6. escalation + notification planning for triggered, non-suppressed incidents
 *  7. ledger timeouts → retries (attempt + 1) or final failure timeline entries
 *  8. archive incidents resolved longer than retention.resolvedVisibleHours (unless the
 *     source still reports them ACTIVE, which would re-create them); rollup delta
 *  9. batches by channel, capped at engine.maxNotificationsPerTick (overflow is not written
 *     to the ledger and is re-planned next tick)
 *
 * Determinism: no clock, no randomness; same input → same output. After the caller persists
 * the output, re-running with the same `now` plans zero new notifications.
 */

import type { Stored } from "../../data/repository";
import {
  CHANNELS,
  type Alert,
  type EngineCounts,
  type EscalationPolicy,
  type Incident,
  type IncidentAction,
  type NotificationBatches,
  type NotificationRecord,
  type RoutingRules,
  type Schedule,
  type Service,
  type Settings,
  type Team,
  type UserContact,
} from "../contracts";
import { dedupAlerts } from "../alerts/dedup";
import { advanceEscalation } from "../escalation/machine";
import { describeTarget } from "../escalation/targets";
import { incidentIdFor } from "../ids";
import {
  applyAlertUpdate,
  cloneIncident,
  createIncident,
  foldActions,
  pushTimeline,
  unsnoozeIfDue,
} from "../incidents/actions";
import { incidentIdFromActionKey, utcDay, utcDayCompact } from "../keys";
import { planIncidentNotifications, processLedger, toRequest, type CandidateRequest, type PlanContext } from "../notifications/plan";
import { priorityRank } from "../priority";
import { emptyDelta, rollupRecord, type RollupDelta } from "../reports/metrics";
import { routeAlert } from "../routing/match";
import { pagingState } from "../suppression";
import { HOUR_MS } from "../time/tz";

export interface TickInput {
  now: number;
  settings: Settings;
  teams: Team[];
  schedules: Schedule[];
  policies: EscalationPolicy[];
  services: Service[];
  rules: RoutingRules;
  contacts: UserContact[];
  incidents: Incident[];
  pendingActions: Stored<IncidentAction>[];
  ledger: NotificationRecord[];
  alerts: Alert[];
  /** Absolute app URL for message links, e.g. https://<env>.apps.dynatrace.com/ui/apps/my.command.center */
  appBaseUrl?: string;
}

export interface ArchiveWrite {
  /** yyyymmdd (UTC) of the resolve time — `KEY.archive(day, incident.id)`. */
  day: string;
  incident: Incident;
}

export interface TickOutput {
  /** Incidents to put (`inc.<id>`); excludes archived ones. */
  incidentsToWrite: Incident[];
  /** Archived incidents whose `inc.<id>` key must be deleted (contract addition). */
  incidentIdsToDelete: string[];
  /** Full `act.*` keys to delete. */
  actionKeysToDelete: string[];
  /** Ledger records to put (`ntf.<key>`): new plans, retries and timeout updates. */
  notificationsToWrite: NotificationRecord[];
  batches: NotificationBatches;
  counts: EngineCounts;
  /** Add into `rpt.<day>` with applyRollupDelta. */
  rollupDelta: RollupDelta;
  archives: ArchiveWrite[];
  /** Non-fatal problems (missing policy, no provider…). */
  errors: string[];
  /** Planned requests that did not fit the per-tick cap (re-planned next tick). */
  deferred: number;
}

export const ORPHAN_ACTION_MAX_AGE_MS = 24 * HOUR_MS;
/** Refresh `lastSeenAt` of unchanged incidents at most this often (limits writes). */
export const LAST_SEEN_REFRESH_MS = 10 * 60_000;
export const ARCHIVE_TIMELINE_KEEP = 50;

export function emptyBatches(): NotificationBatches {
  const b = {} as NotificationBatches;
  for (const c of CHANNELS) b[c] = [];
  return b;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Slim copy stored in `arc.*`. */
export function slimIncident(inc: Incident): Incident {
  const c = cloneIncident(inc);
  c.alert = { ...c.alert, fields: {} };
  delete c.alert.description;
  c.timeline = c.timeline.slice(-ARCHIVE_TIMELINE_KEEP);
  return c;
}

export function tick(input: TickInput): TickOutput {
  const { now, settings } = input;
  const errors: string[] = [];
  const counts: EngineCounts = {
    alertsFetched: input.alerts.length,
    incidentsCreated: 0,
    incidentsResolved: 0,
    actionsFolded: 0,
    notificationsPlanned: 0,
    notificationsRetried: 0,
  };
  const delta = emptyDelta(utcDay(now));
  const original = new Map<string, Incident>();
  const current = new Map<string, Incident>();
  for (const inc of input.incidents) {
    original.set(inc.id, inc);
    current.set(inc.id, inc);
  }
  const touched = new Set<string>();
  const set = (inc: Incident) => {
    current.set(inc.id, inc);
    touched.add(inc.id);
  };

  // 2. dedup
  const { alerts } = dedupAlerts(input.alerts);

  // 3. ingest
  const routingCtx = { rules: input.rules.rules, services: input.services, teams: input.teams, settings };
  const sortedAlerts = [...alerts].sort((a, b) => (a.dedupKey < b.dedupKey ? -1 : a.dedupKey > b.dedupKey ? 1 : 0));
  const seenActive = new Set<string>();
  for (const alert of sortedAlerts) {
    const id = incidentIdFor(alert);
    if (alert.sourceStatus === "ACTIVE") seenActive.add(id);
    const existing = current.get(id);
    if (!existing) {
      if (alert.sourceStatus === "CLOSED") {
        const end = alert.endedAt ?? now;
        if (end < now - settings.retention.resolvedVisibleHours * HOUR_MS) continue;
      }
      const inc = createIncident(alert, routeAlert(alert, routingCtx), now);
      set(inc);
      counts.incidentsCreated++;
      rollupRecord.created(delta, inc);
      if (inc.status === "resolved") {
        counts.incidentsResolved++;
        rollupRecord.resolved(delta, inc);
      }
      continue;
    }
    const { incident, change } = applyAlertUpdate(existing, alert, now);
    if (change === "resolved") {
      counts.incidentsResolved++;
      rollupRecord.resolved(delta, incident);
    }
    const snapshotChanged = !sameJson(existing.alert, alert);
    if (change || snapshotChanged || now - existing.lastSeenAt >= LAST_SEEN_REFRESH_MS) set(incident);
  }

  // 4. fold operator actions
  const actionKeysToDelete: string[] = [];
  const byIncident = new Map<string, Stored<IncidentAction>[]>();
  for (const a of input.pendingActions) {
    const incId = a.value?.incidentId ?? incidentIdFromActionKey(a.key);
    if (!incId || !current.has(incId)) {
      const at = a.value?.at ?? a.lastModifiedTime ?? now;
      if (now - at > ORPHAN_ACTION_MAX_AGE_MS) actionKeysToDelete.push(a.key);
      continue;
    }
    const list = byIncident.get(incId);
    if (list) list.push(a);
    else byIncident.set(incId, [a]);
  }
  for (const [incId, list] of [...byIncident.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const before = current.get(incId);
    if (!before) continue;
    const r = foldActions(before, list, now);
    actionKeysToDelete.push(...r.foldedKeys);
    counts.actionsFolded += r.applied;
    if (r.applied > 0) {
      const after = r.incident;
      if (before.status !== "acknowledged" && after.status === "acknowledged") rollupRecord.acknowledged(delta, after);
      if (before.status !== "resolved" && after.status === "resolved") {
        counts.incidentsResolved++;
        rollupRecord.resolved(delta, after);
      }
      set(after);
    }
  }

  // 5. un-snooze
  for (const inc of current.values()) {
    const u = unsnoozeIfDue(inc, now);
    if (u !== inc) set(u);
  }

  // 6. escalation & planning
  const ledgerKeys = new Set(input.ledger.map((r) => r.key));
  const planCtx: PlanContext = {
    now,
    settings,
    schedules: input.schedules,
    teams: input.teams,
    services: input.services,
    contacts: input.contacts,
    ...(input.appBaseUrl ? { appBaseUrl: input.appBaseUrl } : {}),
  };
  const candidates: CandidateRequest[] = [];
  const ids = [...current.keys()].sort();
  for (const id of ids) {
    let inc = current.get(id);
    if (!inc || inc.status !== "triggered") continue;
    const team = input.teams.find((t) => t.id === inc?.teamId);
    const ps = pagingState(inc, team, settings, now);
    if (inc.suppressed !== ps.suppressed) {
      const next = cloneIncident(inc);
      const wasHeld = inc.suppressed === "maintenance" || inc.suppressed === "quiet-hours";
      if (ps.suppressed) next.suppressed = ps.suppressed;
      else delete next.suppressed;
      pushTimeline(next, {
        at: now,
        type: ps.suppressed ? "suppressed" : "unsuppressed",
        by: "system",
        detail: ps.suppressed ? `Paging suppressed (${ps.suppressed})` : "Paging resumed",
        ...(ps.suppressed ? { data: { reason: ps.suppressed } } : {}),
      });
      // Paging held before anything fired: delays count from when paging resumes.
      if (wasHeld && ps.page && next.escalation.lastStepIndex < 0) next.escalation.startedAt = now;
      inc = next;
      set(inc);
    }
    if (!ps.page) continue;
    const policy = inc.policyId ? input.policies.find((p) => p.id === inc?.policyId) : undefined;
    if (!policy) {
      if (inc.policyId) errors.push(`Incident ${inc.id}: escalation policy ${inc.policyId} not found`);
      continue;
    }
    const adv = advanceEscalation(inc, policy, now);
    if (adv.newlyDue.length > 0 || adv.becameExhausted) {
      const next = cloneIncident(inc);
      next.escalation = adv.progress;
      for (const f of adv.newlyDue) {
        pushTimeline(next, {
          at: now,
          type: "escalation_step",
          by: "system",
          detail: `Step ${f.stepIndex + 1}${f.pass > 0 ? ` (repeat ${f.pass})` : ""}: ${f.step.targets
            .map((t) => describeTarget(t, { schedules: input.schedules, teams: input.teams }))
            .join(", ")}`,
          data: { ordinal: f.ordinal, stepIndex: f.stepIndex, pass: f.pass, cycle: next.escalation.cycle },
        });
      }
      if (adv.becameExhausted) {
        pushTimeline(next, {
          at: now,
          type: "escalation_exhausted",
          by: "system",
          detail: `Policy ${policy.name} exhausted without acknowledgement`,
          data: { cycle: next.escalation.cycle },
        });
      }
      inc = next;
      set(inc);
    }
    const plan = planIncidentNotifications(
      inc,
      adv.due,
      planCtx,
      ledgerKeys,
      ps.allowedChannels,
      new Set(adv.newlyDue.map((f) => f.ordinal)),
    );
    candidates.push(...plan.candidates);
    if (plan.issues.length > 0) {
      const next = cloneIncident(inc);
      for (const issue of plan.issues) {
        errors.push(`Incident ${issue.incidentId}: ${issue.detail}`);
        pushTimeline(next, {
          at: now,
          type: "notification_skipped",
          by: "system",
          detail: issue.detail,
          data: { reason: issue.reason, ...(issue.uid ? { uid: issue.uid } : {}) },
        });
      }
      set(next);
    }
  }

  // 7. ledger failure path
  const ledgerOutcome = processLedger(input.ledger, current, settings, now);
  for (const f of ledgerOutcome.finalFailures) {
    const inc = current.get(f.incidentId);
    if (!inc) continue;
    if (inc.timeline.some((e) => e.type === "notification_failed" && e.data?.["key"] === f.key && e.data?.["final"] === true)) {
      continue;
    }
    const next = cloneIncident(inc);
    pushTimeline(next, {
      at: now,
      type: "notification_failed",
      by: "system",
      detail: `${f.channel} to ${f.to.name ?? f.to.uid} failed after ${f.attempt} attempt(s)${f.error ? `: ${f.error}` : ""}`,
      data: { key: f.key, final: true, channel: f.channel, uid: f.to.uid, attempt: f.attempt },
    });
    set(next);
  }

  // 9 (cap) — priority first, then due time, then key.
  const all = [...ledgerOutcome.retries.map((c) => ({ ...c, retry: true })), ...candidates.map((c) => ({ ...c, retry: false }))];
  const seenKeys = new Set<string>();
  const unique = all.filter((c) => (seenKeys.has(c.record.key) ? false : (seenKeys.add(c.record.key), true)));
  unique.sort(
    (a, b) =>
      priorityRank(a.record.priority) - priorityRank(b.record.priority) ||
      a.dueAt - b.dueAt ||
      (a.record.key < b.record.key ? -1 : a.record.key > b.record.key ? 1 : 0),
  );
  const cap = Math.max(0, Math.floor(settings.engine.maxNotificationsPerTick));
  const accepted = unique.slice(0, cap);
  const deferred = unique.length - accepted.length;
  const batches = emptyBatches();
  const notificationsToWrite: NotificationRecord[] = [...ledgerOutcome.updated];
  const plannedByIncident = new Map<string, NotificationRecord[]>();
  for (const c of accepted) {
    notificationsToWrite.push(c.record);
    batches[c.record.channel].push(toRequest(c.record));
    if (c.retry) counts.notificationsRetried++;
    else {
      counts.notificationsPlanned++;
      rollupRecord.page(delta, c.record.to.uid);
    }
    const l = plannedByIncident.get(c.record.incidentId);
    if (l) l.push(c.record);
    else plannedByIncident.set(c.record.incidentId, [c.record]);
  }
  for (const [incId, recs] of plannedByIncident) {
    const inc = current.get(incId);
    if (!inc) continue;
    const next = cloneIncident(inc);
    for (const r of recs) {
      pushTimeline(next, {
        at: now,
        type: "notification_planned",
        by: "system",
        detail: `${r.channel} → ${r.to.name ?? r.to.uid}${r.attempt > 1 ? ` (attempt ${r.attempt})` : ""}`,
        data: { key: r.key, channel: r.channel, uid: r.to.uid, attempt: r.attempt },
      });
    }
    set(next);
  }
  if (deferred > 0) errors.push(`${deferred} notification(s) deferred by maxNotificationsPerTick=${cap}`);

  // 8. archive
  const archives: ArchiveWrite[] = [];
  const incidentIdsToDelete: string[] = [];
  const visibleMs = Math.max(0, settings.retention.resolvedVisibleHours) * HOUR_MS;
  for (const id of [...current.keys()].sort()) {
    const inc = current.get(id);
    if (!inc || inc.status !== "resolved" || inc.resolvedAt === undefined) continue;
    if (inc.resolvedAt > now - visibleMs) continue;
    // Still ACTIVE in the source (operator-resolved): keep it, or it would be re-created.
    if (seenActive.has(id)) continue;
    archives.push({ day: utcDayCompact(inc.resolvedAt), incident: slimIncident(inc) });
    touched.delete(id);
    if (original.has(id)) incidentIdsToDelete.push(id);
  }

  const incidentsToWrite = [...touched].sort().map((id) => current.get(id)).filter((x): x is Incident => !!x);

  return {
    incidentsToWrite,
    incidentIdsToDelete,
    actionKeysToDelete: Array.from(new Set(actionKeysToDelete)).sort(),
    notificationsToWrite,
    batches,
    counts,
    rollupDelta: delta,
    archives,
    errors,
    deferred,
  };
}
