import React from "react";
import { Chip } from "@dynatrace/strato-components/content";
import { SquareFilledIcon } from "@dynatrace/strato-icons";
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

/**
 * One chip style for P1–P5 (owner decision, supersedes DESIGN §1.2's solid-P1 ramp): the same neutral emphasized
 * `Chip`, the same size and weight, and the same filled-square prefix colored with the priority's chart token, so a
 * priority reads as the same hue in tables, filters and charts. The text label always carries the meaning.
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
  <Chip color="neutral" variant="emphasized" size={size} aria-label={`Priority ${priority}`}>
    <Chip.Prefix>
      <SquareFilledIcon size="small" style={{ color: PRIORITY_COLOR[priority] }} />
    </Chip.Prefix>
    {count === undefined ? priority : `${priority} ${count}`}
  </Chip>
);
