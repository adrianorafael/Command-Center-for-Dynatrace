/**
 * Command Center for Dynatrace — shared type contracts (v2).
 *
 * FROZEN: the domain core, the app functions, the workflow actions and the UI all depend on these shapes, and they
 * are what App State holds. Change only with a schemaVersion bump and a migration.
 *
 * Pure types only: no React, no Dynatrace SDK imports.
 */

/** Version stamped on every stored entity (see header). */
export const SCHEMA_VERSION = 1 as const;

// ─── Enumerations ────────────────────────────────────────────────────────────

/** P1 is the most urgent; "higher" priority means a smaller number (domain/priority.ts). */
export type Priority = "P1" | "P2" | "P3" | "P4" | "P5";
export const PRIORITIES: readonly Priority[] = ["P1", "P2", "P3", "P4", "P5"];

/** Inbound source: Q1 problems, Q2 Davis events, Q3 generic events (data/dql.ts). */
export type AlertSource = "davis-problem" | "davis-event" | "generic-event";

export type Channel =
  | "sms"
  | "voice"
  | "whatsapp"
  | "telegram"
  | "slack"
  | "teams"
  | "ifttt"
  | "webhook";
export const CHANNELS: readonly Channel[] = [
  "sms",
  "voice",
  "whatsapp",
  "telegram",
  "slack",
  "teams",
  "ifttt",
  "webhook",
];

export type IncidentStatus = "triggered" | "acknowledged" | "snoozed" | "resolved";

export type TeamRole = "admin" | "responder" | "observer";

export type ProviderKind =
  | "twilio"
  | "ifttt"
  | "slack-webhook"
  | "teams-webhook"
  | "telegram-bot"
  | "webhook"
  /** Hands the notification to a workflow the customer owns (run with params); no vault entry. */
  | "workflow";

// ─── Alerts (normalised inbound records) ─────────────────────────────────────

export interface EntityRef {
  id: string;
  name?: string;
  type?: string;
}

/** One inbound record after normalisation (domain/alerts/normalize.ts). Times are epoch ms. */
export interface Alert {
  source: AlertSource;
  /** Id in the source system (problem event.id, Davis event.id, cc.dedup_key). */
  sourceId: string;
  /** `<source>.<sanitised sourceId>` — identical alerts collapse into one incident. */
  dedupKey: string;
  /** Human id shown to operators, e.g. P-24051. */
  displayId?: string;
  title: string;
  description?: string;
  category?: string;
  /** 1 (most severe) … 5, when the source provides it. */
  severity?: number;
  sourceStatus: "ACTIVE" | "CLOSED";
  startedAt: number;
  endedAt?: number;
  reopenedAt?: number;
  entities: EntityRef[];
  rootCause?: { id?: string; name?: string };
  tags: string[];
  underMaintenance: boolean;
  muted: boolean;
  affectedUsers?: number;
  /** Additional matchable fields for routing rules (flattened, string values). */
  fields: Record<string, string>;
}

// ─── Incidents ───────────────────────────────────────────────────────────────

/** One line of an incident's history; `at` is epoch ms. */
export interface TimelineEntry {
  at: number;
  /**
   * e.g. created, routed, acknowledged, unacknowledged, resolved, reopened, snoozed,
   * unsnoozed, reassigned, escalated, priority, note, tag, notification_planned,
   * notification_sent, notification_failed, escalation_exhausted, suppressed.
   */
  type: string;
  /** IAM uid, 'system' or 'source'. */
  by: string;
  detail?: string;
  data?: Record<string, string | number | boolean>;
}

export interface Assignee {
  type: "user" | "team";
  id: string;
}

/** Where an incident is in its escalation policy. */
export interface EscalationProgress {
  /** Incremented by 'escalate now' and by re-trigger; part of the notification key. */
  cycle: number;
  startedAt: number;
  /** -1 before the first step fired. */
  lastStepIndex: number;
  repeatsDone: number;
  exhausted: boolean;
}

