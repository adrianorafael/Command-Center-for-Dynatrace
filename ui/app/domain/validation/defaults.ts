/**
 * Default configuration factories (fresh tenant / missing keys).
 */

import {
  SCHEMA_VERSION,
  type ProviderConfig,
  type RoutingRules,
  type Settings,
} from "../contracts";

export const GENERIC_EVENT_TYPE = "command_center.alert";

/** Default provider slots (all disabled until an admin adds a Credential Vault entry id). */
export function defaultProviders(): ProviderConfig[] {
  return [
    { id: "twilio-sms", name: "Twilio SMS", channel: "sms", kind: "twilio", enabled: false, params: { from: "" } },
    { id: "twilio-voice", name: "Twilio Voice", channel: "voice", kind: "twilio", enabled: false, params: { from: "" } },
    { id: "twilio-whatsapp", name: "Twilio WhatsApp", channel: "whatsapp", kind: "twilio", enabled: false, params: { from: "" } },
    { id: "ifttt", name: "IFTTT Webhooks", channel: "ifttt", kind: "ifttt", enabled: false, params: { eventName: "command_center_alert" } },
    { id: "slack", name: "Slack", channel: "slack", kind: "slack-webhook", enabled: false, params: {} },
    { id: "teams", name: "Microsoft Teams", channel: "teams", kind: "teams-webhook", enabled: false, params: {} },
    { id: "telegram", name: "Telegram", channel: "telegram", kind: "telegram-bot", enabled: false, params: {} },
    { id: "webhook", name: "Generic webhook", channel: "webhook", kind: "webhook", enabled: false, params: {} },
  ];
}

export function defaultSettings(): Settings {
  return {
    schemaVersion: SCHEMA_VERSION,
    rev: 0,
    sources: {
      davisProblems: { enabled: true, lookbackHours: 72, pageDuringMaintenance: false },
      davisEvents: { enabled: false, eventTypes: ["CUSTOM_ALERT", "ERROR_EVENT"] },
      genericEvents: { enabled: false, eventType: GENERIC_EVENT_TYPE },
    },
    defaults: {
      priorityBySeverity: { "1": "P1", "2": "P2", "3": "P3", "4": "P4", "5": "P5" },
      priorityByCategory: {
        AVAILABILITY: "P1",
        ERROR: "P2",
        MONITORING_UNAVAILABLE: "P2",
        SLOWDOWN: "P3",
        RESOURCE_CONTENTION: "P3",
        CUSTOM_ALERT: "P3",
        INFO: "P5",
        OTHER: "P4",
      },
      priority: "P3",
    },
    engine: {
      enabled: true,
      workflowId: "",
      maxNotificationsPerTick: 100,
      reportTimeoutSec: 180,
      maxAttempts: 3,
      lockTtlSec: 90,
    },
    retention: { resolvedVisibleHours: 24, archiveDays: 30 },
    ui: { autoRefreshSec: 30 },
    providers: defaultProviders(),
    demoMode: false,
  };
}

export function defaultRoutingRules(): RoutingRules {
  return { schemaVersion: SCHEMA_VERSION, rev: 0, rules: [] };
}
