/**
 * Command Center for Dynatrace — shared type contracts (v2).
 *
 * FROZEN: owned by the lead. Domain core, app functions, workflow scripts and the UI
 * all depend on these shapes. Change only with a schemaVersion bump and a migration.
 *
 * Pure types only: no React, no Dynatrace SDK imports.
 */

export const SCHEMA_VERSION = 1 as const;

// ─── Enumerations ────────────────────────────────────────────────────────────

export type Priority = "P1" | "P2" | "P3" | "P4" | "P5";
export const PRIORITIES: readonly Priority[] = ["P1", "P2", "P3", "P4", "P5"];

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
  | "webhook";

// ─── Alerts (normalised inbound records) ─────────────────────────────────────

export interface EntityRef {
  id: string;
  name?: string;
  type?: string;
}

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

export interface EscalationProgress {
  /** Incremented by 'escalate now' and by re-trigger; part of the notification key. */
  cycle: number;
  startedAt: number;
  /** -1 before the first step fired. */
  lastStepIndex: number;
  repeatsDone: number;
  exhausted: boolean;
}

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

export interface NotificationRule {
  /** Rule applies to incidents with priority at or more urgent than this. */
  maxPriority: Priority;
  methodId: string;
  delayMinutes: number;
}

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

// ─── Notifications (engine ⇄ workflow) ───────────────────────────────────────

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

export type NotificationStatus = "planned" | "sent" | "failed" | "timeout";

export interface DeliveryResult {
  key: string;
  status: "sent" | "failed";
  providerRef?: string;
  error?: string;
  at: number;
}

export interface NotificationRecord extends NotificationRequest {
  schemaVersion: typeof SCHEMA_VERSION;
  status: NotificationStatus;
  plannedAt: number;
  reportedAt?: number;
  providerRef?: string;
  error?: string;
}

/** What the engine-tick app function returns to the workflow. */
export type NotificationBatches = Record<Channel, NotificationRequest[]>;

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

export interface EngineCounts {
  alertsFetched: number;
  incidentsCreated: number;
  incidentsResolved: number;
  actionsFolded: number;
  notificationsPlanned: number;
  notificationsRetried: number;
}

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
  /** Credential Vault entry ID (CREDENTIALS_VAULT-…). Never the secret itself. */
  credentialVaultId?: string;
  /** Non-secret parameters: from-number, IFTTT event name, Telegram parse mode… */
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
    maxNotificationsPerTick: number;
    reportTimeoutSec: number;
    maxAttempts: number;
    lockTtlSec: number;
  };
  retention: { resolvedVisibleHours: number; archiveDays: number };
  ui: { autoRefreshSec: number; timeZone?: string };
  providers: ProviderConfig[];
  demoMode: boolean;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

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
