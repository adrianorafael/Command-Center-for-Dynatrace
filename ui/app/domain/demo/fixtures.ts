/**
 * Synthetic demo dataset (demo mode, screenshots, tests).
 *
 * Everything here is fictional: users "user-0001"… with invented names, addresses on the
 * reserved example.com domain, fictional 555-01xx phone numbers, placeholder Credential Vault
 * ids and scanner-safe entity ids (HOST-DEMO000000000001 — a real-looking 16-hex-digit id
 * would trip scan-secrets.sh). Incidents, timelines, the notification ledger and rollups are
 * produced by running the real engine (`tick` + `applyDeliveryResults`) over a scripted
 * history, so they are internally consistent. Deterministic for a given `now`.
 */

import type { Stored } from "../../data/repository";
import {
  SCHEMA_VERSION,
  type Alert,
  type DailyRollup,
  type DeliveryResult,
  type DirectoryUser,
  type EngineHeartbeat,
  type EscalationPolicy,
  type Incident,
  type IncidentAction,
  type NotificationRecord,
  type Priority,
  type RoutingRules,
  type Schedule,
  type Service,
  type Settings,
  type Team,
  type UserContact,
} from "../contracts";
import { applyDeliveryResults } from "../engine/delivery";
import { tick, type TickInput } from "../engine/tick";
import { dedupKeyFor, incidentIdFor, randomId, seededRng } from "../ids";
import { KEY, utcDay } from "../keys";
import { applyRollupDelta, emptyRollup } from "../reports/metrics";
import { addDays, civilDate, DAY_MS, HOUR_MS, MINUTE_MS, zonedToUtc } from "../time/tz";
import { defaultSettings } from "../validation/defaults";

export interface DemoData {
  settings: Settings;
  directory: DirectoryUser[];
  teams: Team[];
  schedules: Schedule[];
  policies: EscalationPolicy[];
  services: Service[];
  rules: RoutingRules;
  contacts: UserContact[];
  incidents: Incident[];
  /** Pending (not yet folded) operator actions. */
  actions: Stored<IncidentAction>[];
  notifications: NotificationRecord[];
  rollups: DailyRollup[];
  heartbeat: EngineHeartbeat;
}

export const DEMO_APP_BASE_URL = "/ui/apps/my.command.center";
export const DEMO_WORKFLOW_ID = "00000000-0000-4000-8000-000000000001";

const NAMES = [
  "Ada Quillfeather",
  "Bram Ostrowind",
  "Cleo Vargaston",
  "Dario Fennimore",
  "Esme Talbridge",
  "Fynn Calderwood",
  "Greta Lundquist",
  "Hugo Brandvold",
  "Iris Moreauville",
  "Jonas Pikeworth",
];

export function demoUid(n: number): string {
  return `user-${String(n).padStart(4, "0")}`;
}

export function demoEntityId(type: string, n: number): string {
  return `${type}-DEMO${String(n).padStart(12, "0")}`;
}

export function demoVaultId(n: number): string {
  return `CREDENTIALS_VAULT-${String(n).padStart(16, "0")}`;
}

/** Fictional directory (IAM stand-in). */
export function demoDirectory(): DirectoryUser[] {
  return NAMES.map((name, i) => ({
    uid: demoUid(i + 1),
    name,
    email: `${name.split(" ")[0]?.toLowerCase() ?? "user"}@example.com`,
  }));
}

function demoSettings(): Settings {
  const s = defaultSettings();
  s.rev = 3;
  s.demoMode = true;
  s.engine.workflowId = DEMO_WORKFLOW_ID;
  s.sources.davisEvents.enabled = true;
  s.sources.genericEvents.enabled = true;
  s.defaults.teamId = "noc-core";
  s.defaults.policyId = "pol-noc";
  s.ui.timeZone = "America/Sao_Paulo";
  const vault: Record<string, number> = { "twilio-sms": 1, "twilio-voice": 2, "twilio-whatsapp": 3, ifttt: 4, slack: 5, teams: 6 };
  s.providers = s.providers.map((p) => {
    const v = vault[p.id];
    if (v === undefined) return p;
    const params = p.kind === "twilio" ? { ...p.params, from: "+15550100000" } : p.params;
    return { ...p, enabled: true, credentialVaultId: demoVaultId(v), params };
  });
  return s;
}