/** An incident (`inc.<id>`), written only by the engine; operators change it through IncidentAction records. */
export interface Incident {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  alert: Alert;
  status: IncidentStatus;
  priority: Priority;
  serviceId?: string;
  teamId?: string;
  policyId?: string;
  ruleId?: string;
  assignee?: Assignee;
  createdAt: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  resolvedAt?: number;
  resolvedBy?: string;
  snoozedUntil?: number;
  tags: string[];
  suppressed?: "maintenance" | "quiet-hours" | "rule";
  escalation: EscalationProgress;
  /** Capped at TIMELINE_CAP entries (oldest dropped, 'created' kept). */
  timeline: TimelineEntry[];
  lastSeenAt: number;
}

/** Maximum timeline entries kept per incident. */
export const TIMELINE_CAP = 200;

interface ActionBase {
  schemaVersion: typeof SCHEMA_VERSION;
  incidentId: string;
  at: number;
  /** Random id of the writer; ties are broken by key order. */
  clientId: string;
  /** IAM uid of the operator (UI fills it; engine prefers modificationInfo.lastModifiedBy). */
  by?: string;
}

/**
 * An operator command (`act.*`), appended by the UI and folded into the incident by the next engine tick, so the UI
 * never rewrites an incident the engine may be writing at the same time.
 */
export type IncidentAction = ActionBase &
  (
    | { type: "ack" }
    | { type: "unack" }
    | { type: "resolve" }
    | { type: "reopen" }
    | { type: "snooze"; until: number }
    | { type: "reassign"; assignee: Assignee }
    | { type: "escalate" }
    | { type: "priority"; priority: Priority }
    | { type: "note"; text: string }
    | { type: "tag"; add?: string[]; remove?: string[] }
  );

export type IncidentActionType = IncidentAction["type"];

// ─── Teams, schedules, policies, services, routing ───────────────────────────

/** A weekly team window in which less urgent incidents are held or limited to low-urgency channels. */
export interface QuietHours {
  timeZone: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** 'HH:mm' */
  from: string;
  /** 'HH:mm'; may be earlier than `from` (crosses midnight). */
  to: string;
  /** Incidents with priority numerically above this (less urgent) are affected. */
  minPriority: Priority;
  mode: "hold" | "low-urgency";
}

export interface TeamMember {
  uid: string;
  role: TeamRole;
}

export interface Team {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  rev: number;
  members: TeamMember[];
  defaultPolicyId?: string;
  quietHours?: QuietHours[];
}

/** One rotation of a schedule: participants take turns, shifts start at `handoffTime`. */
export interface RotationLayer {
  id: string;
  name: string;
  /** IAM uids in rotation order. */
  participants: string[];
  rotation: { type: "daily" | "weekly" | "custom"; lengthHours?: number };
  /** Epoch ms of the first shift start (anchor). */
  startsAt: number;
  /** 'HH:mm' in the schedule time zone. */
  handoffTime: string;
  /** If present, the layer only covers these windows. */
  restrictions?: { days: number[]; from: string; to: string }[];
}

/** `uid` is on call from `from` to `to` (epoch ms), above every layer. */
export interface ScheduleOverride {
  id: string;
  uid: string;
  from: number;
  to: number;
  note?: string;
}

export interface Schedule {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  teamId?: string;
  /** IANA time zone, e.g. 'America/Sao_Paulo'. */
  timeZone: string;
  rev: number;
  /** Later layers take precedence over earlier ones (top layer wins). */
  layers: RotationLayer[];
  overrides: ScheduleOverride[];
}

export type EscalationTarget =
  | { type: "schedule"; scheduleId: string }
  | { type: "user"; uid: string }
  | { type: "team"; teamId: string };

export interface EscalationStep {
  /** Minutes after the previous step (step 0: after the incident triggered). */
  delayMinutes: number;
  targets: EscalationTarget[];
  /** Forces these channels instead of the users' notification rules. */
  channels?: Channel[];
}

export interface EscalationPolicy {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  teamId?: string;
  rev: number;
  /** How many times the whole policy repeats after the last step (0 = once). */
  repeat: number;
  steps: EscalationStep[];
}

