/**
 * Notification planning and the ledger retry path.
 *
 * Planning is ledger-driven (idempotent): every tick, for every escalation firing of the
 * current cycle that is due, targets are resolved AT THE FIRING'S dueAt (so a later tick
 * re-derives the same people even if the rotation handed off meanwhile), expanded through
 * the users' notification rules (or the step's forced channels), and a request is produced
 * for each key `<incId>.<cycle>.<ordinal>.<uidHash>.<channel>.1` not already in the ledger
 * and whose rule delay has elapsed. Deferred items (rule delays, per-tick cap) are simply
 * produced again by a later tick.
 *
 * Key nuance: one request per (user, channel) per firing — when a user has several methods
 * on the same channel, the one from the earliest-firing rule is used (the frozen key format
 * has no method segment).
 */

import type {
  Channel,
  ContactMethod,
  EscalationStep,
  Incident,
  NotificationRecord,
  NotificationRequest,
  ProviderConfig,
  Schedule,
  Service,
  Settings,
  Team,
  UserContact,
} from "../contracts";
import { SCHEMA_VERSION } from "../contracts";
import type { StepFiring } from "../escalation/machine";
import { expandTargets } from "../escalation/targets";
import { notificationKey, withAttempt } from "../keys";
import { atLeastAsUrgent } from "../priority";
import { MINUTE_MS } from "../time/tz";
import { incidentUrl, renderMessage } from "./templates";

/**
 * Already-fired firings are re-planned (for rule delays and the cap) only within this window.
 * Older ones are never re-sent, so an expired ledger entry (ntf TTL 14 d), a provider enabled
 * later or a new team member cannot replay old steps. Newly due firings are always planned,
 * even after a long engine outage.
 */
export const PLAN_CATCHUP_MS = 60 * MINUTE_MS;

export interface PlanContext {
  now: number;
  settings: Settings;
  schedules: Schedule[];
  teams: Team[];
  services: Service[];
  contacts: UserContact[];
  /** Absolute app URL used in message links (default: relative app path). */
  appBaseUrl?: string;
}

export interface ContactChoice {
  channel: Channel;
  method: ContactMethod;
  delayMs: number;
}

/** First enabled provider configured for a channel. */
export function providerFor(settings: Settings, channel: Channel): ProviderConfig | undefined {
  return settings.providers.find((p) => p.enabled && p.channel === channel);
}

/**
 * Which (channel, method, delay) to use for a user:
 * - step.channels forced → the user's first method of each forced channel, no delay;
 * - else the user's rules applying to this priority (rule.maxPriority at least as urgent
 *   threshold: P1 incident matches a "≤ P3" rule), one per channel (smallest delay);
 * - a user with methods but no rules gets every method immediately (paging-safe default).
 * `allowedChannels` filters the result (quiet hours low-urgency mode).
 */
export function contactChoices(
  contact: UserContact | undefined,
  step: EscalationStep,
  priority: Incident["priority"],
  allowedChannels?: readonly Channel[],
): ContactChoice[] {
  if (!contact) return [];
  const byChannel = new Map<Channel, ContactChoice>();
  const offer = (c: ContactChoice) => {
    if (allowedChannels && !allowedChannels.includes(c.channel)) return;
    if (!c.method.address) return;
    const prev = byChannel.get(c.channel);
    if (!prev || c.delayMs < prev.delayMs) byChannel.set(c.channel, c);
  };
  if (step.channels && step.channels.length > 0) {
    for (const ch of step.channels) {
      const m = contact.methods.find((x) => x.channel === ch);
      if (m) offer({ channel: ch, method: m, delayMs: 0 });
    }
  } else if (contact.rules.length > 0) {
    for (const r of contact.rules) {
      if (!atLeastAsUrgent(priority, r.maxPriority)) continue;
      const m = contact.methods.find((x) => x.id === r.methodId);
      if (m) offer({ channel: m.channel, method: m, delayMs: Math.max(0, r.delayMinutes) * MINUTE_MS });
    }
  } else {
    for (const m of contact.methods) offer({ channel: m.channel, method: m, delayMs: 0 });
  }
  return Array.from(byChannel.values());
}

