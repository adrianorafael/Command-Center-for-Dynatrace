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
 *  8. archive incidents resolved longer than retention.resolvedVisibleHours once their alert
 *     was absent from ARCHIVE_ABSENT_TICKS consecutive OK source queries (failed/truncated
 *     queries never count); archived ids passed back in are not resurrected; rollup delta
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
  type AlertSource,
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
import { advanceEscalation, doneOrdinal, firingFor, totalOrdinals } from "../escalation/machine";
import { describeTarget } from "../escalation/targets";
import { incidentIdFor } from "../ids";
import {
  applyAlertUpdate,
  cloneIncident,
  createIncident,
  foldActions,
  pushTimeline,
  restartEscalation,
  unsnoozeIfDue,
} from "../incidents/actions";
import { engineState, setEngineState } from "../incidents/meta";
import { incidentIdFromActionKey, utcDay, utcDayCompact } from "../keys";
import {
  buildPagedIndex,
  planIncidentNotifications,
  processLedger,
  toRequest,
  type CandidateRequest,
  type PlanContext,
} from "../notifications/plan";
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
  /**
   * Outcome of each source query this tick (missing = "ok"). Incidents of a source whose
   * query "failed" or was "truncated" are never counted absent and never archived.
   */
  sourceStatus?: Partial<Record<AlertSource, SourceQueryStatus>>;
  /**
   * Incidents already archived (`arc.*`), so a still-returned alert does not resurrect them.
   * Map form: id → resolvedAt (or an upper bound, e.g. the end of the archive key's UTC day —
   * see `archiveResolvedBound`). Set form: the bound is `now − resolvedVisibleHours` (always
   * ≥ the real resolvedAt, because archiving happens only after that window).
   * An archived incident is re-created only when its alert is ACTIVE with
   * `reopenedAt` newer than that bound.
   */
  archived?: ReadonlySet<string> | ReadonlyMap<string, number>;
}

export type SourceQueryStatus = "ok" | "failed" | "truncated";

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
/** A resolved incident is archived only after its alert was absent from this many consecutive OK queries. */
export const ARCHIVE_ABSENT_TICKS = 3;

/** Upper bound of the resolve time encoded in an `arc.<yyyymmdd>.<id>` key (end of that UTC day). */
export function archiveResolvedBound(archiveKey: string): { id: string; bound: number } | undefined {
  const m = /^arc\.(\d{4})(\d{2})(\d{2})\.(.+)$/.exec(archiveKey);
  if (!m) return undefined;
  const bound = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1) - 1;
  return { id: m[4] ?? "", bound };
}

function isArchiveMap(a: ReadonlySet<string> | ReadonlyMap<string, number>): a is ReadonlyMap<string, number> {
  return typeof (a as ReadonlyMap<string, number>).get === "function";
}

