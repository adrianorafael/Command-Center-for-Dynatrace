import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { ClockIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { formatDateTime, formatDuration } from "./format";

/** Relative age, critical color + clock icon once over the ack SLA (DESIGN §4.4). */
export const AgeText = ({
  since,
  now,
  overdueAfterMs,
  timeZone,
}: {
  since: number;
  now: number;
  overdueAfterMs?: number;
  timeZone?: string;
}) => {
  const age = now - since;
  const overdue = overdueAfterMs !== undefined && age > overdueAfterMs;
  return (
    <Tooltip text={formatDateTime(since, timeZone)}>
      <Flex alignItems="center" gap={4} style={overdue ? { color: Colors.Text.Critical.Default } : undefined}>
        {overdue && <ClockIcon size="small" aria-label="Over the acknowledge target" />}
        <Text>{formatDuration(age)}</Text>
      </Flex>
    </Tooltip>
  );
};
