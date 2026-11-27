/** Priority chip, meanings and chart colours, so P1…P5 look the same everywhere. */
import React from "react";
import { Chip } from "@dynatrace/strato-components/content";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Priority } from "../domain/contracts";

/** One-line meaning of each priority, for tooltips and selects. */
export const PRIORITY_MEANING: Record<Priority, string> = {
  P1: "Critical: major outage or customer impact",
  P2: "High: a service is degraded",
  P3: "Moderate: needs attention soon",
  P4: "Low: can wait for business hours",
  P5: "Informational: for awareness",
};

/** Chart token per priority (SecurityRiskLevel family, DESIGN §1.2). */
export const PRIORITY_COLOR: Record<Priority, string> = {
  P1: Colors.Charts.SecurityRiskLevel.Critical.Default,
  P2: Colors.Charts.SecurityRiskLevel.High.Default,
  P3: Colors.Charts.SecurityRiskLevel.Medium.Default,
  P4: Colors.Charts.SecurityRiskLevel.Low.Default,
  P5: Colors.Charts.SecurityRiskLevel.None.Default,
};

/** Same chip size and content for every priority (no icons); P1 is the only solid (accent) chip. */
const STYLE: Record<Priority, { color: "critical" | "warning" | "primary" | "neutral"; variant: "accent" | "emphasized" }> = {
  P1: { color: "critical", variant: "accent" },
  P2: { color: "critical", variant: "emphasized" },
  P3: { color: "warning", variant: "emphasized" },
  P4: { color: "primary", variant: "emphasized" },
  P5: { color: "neutral", variant: "emphasized" },
};

export const PriorityChip = ({
  priority,
  size = "default",
  count,
}: {
  priority: Priority;
  size?: "default" | "condensed";
  count?: number;
}) => {
  const s = STYLE[priority];
  return (
    <Chip color={s.color} variant={s.variant} size={size} aria-label={`Priority ${priority}`}>
      {count === undefined ? priority : `${priority} ${count}`}
    </Chip>
  );
};