function demoTeams(): Team[] {
  const t = (id: string, name: string, description: string, members: [number, Team["members"][number]["role"]][], defaultPolicyId: string): Team => ({
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    description,
    rev: 1,
    members: members.map(([n, role]) => ({ uid: demoUid(n), role })),
    defaultPolicyId,
  });
  const noc = t("noc-core", "NOC Core", "24×7 network operations centre — first line for every alert.", [[1, "admin"], [2, "responder"], [3, "responder"], [4, "responder"], [10, "observer"]], "pol-noc");
  noc.quietHours = [{ timeZone: "America/Sao_Paulo", days: [0, 6], from: "00:00", to: "08:00", minPriority: "P3", mode: "low-urgency" }];
  return [
    noc,
    t("payments-sre", "Payments SRE", "Checkout and payment APIs.", [[5, "admin"], [6, "responder"], [7, "responder"]], "pol-payments"),
    t("platform", "Platform", "Kubernetes clusters, networking and CI runners.", [[8, "admin"], [7, "responder"], [2, "responder"]], "pol-platform"),
    t("database", "Database", "PostgreSQL and Redis fleet.", [[9, "admin"], [3, "responder"], [10, "observer"]], "pol-database"),
  ];
}

function localAnchor(now: number, tz: string, daysBack: number, hhmm: number): number {
  return zonedToUtc(addDays(civilDate(now, tz), -daysBack), hhmm, tz);
}

function demoSchedules(now: number): Schedule[] {
  const sp = "America/Sao_Paulo";
  const be = "Europe/Berlin";
  const ny = "America/New_York";
  return [
    {
      schemaVersion: SCHEMA_VERSION,
      id: "sched-noc",
      name: "NOC primary",
      teamId: "noc-core",
      timeZone: sp,
      rev: 2,
      layers: [
        {
          id: "noc-daily",
          name: "Daily rotation",
          participants: [demoUid(1), demoUid(2), demoUid(3), demoUid(4)],
          rotation: { type: "daily" },
          startsAt: localAnchor(now, sp, 30, 8 * 60),
          handoffTime: "08:00",
        },
        {
          id: "noc-nights",
          name: "Weeknight cover",
          participants: [demoUid(4), demoUid(2)],
          rotation: { type: "weekly" },
          startsAt: localAnchor(now, sp, 28, 20 * 60),
          handoffTime: "20:00",
          restrictions: [{ days: [1, 2, 3, 4, 5], from: "20:00", to: "08:00" }],
        },
      ],
      overrides: [
        { id: "ovr-1", uid: demoUid(3), from: now - 2 * HOUR_MS, to: now + 2 * HOUR_MS, note: "Covering a dentist appointment" },
        { id: "ovr-2", uid: demoUid(1), from: now + 2 * DAY_MS, to: now + 2 * DAY_MS + 8 * HOUR_MS, note: "Swap" },
      ],
    },
    {
      schemaVersion: SCHEMA_VERSION,
      id: "sched-payments",
      name: "Payments on-call",
      teamId: "payments-sre",
      timeZone: be,
      rev: 1,
      layers: [
        {
          id: "pay-weekly",
          name: "Weekly",
          participants: [demoUid(5), demoUid(6), demoUid(7)],
          rotation: { type: "weekly" },
          startsAt: localAnchor(now, be, 35, 9 * 60),
          handoffTime: "09:00",
        },
      ],
      overrides: [],
    },
    {
      schemaVersion: SCHEMA_VERSION,
      id: "sched-platform",
      name: "Platform follow-the-sun",
      teamId: "platform",
      timeZone: ny,
      rev: 1,
      layers: [
        {
          id: "plat-12h",
          name: "12-hour shifts",
          participants: [demoUid(8), demoUid(7), demoUid(2)],
          rotation: { type: "custom", lengthHours: 12 },
          startsAt: localAnchor(now, ny, 20, 7 * 60),
          handoffTime: "07:00",
        },
      ],
      overrides: [],
    },
    {
      schemaVersion: SCHEMA_VERSION,
      id: "sched-database",
      name: "Database primary",
      teamId: "database",
      timeZone: "UTC",
      rev: 1,
      layers: [
        {
          id: "db-weekly",
          name: "Weekly",
          participants: [demoUid(9), demoUid(3)],
          rotation: { type: "weekly" },
          startsAt: localAnchor(now, "UTC", 21, 10 * 60),
          handoffTime: "10:00",
        },
      ],
      overrides: [],
    },
  ];
}

