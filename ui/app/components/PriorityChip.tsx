import React from "react";
import { Chip } from "@dynatrace/strato-components/content";
import { CriticalIcon } from "@dynatrace/strato-icons";
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
      {priority === "P1" && (
        <Chip.Prefix>
          <CriticalIcon />
        </Chip.Prefix>
      )}
      {count === undefined ? priority : `${priority} ${count}`}
    </Chip>
  );
};