export interface Service {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  teamId: string;
  policyId?: string;
  rev: number;
  defaultPriority?: Priority;
}

export type ConditionOp = "equals" | "contains" | "regex" | "in" | "exists" | "lte" | "gte";

export interface RuleCondition {
  /**
   * Alert field: title, description, category, severity, source, sourceStatus,
   * entity.name, entity.type, entity.id, tag, rootCause.name, or fields.<name>.
   */
  field: string;
  op: ConditionOp;
  /** For 'in': comma-separated list. */
  value?: string;
  negate?: boolean;
}

/** If the conditions match, `then` sets the incident's service/team/policy/priority/tags, or suppresses paging. */
export interface RoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: RuleCondition[];
  then: {
    serviceId?: string;
    teamId?: string;
    policyId?: string;
    priority?: Priority;
    addTags?: string[];
    suppress?: boolean;
  };
}

export interface RoutingRules {
  schemaVersion: typeof SCHEMA_VERSION;
  rev: number;
  /** Ordered; first match wins. */
  rules: RoutingRule[];
}

// ─── People: contact methods & notification rules ────────────────────────────

export interface ContactMethod {
  id: string;
  channel: Channel;
  /** Phone in E.164, Telegram chat id, Slack/Teams handle or webhook routing key. */
  address: string;
  label?: string;
  verified?: boolean;
}

/** "Notify me on `methodId` `delayMinutes` after I am paged", for incidents at least as urgent as `maxPriority`. */
export interface NotificationRule {
  /** Rule applies to incidents with priority at or more urgent than this. */
  maxPriority: Priority;
  methodId: string;
  delayMinutes: number;
}

/** A person's contact methods and notification rules (`contact.<uid>`). */
export interface UserContact {
  schemaVersion: typeof SCHEMA_VERSION;
  uid: string;
  rev: number;
  /** Snapshot for display when IAM is unavailable (no email stored). */
  displayName?: string;
  timeZone?: string;
  methods: ContactMethod[];
  rules: NotificationRule[];
}

/** Minimal IAM identity used by the UI (resolved live, never persisted except displayName). */
export interface DirectoryUser {
  uid: string;
  name: string;
  email?: string;
}

// ─── Notifications (engine ⇄ senders) ────────────────────────────────────────

/** One message to one person on one channel, planned by the engine and sent by api/lib/senders.ts. */
export interface NotificationRequest {
  /** `<incId>.<cycle>.<step>.<uidHash>.<channel>.<attempt>` — also the ledger key suffix. */
  key: string;
  incidentId: string;
  cycle: number;
  step: number;
  attempt: number;
  channel: Channel;
  /** Settings.providers[].id */
  providerId: string;
  to: { uid: string; address: string; name?: string };
  /** Pre-rendered, length-limited texts. */
  subject: string;
  text: string;
  speech?: string;
  priority: Priority;
  incidentUrl: string;
  displayId?: string;
}

/** Ledger state: `timeout` = planned but no result within engine.reportTimeoutSec (retried while attempts remain). */
export type NotificationStatus = "planned" | "sent" | "failed" | "timeout";

/** Outcome of one send attempt, applied to the ledger by the delivery report. `at` is epoch ms. */
export interface DeliveryResult {
  key: string;
  status: "sent" | "failed";
  providerRef?: string;
  error?: string;
  at: number;
}

/** Ledger entry (`ntf.<key>`): the request plus its delivery state. */
export interface NotificationRecord extends NotificationRequest {
  schemaVersion: typeof SCHEMA_VERSION;
  status: NotificationStatus;
  plannedAt: number;
  reportedAt?: number;
  providerRef?: string;
  error?: string;
}

/** Planned notifications per channel, handed from the tick to the senders. */
export type NotificationBatches = Record<Channel, NotificationRequest[]>;

/** Why a cycle runs. "test" sends one test message and touches no state. */
export interface EngineTickRequest {
  reason: "schedule" | "manual" | "problem-trigger" | "test";
  /** For reason 'test': send one synthetic message through a provider. */
  testRequest?: { providerId: string; channel: Channel; address: string };
}