function demoPolicies(): EscalationPolicy[] {
  const p = (id: string, name: string, teamId: string, repeat: number, steps: EscalationPolicy["steps"]): EscalationPolicy => ({
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    teamId,
    rev: 1,
    repeat,
    steps,
  });
  return [
    p("pol-noc", "NOC standard", "noc-core", 1, [
      { delayMinutes: 0, targets: [{ type: "schedule", scheduleId: "sched-noc" }] },
      { delayMinutes: 10, targets: [{ type: "user", uid: demoUid(1) }] },
      { delayMinutes: 15, targets: [{ type: "team", teamId: "noc-core" }], channels: ["slack", "teams"] },
    ]),
    p("pol-payments", "Payments critical", "payments-sre", 2, [
      { delayMinutes: 0, targets: [{ type: "schedule", scheduleId: "sched-payments" }] },
      { delayMinutes: 5, targets: [{ type: "schedule", scheduleId: "sched-noc" }], channels: ["voice"] },
      { delayMinutes: 10, targets: [{ type: "user", uid: demoUid(5) }] },
    ]),
    p("pol-platform", "Platform", "platform", 0, [
      { delayMinutes: 0, targets: [{ type: "schedule", scheduleId: "sched-platform" }] },
      { delayMinutes: 20, targets: [{ type: "team", teamId: "platform" }] },
    ]),
    p("pol-database", "Database", "database", 1, [
      { delayMinutes: 0, targets: [{ type: "schedule", scheduleId: "sched-database" }] },
      { delayMinutes: 15, targets: [{ type: "user", uid: demoUid(9) }] },
    ]),
  ];
}

function demoServices(): Service[] {
  const s = (id: string, name: string, teamId: string, policyId: string, description: string, defaultPriority?: Priority): Service => ({
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    description,
    teamId,
    policyId,
    rev: 1,
    ...(defaultPriority ? { defaultPriority } : {}),
  });
  return [
    s("checkout", "Checkout", "payments-sre", "pol-payments", "Web checkout flow", "P2"),
    s("payments-api", "Payments API", "payments-sre", "pol-payments", "Card authorisation API", "P1"),
    s("k8s-prod", "Kubernetes prod", "platform", "pol-platform", "Production clusters"),
    s("postgres-main", "PostgreSQL main", "database", "pol-database", "Primary OLTP database"),
    s("noc-general", "NOC general", "noc-core", "pol-noc", "Everything not routed elsewhere"),
  ];
}

function demoRules(): RoutingRules {
  return {
    schemaVersion: SCHEMA_VERSION,
    rev: 4,
    rules: [
      { id: "suppress-info", name: "Suppress informational events", enabled: true, match: "all", conditions: [{ field: "category", op: "equals", value: "INFO" }], then: { suppress: true } },
      { id: "payments", name: "Payments services", enabled: true, match: "any", conditions: [{ field: "fields.cc.service", op: "in", value: "checkout,payments-api" }, { field: "tag", op: "equals", value: "team:payments" }], then: { serviceId: "checkout", addTags: ["payments"] } },
      { id: "database", name: "Database alerts", enabled: true, match: "any", conditions: [{ field: "title", op: "regex", value: "postgres|replica|redis|deadlock" }, { field: "entity.type", op: "equals", value: "DATABASE" }], then: { serviceId: "postgres-main" } },
      { id: "k8s", name: "Kubernetes", enabled: true, match: "any", conditions: [{ field: "tag", op: "contains", value: "k8s" }, { field: "entity.type", op: "equals", value: "KUBERNETES_CLUSTER" }], then: { serviceId: "k8s-prod" } },
      { id: "staging-low", name: "Staging is low priority", enabled: false, match: "all", conditions: [{ field: "tag", op: "equals", value: "env:staging" }], then: { priority: "P5" } },
      { id: "catch-all", name: "Catch-all → NOC", enabled: true, match: "all", conditions: [], then: { serviceId: "noc-general" } },
    ],
  };
}

