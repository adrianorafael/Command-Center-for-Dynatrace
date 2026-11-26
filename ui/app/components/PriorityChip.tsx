import React from "react";
import { Chip } from "@dynatrace/strato-components/content";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Priority } from "../domain/contracts";

export const PRIORITY_MEANING: Record<Priority, string> = {
  P1: "Critical: page now, all channels",
  P2: "High: page on-call",
  P3: "Moderate: notify, escalate in business hours",
  P4: "Low: notify only",
  P5: "Informational: no notification",
};

/** Chart token per priority (SecurityRiskLevel family, DESIGN §1.2). */
export const PRIORITY_COLOR: Record<Priority, string> = {
  P1: Colors.Charts.SecurityRiskLevel.Critical.Default,
  P2: Colors.Charts.SecurityRiskLevel.High.Default,
  P3: Colors.Charts.SecurityRiskLevel.Medium.Default,
  P4: Colors.Charts.SecurityRiskLevel.Low.Default,
  P5: Colors.Charts.SecurityRiskLevel.None.Default,
};

const CHIP_COLOR: Record<Priority, "critical" | "warning" | "primary" | "neutral"> = {
  P1: "critical",
  P2: "critical",
  P3: "warning",
  P4: "primary",
  P5: "neutral",
};

/**
 * One chip style for P1–P5 (owner decision, supersedes DESIGN §1.2's solid P1 + icon): the same `emphasized` variant,
 * size, weight and width for every priority, text centered, no icon. Hue follows the DESIGN ramp; the label always
 * carries the meaning (P1 and P2 share the red tint and differ by label).
 */
export const PriorityChip = ({
  priority,
  size = "default",
  count,
}: {
  priority: Priority;
  size?: "default" | "condensed";
  count?: number;
}) => (
  <Chip
    color={CHIP_COLOR[priority]}
    variant="emphasized"
    size={size}
    aria-label={`Priority ${priority}`}
    style={{ minWidth: count === undefined ? 36 : 52, justifyContent: "center" }}
  >
    {count === undefined ? priority : `${priority} ${count}`}
  </Chip>
);