export interface PlanIssue {
  incidentId: string;
  uid?: string;
  ordinal?: number;
  reason: "no-targets" | "no-contact" | "no-provider";
  detail: string;
}

export interface CandidateRequest {
  record: NotificationRecord;
  /** When this request became due (firing dueAt + rule delay). */
  dueAt: number;
}

function buildRecord(
  inc: Incident,
  ctx: PlanContext,
  firing: StepFiring,
  uid: string,
  choice: ContactChoice,
  provider: ProviderConfig,
  contact: UserContact | undefined,
  attempt: number,
): NotificationRecord {
  const key = notificationKey({
    incidentId: inc.id,
    cycle: inc.escalation.cycle,
    step: firing.ordinal,
    uid,
    channel: choice.channel,
    attempt,
  });
  const url = incidentUrl(inc.id, ctx.appBaseUrl);
  const service = ctx.services.find((s) => s.id === inc.serviceId);
  const team = ctx.teams.find((t) => t.id === inc.teamId);
  const msg = renderMessage(inc, choice.channel, {
    incidentUrl: url,
    ...(service ? { serviceName: service.name } : {}),
    ...(team ? { teamName: team.name } : {}),
    pass: firing.pass,
    stepIndex: firing.stepIndex,
    attempt,
  });
  const req: NotificationRequest = {
    key,
    incidentId: inc.id,
    cycle: inc.escalation.cycle,
    step: firing.ordinal,
    attempt,
    channel: choice.channel,
    providerId: provider.id,
    to: { uid, address: choice.method.address, ...(contact?.displayName ? { name: contact.displayName } : {}) },
    subject: msg.subject,
    text: msg.text,
    ...(msg.speech ? { speech: msg.speech } : {}),
    priority: inc.priority,
    incidentUrl: url,
    ...(inc.alert.displayId ? { displayId: inc.alert.displayId } : {}),
  };
  return { ...req, schemaVersion: SCHEMA_VERSION, status: "planned", plannedAt: ctx.now };
}

/**
 * Candidate first-attempt requests for one incident from its due firings, skipping keys in
 * `ledgerKeys`. Issues are reported only for `reportFor` ordinals (newly due), to avoid
 * repeating them every tick.
 */
export function planIncidentNotifications(
  inc: Incident,
  due: StepFiring[],
  ctx: PlanContext,
  ledgerKeys: ReadonlySet<string>,
  allowedChannels?: readonly Channel[],
  reportFor: ReadonlySet<number> = new Set(),
): { candidates: CandidateRequest[]; issues: PlanIssue[] } {
  const candidates: CandidateRequest[] = [];
  const issues: PlanIssue[] = [];
  for (const f of due) {
    const report = reportFor.has(f.ordinal);
    const targets = expandTargets(f.step.targets, { schedules: ctx.schedules, teams: ctx.teams }, f.dueAt);
    if (targets.length === 0 && report) {
      issues.push({ incidentId: inc.id, ordinal: f.ordinal, reason: "no-targets", detail: `Step ${f.stepIndex + 1} resolved to nobody` });
    }
    for (const t of targets) {
      const contact = ctx.contacts.find((c) => c.uid === t.uid);
      const choices = contactChoices(contact, f.step, inc.priority, allowedChannels);
      if (choices.length === 0 && report) {
        issues.push({ incidentId: inc.id, uid: t.uid, ordinal: f.ordinal, reason: "no-contact", detail: `No usable contact method for ${t.uid}` });
      }
      for (const ch of choices) {
        const dueAt = f.dueAt + ch.delayMs;
        if (dueAt > ctx.now) continue;
        if (!report && dueAt < ctx.now - PLAN_CATCHUP_MS) continue;
        const provider = providerFor(ctx.settings, ch.channel);
        if (!provider) {
          if (report) {
            issues.push({ incidentId: inc.id, uid: t.uid, ordinal: f.ordinal, reason: "no-provider", detail: `No enabled provider for ${ch.channel}` });
          }
          continue;
        }
        const rec = buildRecord(inc, ctx, f, t.uid, ch, provider, contact, 1);
        if (ledgerKeys.has(rec.key)) continue;
        candidates.push({ record: rec, dueAt });
      }
    }
  }
  return { candidates, issues };
}