function demoContacts(directory: DirectoryUser[]): UserContact[] {
  return directory.map((u, i) => {
    const n = i + 1;
    const phone = `+1555010${String(n).padStart(4, "0")}`;
    const methods: UserContact["methods"] = [
      { id: "sms", channel: "sms", address: phone, label: "Mobile", verified: true },
      { id: "voice", channel: "voice", address: phone, label: "Mobile (call)", verified: true },
      { id: "slack", channel: "slack", address: `@${u.name.split(" ")[0]?.toLowerCase() ?? "user"}`, label: "Slack" },
      { id: "teams", channel: "teams", address: u.uid, label: "Teams" },
    ];
    if (n % 3 === 0) methods.push({ id: "whatsapp", channel: "whatsapp", address: phone, label: "WhatsApp", verified: true });
    if (n % 4 === 0) methods.push({ id: "telegram", channel: "telegram", address: String(100000 + n), label: "Telegram" });
    const rules: UserContact["rules"] = [
      { maxPriority: "P5", methodId: "slack", delayMinutes: 0 },
      { maxPriority: "P3", methodId: n % 3 === 0 ? "whatsapp" : "sms", delayMinutes: 0 },
      { maxPriority: "P2", methodId: "voice", delayMinutes: 5 },
    ];
    return {
      schemaVersion: SCHEMA_VERSION,
      uid: u.uid,
      rev: 1,
      displayName: u.name,
      timeZone: n <= 4 ? "America/Sao_Paulo" : n <= 7 ? "Europe/Berlin" : "America/New_York",
      methods,
      rules,
    };
  });
}

// ─── scripted history ────────────────────────────────────────────────────────

type ActionSpec =
  | { at: number; by: number; type: "ack" | "unack" | "resolve" | "reopen" | "escalate" }
  | { at: number; by: number; type: "snooze"; untilMin: number }
  | { at: number; by: number; type: "note"; text: string }
  | { at: number; by: number; type: "priority"; priority: Priority }
  | { at: number; by: number; type: "reassign"; uid: number }
  | { at: number; by: number; type: "tag"; add: string[] };

interface Scenario {
  source: Alert["source"];
  sourceId: string;
  displayId?: string;
  title: string;
  category?: string;
  severity?: number;
  /** Minutes before now. */
  startMin: number;
  /** Minutes before now the source closed it. */
  closedMin?: number;
  entity: { type: string; n: number; name: string };
  tags?: string[];
  fields?: Record<string, string>;
  maintenance?: boolean;
  /** Action times are minutes after the start. */
  actions?: ActionSpec[];
  /** Leave the last action pending (not folded). */
  pendingLast?: boolean;
}

