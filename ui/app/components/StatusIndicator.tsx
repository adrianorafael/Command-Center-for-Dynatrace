/** Labels, colours and indicators for incident status, delivery status and generic health. */
import React from "react";
import { HealthIndicator } from "@dynatrace/strato-components/content";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { IncidentStatus, NotificationStatus } from "../domain/contracts";

type Health = "ideal" | "good" | "neutral" | "warning" | "critical";

/** Display name of each incident status. */
export const STATUS_LABEL: Record<IncidentStatus, string> = {
  triggered: "Triggered",
  acknowledged: "Acknowledged",
  snoozed: "Snoozed",
  resolved: "Resolved",
};

/** HealthIndicator state of each incident status. */
export const STATUS_HEALTH: Record<IncidentStatus, Health> = {
  triggered: "critical",
  acknowledged: "warning",
  snoozed: "neutral",
  resolved: "ideal",
};

/** Chart colour token of each incident status. */
export const STATUS_COLOR: Record<IncidentStatus, string> = {
  triggered: Colors.Charts.Status.Critical.Default,
  acknowledged: Colors.Charts.Status.Warning.Default,
  snoozed: Colors.Charts.Status.Neutral.Default,
  resolved: Colors.Charts.Status.Ideal.Default,
};

/** Incident status as a health dot and label. */
export const StatusIndicator = ({
  status,
  visual = "shape",
  label,
}: {
  status: IncidentStatus;
  visual?: "shape" | "icon";
  label?: string;
}) => (
  <HealthIndicator status={STATUS_HEALTH[status]} visual={visual}>
    <HealthIndicator.Label>{label ?? STATUS_LABEL[status]}</HealthIndicator.Label>
  </HealthIndicator>
);

/** "Sent" means the provider accepted the message (HTTP 2xx); delivery to the handset is not tracked. */
export const DELIVERY: Record<NotificationStatus, { health: Health; label: string }> = {
  planned: { health: "good", label: "Sending" },
  sent: { health: "ideal", label: "Sent" },
  failed: { health: "critical", label: "Failed" },
  timeout: { health: "warning", label: "No result" },
};

/** Ledger status of one notification as a health dot and label. */
export const DeliveryStatus = ({ status }: { status: NotificationStatus }) => (
  <HealthIndicator status={DELIVERY[status].health} visual="shape">
    <HealthIndicator.Label>{DELIVERY[status].label}</HealthIndicator.Label>
  </HealthIndicator>
);

/** Generic health with text (workflows, sources, coverage). */
export const Health = ({ status, children }: { status: Health; children: React.ReactNode }) => (
  <HealthIndicator status={status} visual="shape">
    <HealthIndicator.Label>{children}</HealthIndicator.Label>
  </HealthIndicator>
);