// ─── ledger failure path ─────────────────────────────────────────────────────

export interface LedgerOutcome {
  /** Existing records changed (planned → timeout). */
  updated: NotificationRecord[];
  /** New retry records (attempt + 1), status planned. */
  retries: CandidateRequest[];
  /** Records whose final attempt failed or timed out (→ notification_failed timeline). */
  finalFailures: NotificationRecord[];
}

/** Copy of a record as the next attempt. */
export function nextAttempt(rec: NotificationRecord, now: number, providerId: string): NotificationRecord {
  const attempt = rec.attempt + 1;
  const copy: NotificationRecord = {
    ...rec,
    key: withAttempt(rec.key, attempt),
    attempt,
    providerId,
    status: "planned",
    plannedAt: now,
  };
  delete copy.reportedAt;
  delete copy.providerRef;
  delete copy.error;
  return copy;
}

/**
 * Spec §2 step 7: `planned` older than reportTimeoutSec → `timeout`. `timeout` and `failed`
 * records (the contract leaves failed-retry open; we retry both) get attempt + 1 while
 * attempt < maxAttempts and the incident is still triggered; otherwise the last attempt is
 * reported as a final failure (once — the caller checks the timeline).
 */
export function processLedger(
  ledger: NotificationRecord[],
  incidents: ReadonlyMap<string, Incident>,
  settings: Settings,
  now: number,
): LedgerOutcome {
  const keys = new Set(ledger.map((r) => r.key));
  const timeoutMs = Math.max(1, settings.engine.reportTimeoutSec) * 1000;
  const maxAttempts = Math.max(1, settings.engine.maxAttempts);
  const updated: NotificationRecord[] = [];
  const retries: CandidateRequest[] = [];
  const finalFailures: NotificationRecord[] = [];
  const sorted = [...ledger].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const original of sorted) {
    let rec = original;
    if (rec.status === "planned" && rec.plannedAt + timeoutMs <= now) {
      rec = { ...rec, status: "timeout", reportedAt: now, error: `No delivery report within ${Math.round(timeoutMs / 1000)} s` };
      updated.push(rec);
    }
    if (rec.status !== "timeout" && rec.status !== "failed") continue;
    if (keys.has(withAttempt(rec.key, rec.attempt + 1))) continue;
    const inc = incidents.get(rec.incidentId);
    if (!inc || inc.status !== "triggered" || inc.escalation.cycle !== rec.cycle) continue;
    if (rec.attempt < maxAttempts) {
      const provider = providerFor(settings, rec.channel);
      if (provider) {
        retries.push({ record: nextAttempt(rec, now, provider.id), dueAt: now });
        continue;
      }
    }
    finalFailures.push(rec);
  }
  return { updated, retries, finalFailures };
}

/** Strip ledger-only fields → the payload handed to the workflow. */
export function toRequest(rec: NotificationRecord): NotificationRequest {
  const req: NotificationRequest = {
    key: rec.key,
    incidentId: rec.incidentId,
    cycle: rec.cycle,
    step: rec.step,
    attempt: rec.attempt,
    channel: rec.channel,
    providerId: rec.providerId,
    to: { ...rec.to },
    subject: rec.subject,
    text: rec.text,
    ...(rec.speech !== undefined ? { speech: rec.speech } : {}),
    priority: rec.priority,
    incidentUrl: rec.incidentUrl,
    ...(rec.displayId !== undefined ? { displayId: rec.displayId } : {}),
  };
  return req;
}