function scenarios(): Scenario[] {
  let p = 0;
  const pid = () => `P-${String(++p).padStart(5, "0")}`;
  const prob = (s: Omit<Scenario, "source" | "sourceId" | "displayId">): Scenario => {
    const id = pid();
    return { source: "davis-problem", sourceId: id, displayId: id, ...s };
  };
  return [
    prob({ title: "Payment authorisation failure rate increased", category: "ERROR", startMin: 12, entity: { type: "SERVICE", n: 1, name: "payments-api" }, tags: ["env:prod", "team:payments"], fields: { "cc.service": "payments-api" } }),
    prob({ title: "Checkout response time degradation", category: "SLOWDOWN", startMin: 48, entity: { type: "SERVICE", n: 2, name: "checkout-web" }, tags: ["env:prod"], fields: { "cc.service": "checkout" }, actions: [{ at: 4, by: 5, type: "ack" }, { at: 9, by: 5, type: "note", text: "Rolling back release 2026.11.3." }] }),
    prob({ title: "Host unavailable: edge-router-03", category: "AVAILABILITY", startMin: 95, closedMin: 70, entity: { type: "HOST", n: 3, name: "edge-router-03" }, tags: ["site:gru"], actions: [{ at: 3, by: 3, type: "ack" }] }),
    prob({ title: "PostgreSQL replica lag above 30 s", category: "RESOURCE_CONTENTION", severity: 2, startMin: 30, entity: { type: "DATABASE", n: 4, name: "pg-main-replica-2" }, tags: ["env:prod"], actions: [{ at: 6, by: 9, type: "ack" }, { at: 8, by: 9, type: "note", text: "Vacuum running on primary; watching." }] }),
    prob({ title: "Kubernetes node memory pressure", category: "RESOURCE_CONTENTION", startMin: 220, entity: { type: "KUBERNETES_CLUSTER", n: 5, name: "prod-eu-1" }, tags: ["k8s", "env:prod"] }),
    prob({ title: "Disk almost full on log-collector-1", category: "RESOURCE_CONTENTION", startMin: 380, closedMin: 300, entity: { type: "HOST", n: 6, name: "log-collector-1" }, actions: [{ at: 5, by: 2, type: "ack" }, { at: 40, by: 2, type: "resolve" }] }),
    prob({ title: "Synthetic monitor failing: login journey", category: "AVAILABILITY", startMin: 140, entity: { type: "SYNTHETIC_TEST", n: 7, name: "login-journey" }, actions: [{ at: 2, by: 1, type: "snooze", untilMin: 400 }] }),
    prob({ title: "Error rate spike on order-service", category: "ERROR", startMin: 64, entity: { type: "SERVICE", n: 8, name: "order-service" }, actions: [{ at: 7, by: 2, type: "ack" }, { at: 15, by: 2, type: "reassign", uid: 8 }, { at: 16, by: 8, type: "priority", priority: "P1" }] }),
    prob({ title: "Redis evictions on cache-cluster-2", category: "RESOURCE_CONTENTION", startMin: 18, entity: { type: "DATABASE", n: 9, name: "cache-cluster-2" }, maintenance: true }),
    prob({ title: "Certificate expires in 7 days: api gateway", category: "CUSTOM_ALERT", startMin: 600, entity: { type: "SERVICE", n: 10, name: "api-gateway" }, actions: [{ at: 20, by: 4, type: "ack" }, { at: 21, by: 4, type: "tag", add: ["planned-work"] }] }),
    prob({ title: "CPU saturation on batch-worker-7", category: "RESOURCE_CONTENTION", startMin: 900, closedMin: 860, entity: { type: "HOST", n: 11, name: "batch-worker-7" } }),
    prob({ title: "Packet loss between GRU and IAD", category: "AVAILABILITY", startMin: 6, entity: { type: "NETWORK", n: 12, name: "wan-gru-iad" }, tags: ["site:gru"] }),
    prob({ title: "Process crash loop: invoice-renderer", category: "ERROR", startMin: 260, entity: { type: "PROCESS_GROUP", n: 13, name: "invoice-renderer" }, actions: [{ at: 4, by: 6, type: "ack" }, { at: 90, by: 6, type: "resolve" }, { at: 120, by: 6, type: "reopen" }, { at: 125, by: 6, type: "ack" }] }),
    prob({ title: "Database deadlocks detected", category: "ERROR", severity: 3, startMin: 1300, closedMin: 1240, entity: { type: "DATABASE", n: 14, name: "pg-main" }, actions: [{ at: 8, by: 9, type: "ack" }] }),
    prob({ title: "Slow page load: storefront home", category: "SLOWDOWN", startMin: 75, entity: { type: "APPLICATION", n: 15, name: "storefront" }, tags: ["env:prod"], actions: [{ at: 25, by: 1, type: "escalate" }] }),
    prob({ title: "Kubernetes workload pods pending", category: "AVAILABILITY", startMin: 40, entity: { type: "KUBERNETES_CLUSTER", n: 16, name: "prod-us-1" }, tags: ["k8s"], actions: [{ at: 3, by: 8, type: "ack" }, { at: 38, by: 8, type: "note", text: "Cluster autoscaler hit the quota; raised it." }], pendingLast: true }),
    prob({ title: "Informational: deployment finished", category: "INFO", startMin: 33, entity: { type: "SERVICE", n: 17, name: "checkout-web" } }),
    {
      source: "davis-event",
      sourceId: "evt-demo-0001",
      title: "Queue depth above threshold: orders",
      category: "CUSTOM_ALERT",
      startMin: 22,
      entity: { type: "QUEUE", n: 18, name: "orders" },
      fields: { "event.id": "evt-demo-0001", "event.type": "CUSTOM_ALERT", "event.provider": "EVENTS_REST_API_INGEST", "cc.priority": "P2" },
    },
    {
      source: "davis-event",
      sourceId: "evt-demo-0002",
      title: "Batch job overran its window",
      category: "CUSTOM_ALERT",
      startMin: 500,
      closedMin: 420,
      entity: { type: "HOST", n: 19, name: "batch-scheduler" },
      fields: { "event.id": "evt-demo-0002", "event.type": "CUSTOM_ALERT" },
      actions: [{ at: 10, by: 4, type: "ack" }],
    },
    {
      source: "generic-event",
      sourceId: "backup-nightly-failed",
      title: "Nightly backup failed (vault-02)",
      startMin: 180,
      entity: { type: "HOST", n: 20, name: "backup-vault-02" },
      fields: { "event.type": "command_center.alert", "cc.dedup_key": "backup-nightly-failed", "cc.priority": "P3", "cc.action": "trigger" },
      tags: ["backup"],
      actions: [{ at: 12, by: 3, type: "ack" }],
    },
    {
      source: "generic-event",
      sourceId: "ci-runner-offline",
      title: "CI runner pool offline",
      startMin: 54,
      entity: { type: "HOST", n: 21, name: "ci-runner-pool" },
      fields: { "event.type": "command_center.alert", "cc.dedup_key": "ci-runner-offline", "cc.priority": "P4", "cc.service": "k8s-prod", "cc.action": "trigger" },
      tags: ["k8s"],
    },
    {
      source: "generic-event",
      sourceId: "vpn-tunnel-down",
      title: "Partner VPN tunnel down",
      startMin: 1500,
      closedMin: 1380,
      entity: { type: "NETWORK", n: 22, name: "vpn-partner-a" },
      fields: { "event.type": "command_center.alert", "cc.dedup_key": "vpn-tunnel-down", "cc.priority": "P2" },
      actions: [{ at: 6, by: 2, type: "ack" }, { at: 30, by: 2, type: "note", text: "Partner confirmed maintenance on their side." }],
    },
    prob({ title: "Failure rate increase: search-api", category: "ERROR", startMin: 2, entity: { type: "SERVICE", n: 23, name: "search-api" } }),
    prob({ title: "Memory leak suspected: recommendation-engine", category: "RESOURCE_CONTENTION", startMin: 150, entity: { type: "PROCESS_GROUP", n: 24, name: "recommendation-engine" }, actions: [{ at: 5, by: 7, type: "ack" }, { at: 60, by: 7, type: "unack" }] }),
    prob({ title: "DNS resolution errors in eu-west", category: "AVAILABILITY", startMin: 1100, closedMin: 1050, entity: { type: "NETWORK", n: 25, name: "dns-eu-west" }, actions: [{ at: 2, by: 1, type: "ack" }, { at: 45, by: 1, type: "resolve" }] }),
  ];
}