function maxLedgerCycle(ledger: readonly NotificationRecord[], incidentId: string): number {
  let max = 0;
  for (const r of ledger) if (r.incidentId === incidentId && r.cycle > max) max = r.cycle;
  return max;
}

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
  const archived = input.archived;
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
  const seenInTick = new Set<string>();
  for (const alert of sortedAlerts) {
    const id = incidentIdFor(alert);
    seenInTick.add(id);
    const existing = current.get(id);
    if (!existing) {
      if (alert.sourceStatus === "CLOSED") {
        const end = alert.endedAt ?? now;
        if (end < now - settings.retention.resolvedVisibleHours * HOUR_MS) continue;
      }
      let revived = false;
      if (archived?.has(id)) {
        // Archived: only a genuinely newer re-trigger brings it back.
        const bound: number = isArchiveMap(archived)
          ? (archived.get(id) ?? Infinity)
          : now - settings.retention.resolvedVisibleHours * HOUR_MS;
        if (!(alert.sourceStatus === "ACTIVE" && alert.reopenedAt !== undefined && alert.reopenedAt > bound)) continue;
        revived = true;
      }
      const inc = createIncident(alert, routeAlert(alert, routingCtx), now);
      // A re-created id must not collide with ledger keys of its earlier life.
      const prevCycle = maxLedgerCycle(input.ledger, id);
      if (prevCycle >= inc.escalation.cycle) inc.escalation.cycle = prevCycle + 1;
      if (revived) {
        pushTimeline(inc, { at: now, type: "reopened", by: "source", detail: "Re-triggered after it was archived", data: { cycle: inc.escalation.cycle } });
      }
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
    const wasAbsent = engineState(existing).absentTicks !== undefined;
    if (wasAbsent) setEngineState(incident, { absentTicks: undefined });
    if (change || snapshotChanged || wasAbsent || now - existing.lastSeenAt >= LAST_SEEN_REFRESH_MS) set(incident);
  }

  // 4. fold operator actions
  const actionKeysToDelete: string[] = [];
  const byIncident = new Map<string, Stored<IncidentAction>[]>();
  for (const a of input.pendingActions) {
    const incId = a.value?.incidentId ?? incidentIdFromActionKey(a.key);
    if (!incId || !current.has(incId)) {
      const at = Math.min(a.value?.at ?? now, a.lastModifiedTime ?? now, now);
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
    if (r.changed) {
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
  const pagedIndex = buildPagedIndex(input.ledger);
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
    const update = (fn: (next: Incident) => void): Incident => {
      const next = cloneIncident(inc as Incident);
      fn(next);
      set(next);
      inc = next;
      return next;
    };
    if (inc.suppressed !== ps.suppressed) {
      update((next) => {
        if (ps.suppressed) next.suppressed = ps.suppressed;
        else delete next.suppressed;
        pushTimeline(next, {
          at: now,
          type: ps.suppressed ? "suppressed" : "unsuppressed",
          by: "system",
          detail: ps.suppressed ? `Paging suppressed (${ps.suppressed})` : "Paging resumed",
          ...(ps.suppressed ? { data: { reason: ps.suppressed } } : {}),
        });
      });
    }
    // Paging hold (maintenance / quiet-hours hold) pauses the escalation clock: on resume,
    // startedAt moves forward by the held time, so nothing that "elapsed" while held bursts out.
    const held = !ps.page && (ps.suppressed === "maintenance" || ps.suppressed === "quiet-hours");
    const heldSince = engineState(inc).heldSince;
    if (held && heldSince === undefined) {
      update((next) => setEngineState(next, { heldSince: now }));
    } else if (!held && heldSince !== undefined) {
      update((next) => {
        next.escalation = { ...next.escalation, startedAt: next.escalation.startedAt + Math.max(0, now - heldSince) };
        setEngineState(next, { heldSince: undefined });
      });
    }
    if (!ps.page) continue;

    // Policy: the incident's, else its team's default, else the current settings default.
    const policyIds = [inc.policyId, team?.defaultPolicyId, settings.defaults.policyId].filter((x): x is string => !!x);
    const policy = policyIds.map((pid) => input.policies.find((p) => p.id === pid)).find((p) => !!p);
    if (!policy) {
      const cycle = inc.escalation.cycle;
      const already = inc.timeline.some(
        (e) => e.type === "notification_skipped" && e.data?.["reason"] === "no-policy" && e.data?.["cycle"] === cycle,
      );
      if (!already) {
        const detail = inc.policyId
          ? `Escalation policy ${inc.policyId} not found and no default policy is configured — nobody is paged`
          : "No escalation policy (incident, team or settings default) — nobody is paged";
        errors.push(`Incident ${inc.id}: ${detail}`);
        update((next) => pushTimeline(next, { at: now, type: "notification_skipped", by: "system", detail, data: { reason: "no-policy", cycle } }));
      }
      continue;
    }

    // Escalate now: make the next step of the current cycle due immediately.
    const escalateAt = engineState(inc).escalateRequestedAt;
    if (escalateAt !== undefined) {
      update((next) => {
        let nextOrdinal = doneOrdinal(next.escalation, policy) + 1;
        if (nextOrdinal >= totalOrdinals(policy)) {
          restartEscalation(next, now);
          nextOrdinal = 0;
        }
        const f = firingFor(policy, next.escalation.startedAt, nextOrdinal);
        if (f && f.dueAt > now) {
          next.escalation = { ...next.escalation, startedAt: next.escalation.startedAt - (f.dueAt - now) };
        }
        setEngineState(next, { escalateRequestedAt: undefined });
      });
    }

    const adv = advanceEscalation(inc, policy, now);
    if (adv.newlyDue.length > 0 || adv.becameExhausted) {
      update((next) => {
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
      });
    }
    const plan = planIncidentNotifications(
      inc,
      adv.due,
      planCtx,
      ledgerKeys,
      ps.allowedChannels,
      new Set(adv.newlyDue.map((f) => f.ordinal)),
      pagedIndex,
    );
    candidates.push(...plan.candidates);
    const current0 = inc;
    const newIssues = plan.issues.filter(
      (issue) =>
        !issue.key ||
        !current0.timeline.some((e) => e.type === "notification_skipped" && e.data?.["key"] === issue.key),
    );
    if (newIssues.length > 0) {
      update((next) => {
        for (const issue of newIssues) {
          errors.push(`Incident ${issue.incidentId}: ${issue.detail}`);
          pushTimeline(next, {
            at: now,
            type: "notification_skipped",
            by: "system",
            detail: issue.detail,
            data: { reason: issue.reason, ...(issue.uid ? { uid: issue.uid } : {}), ...(issue.key ? { key: issue.key } : {}) },
          });
        }
      });
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
    // Still returned by the source query (ACTIVE or recently CLOSED): keep it, or the next
    // tick would re-create it.
    if (seenInTick.has(id)) continue;
    // A failed/truncated query proves nothing about absence.
    if ((input.sourceStatus?.[inc.alert.source] ?? "ok") !== "ok") continue;
    const absent = (engineState(inc).absentTicks ?? 0) + 1;
    if (absent < ARCHIVE_ABSENT_TICKS) {
      const next = cloneIncident(inc);
      setEngineState(next, { absentTicks: absent });
      set(next);
      continue;
    }
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