export interface EngineTickResponse {
  ok: boolean;
  tickAt: number;
  skipped?: "locked" | "disabled";
  batches: NotificationBatches;
  counts: EngineCounts;
  errors: string[];
}

/** Per-tick counters shown in the heartbeat. */
export interface EngineCounts {
  alertsFetched: number;
  incidentsCreated: number;
  incidentsResolved: number;
  actionsFolded: number;
  notificationsPlanned: number;
  notificationsRetried: number;
}

/** Last tick summary (`hb.engine`): the only engine diagnostics, since simple workflows keep no task results. */
export interface EngineHeartbeat {
  schemaVersion: typeof SCHEMA_VERSION;
  lastTickAt: number;
  durationMs: number;
  counts: EngineCounts;
  lastError?: string;
}

// ─── Settings & providers ────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string;
  name: string;
  channel: Channel;
  kind: ProviderKind;
  enabled: boolean;
  /** Credential Vault entry ID (CREDENTIAL_VAULT_ENTRY-… or classic CREDENTIALS_VAULT-…). Never the secret itself. */
  credentialVaultId?: string;
  /**
   * Non-secret parameters: from-number, IFTTT event name, workflowId (custom workflow, or the integration's own
   * workflow) and delivery ("workflow" = the person chose delivery through that workflow)…
   */
  params: Record<string, string>;
}

export interface Settings {
  schemaVersion: typeof SCHEMA_VERSION;
  rev: number;
  sources: {
    davisProblems: { enabled: boolean; lookbackHours: number; pageDuringMaintenance: boolean };
    davisEvents: { enabled: boolean; eventTypes: string[] };
    genericEvents: { enabled: boolean; eventType: string };
  };
  defaults: {
    priorityBySeverity: Record<string, Priority>;
    priorityByCategory: Record<string, Priority>;
    priority: Priority;
    policyId?: string;
    teamId?: string;
  };
  engine: {
    enabled: boolean;
    workflowId: string;
    /** Cap on notifications sent per tick; the rest wait for the next tick. */
    maxNotificationsPerTick: number;
    /** A planned notification without a result after this long becomes `timeout`. */
    reportTimeoutSec: number;
    /** Attempts per notification, the first included. */
    maxAttempts: number;
    /** Engine lease TTL, clamped by the engine (api/lib/engine.ts effectiveLockTtlSec). */
    lockTtlSec: number;
    /** Run interval of the installed engine workflow in minutes (1, 2 or 5); recorded at install. */
    intervalMinutes?: number;
  };
  /** Resolved incidents stay live this many hours, then move to `arc.*` kept for archiveDays (≤ 90). */
  retention: { resolvedVisibleHours: number; archiveDays: number };
  /** autoRefreshSec: UI polling interval, 0 = off. */
  ui: { autoRefreshSec: number; timeZone?: string };
  providers: ProviderConfig[];
  demoMode: boolean;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

/** Per-day report counters (`rpt.<day>`), kept for 90 days. */
export interface DailyRollup {
  schemaVersion: typeof SCHEMA_VERSION;
  /** yyyy-mm-dd (UTC). */
  day: string;
  created: number;
  resolved: number;
  /** Sum and count of time-to-acknowledge / time-to-resolve in ms. */
  ttaSumMs: number;
  ttaCount: number;
  ttrSumMs: number;
  ttrCount: number;
  byPriority: Partial<Record<Priority, number>>;
  byTeam: Record<string, number>;
  byService: Record<string, number>;
  bySource: Record<string, number>;
  notificationsSent: number;
  notificationsFailed: number;
  pagesByUser: Record<string, number>;
}

/** The engine counts as late after two intervals plus one minute (3 min at the default 1-minute interval). */
export function engineStaleAfterMs(settings: Pick<Settings, "engine"> | undefined): number {
  const i = settings?.engine.intervalMinutes;
  const minutes = i === 2 || i === 5 ? i : 1;
  return (minutes * 2 + 1) * 60_000;
}
