import React from "react";
import { HealthIndicator } from "@dynatrace/strato-components/content";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { IncidentStatus, NotificationStatus } from "../domain/contracts";

type Health = "ideal" | "good" | "neutral" | "warning" | "critical";

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  triggered: "Triggered",
  acknowledged: "Acknowledged",
  snoozed: "Snoozed",
  resolved: "Resolved",
};

export const STATUS_HEALTH: Record<IncidentStatus, Health> = {
  triggered: "critical",
  acknowledged: "warning",
  snoozed: "neutral",
  resolved: "ideal",
};

export const STATUS_COLOR: Record<IncidentStatus, string> = {
  triggered: Colors.Charts.Status.Critical.Default,
  acknowledged: Colors.Charts.Status.Warning.Default,
  snoozed: Colors.Charts.Status.Neutral.Default,
  resolved: Colors.Charts.Status.Ideal.Default,
};

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

const DELIVERY: Record<NotificationStatus, { health: Health; label: string }> = {
  planned: { health: "good", label: "Sent (pending)" },
  sent: { health: "ideal", label: "Delivered" },
  failed: { health: "critical", label: "Failed" },
  timeout: { health: "warning", label: "No report" },
};

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