function scenarioAlert(s: Scenario, now: number, t: number): Alert | undefined {
  const start = now - s.startMin * MINUTE_MS;
  if (t < start) return undefined;
  const closedAt = s.closedMin !== undefined ? now - s.closedMin * MINUTE_MS : undefined;
  const closed = closedAt !== undefined && t >= closedAt;
  const fields: Record<string, string> = { "event.kind": s.source === "davis-problem" ? "DAVIS_PROBLEM" : s.source === "davis-event" ? "DAVIS_EVENT" : "EVENT", ...(s.fields ?? {}) };
  if (closed && s.source === "generic-event") fields["cc.action"] = "resolve";
  return {
    source: s.source,
    sourceId: s.sourceId,
    dedupKey: dedupKeyFor(s.source, s.sourceId),
    ...(s.displayId ? { displayId: s.displayId } : {}),
    title: s.title,
    description: `**${s.title}** detected on ${s.entity.name}.`,
    ...(s.category ? { category: s.category } : {}),
    ...(s.severity !== undefined ? { severity: s.severity } : {}),
    sourceStatus: closed ? "CLOSED" : "ACTIVE",
    startedAt: start,
    ...(closed && closedAt !== undefined ? { endedAt: closedAt } : {}),
    entities: [{ id: demoEntityId(s.entity.type, s.entity.n), name: s.entity.name, type: s.entity.type }],
    tags: s.tags ?? [],
    underMaintenance: s.maintenance === true,
    muted: false,
    ...(s.source === "davis-problem" ? { affectedUsers: (s.entity.n * 37) % 500 } : {}),
    fields,
  };
}

function actionFor(s: Scenario, incidentId: string, a: ActionSpec, start: number): IncidentAction {
  const base = { schemaVersion: SCHEMA_VERSION, incidentId, at: start + a.at * MINUTE_MS, clientId: `demo-${a.by}`, by: demoUid(a.by) };
  switch (a.type) {
    case "snooze":
      return { ...base, type: "snooze", until: start + a.untilMin * MINUTE_MS };
    case "note":
      return { ...base, type: "note", text: a.text };
    case "priority":
      return { ...base, type: "priority", priority: a.priority };
    case "reassign":
      return { ...base, type: "reassign", assignee: { type: "user", id: demoUid(a.uid) } };
    case "tag":
      return { ...base, type: "tag", add: a.add };
    default:
      return { ...base, type: a.type };
  }
}

/** Build the whole demo dataset relative to `now` (epoch ms). */
export function buildDemoData(now: number): DemoData {
  const settings = demoSettings();
  const directory = demoDirectory();
  const teams = demoTeams();
  const schedules = demoSchedules(now);
  const policies = demoPolicies();
  const services = demoServices();
  const rules = demoRules();
  const contacts = demoContacts(directory);
  const rng = seededRng(Math.floor(now / DAY_MS));
  const specs = scenarios();

  // Pre-compute operator actions with their times.
  const timedActions: { at: number; stored: Stored<IncidentAction>; pending: boolean }[] = [];
  for (const s of specs) {
    const start = now - s.startMin * MINUTE_MS;
    const incId = incidentIdFor(s);
    (s.actions ?? []).forEach((a, i, all) => {
      const value = actionFor(s, incId, a, start);
      if (value.at > now) return;
      timedActions.push({
        at: value.at,
        stored: { key: KEY.action(incId, value.at, randomId(rng, 6)), value, lastModifiedBy: value.by, lastModifiedTime: value.at },
        pending: s.pendingLast === true && i === all.length - 1,
      });
    });
  }

  // Tick times: each alert start/close, each action, and every 5 min for 90 min after a start.
  const times = new Set<number>();
  for (const s of specs) {
    const start = now - s.startMin * MINUTE_MS;
    for (let m = 0; m <= 90; m += 5) if (start + m * MINUTE_MS < now) times.add(start + m * MINUTE_MS);
    if (s.closedMin !== undefined) times.add(now - s.closedMin * MINUTE_MS);
  }
  for (const a of timedActions) if (!a.pending) times.add(a.at + 30_000);
  times.add(now);
  const order = [...times].filter((t) => t <= now).sort((a, b) => a - b);

  let incidents: Incident[] = [];
  let ledger: NotificationRecord[] = [];
  const rollups = new Map<string, DailyRollup>();
  const addRollup = (d: ReturnType<typeof tick>["rollupDelta"]) => rollups.set(d.day, applyRollupDelta(rollups.get(d.day), d));
  let lastCounts: EngineHeartbeat["counts"] = {
    alertsFetched: 0,
    incidentsCreated: 0,
    incidentsResolved: 0,
    actionsFolded: 0,
    notificationsPlanned: 0,
    notificationsRetried: 0,
  };

  let whatsappSeen = 0;
  let teamsSeen = 0;
  for (const t of order) {
    const alerts = specs.map((s) => scenarioAlert(s, now, t)).filter((a): a is Alert => !!a);
    const pendingActions = timedActions.filter((a) => !a.pending && a.at <= t).map((a) => a.stored);
    const input: TickInput = {
      now: t, settings, teams, schedules, policies, services, rules, contacts,
      incidents, pendingActions, ledger, alerts, appBaseUrl: DEMO_APP_BASE_URL,
    };
    const out = tick(input);
    lastCounts = out.counts;
    const incMap = new Map(incidents.map((i) => [i.id, i]));
    for (const i of out.incidentsToWrite) incMap.set(i.id, i);
    for (const id of out.incidentIdsToDelete) incMap.delete(id);
    const led = new Map(ledger.map((r) => [r.key, r]));
    for (const r of out.notificationsToWrite) led.set(r.key, r);
    const deleted = new Set(out.actionKeysToDelete);
    for (const a of timedActions) if (deleted.has(a.stored.key)) a.at = Number.POSITIVE_INFINITY;
    addRollup(out.rollupDelta);

    // The workflow delivers what was planned (except at `now`: those stay in flight).
    if (t < now) {
      const planned = out.notificationsToWrite.filter((r) => r.status === "planned");
      const results: DeliveryResult[] = [];
      for (const r of planned) {
        if (r.attempt === 1 && r.channel === "whatsapp" && whatsappSeen++ % 2 === 0) {
          results.push({ key: r.key, status: "failed", error: "Provider returned HTTP 503", at: t + 20_000 });
        } else if (r.attempt === 1 && r.channel === "teams" && teamsSeen++ % 4 === 0) {
          // no report: the record times out and the engine retries it
        } else {
          results.push({ key: r.key, status: "sent", providerRef: `demo-ref-${results.length + 1}`, at: t + 15_000 });
        }
      }
      const d = applyDeliveryResults({ now: t + 20_000, results, ledger: [...led.values()], incidents: [...incMap.values()] });
      for (const r of d.notificationsToWrite) led.set(r.key, r);
      for (const i of d.incidentsToWrite) incMap.set(i.id, i);
      addRollup(d.rollupDelta);
    }
    incidents = [...incMap.values()];
    ledger = [...led.values()];
  }

  // 14 days of history before today (synthetic, seeded).
  const teamIds = teams.map((t) => t.id);
  const serviceIds = services.map((s) => s.id);
  for (let d = 1; d <= 14; d++) {
    const day = utcDay(now - d * DAY_MS);
    const r = emptyRollup(day);
    r.created = 8 + Math.floor(rng() * 18);
    r.resolved = Math.max(0, r.created - Math.floor(rng() * 4));
    r.ttaCount = Math.max(1, r.created - Math.floor(rng() * 3));
    r.ttaSumMs = Math.round(r.ttaCount * (2 + rng() * 9) * MINUTE_MS);
    r.ttrCount = r.resolved;
    r.ttrSumMs = Math.round(r.ttrCount * (25 + rng() * 140) * MINUTE_MS);
    const pr: Priority[] = ["P1", "P2", "P3", "P3", "P4", "P5"];
    for (let i = 0; i < r.created; i++) {
      const p = pr[Math.floor(rng() * pr.length)] ?? "P3";
      r.byPriority[p] = (r.byPriority[p] ?? 0) + 1;
      const team = teamIds[Math.floor(rng() * teamIds.length)] ?? "noc-core";
      r.byTeam[team] = (r.byTeam[team] ?? 0) + 1;
      const svc = serviceIds[Math.floor(rng() * serviceIds.length)] ?? "noc-general";
      r.byService[svc] = (r.byService[svc] ?? 0) + 1;
      const src = rng() < 0.7 ? "davis-problem" : rng() < 0.5 ? "davis-event" : "generic-event";
      r.bySource[src] = (r.bySource[src] ?? 0) + 1;
    }
    r.notificationsSent = r.created * 3 + Math.floor(rng() * 10);
    r.notificationsFailed = Math.floor(rng() * 4);
    for (let u = 1; u <= 10; u++) {
      const pages = Math.floor(rng() * 6);
      if (pages > 0) r.pagesByUser[demoUid(u)] = pages;
    }
    rollups.set(day, r);
  }

  const actions = timedActions.filter((a) => a.pending).map((a) => a.stored);
  const heartbeat: EngineHeartbeat = {
    schemaVersion: SCHEMA_VERSION,
    lastTickAt: now - 20_000,
    durationMs: 840,
    counts: lastCounts,
  };

  return {
    settings,
    directory,
    teams,
    schedules,
    policies,
    services,
    rules,
    contacts,
    incidents: incidents.sort((a, b) => b.createdAt - a.createdAt),
    actions,
    notifications: ledger.sort((a, b) => b.plannedAt - a.plannedAt || (a.key < b.key ? -1 : 1)),
    rollups: [...rollups.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    heartbeat,
  };
}
