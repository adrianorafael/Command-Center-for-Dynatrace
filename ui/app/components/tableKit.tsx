import React from "react";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { Text, TextEllipsis } from "@dynatrace/strato-components/typography";
import { Avatar, AvatarGroup } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { initials } from "./format";

/**
 * One visual variant for every structured-list table outside the Console:
 * default density (avatars fit the row), horizontal dividers, cells centred vertically.
 */
export const LIST_TABLE_VARIANT = {
  rowDensity: "default",
  rowSeparation: "horizontalDividers",
  verticalAlignment: { header: "center", body: "center" },
} as const;

/** Single-line cell text: truncates with an ellipsis and shows the full text in a tooltip. */
export const CellText = ({ children, subdued, code }: { children: string; subdued?: boolean; code?: boolean }) => (
  <Tooltip text={children}>
    <Text
      fontStyle={code ? "code" : undefined}
      style={{ display: "block", minWidth: 0, maxWidth: "100%", ...(subdued ? { color: Colors.Text.Neutral.Subdued } : {}) }}
    >
      <TextEllipsis>{children}</TextEllipsis>
    </Text>
  </Tooltip>
);

/** Muted placeholder for empty cells ("None", "–"). */
export const CellEmpty = ({ children = "–" }: { children?: string }) => <Text style={{ color: Colors.Text.Neutral.Subdued }}>{children}</Text>;

/** Small avatar + name, vertically centred, truncated with tooltip. */
export const CellPerson = ({ name, subtitle }: { name: string; subtitle?: string }) => (
  <Flex alignItems="center" style={{ minWidth: 0 }}>
    <Avatar size="small" abbreviation={initials(name)}>
      <Avatar.Label>{name}</Avatar.Label>
      {subtitle && <Avatar.Subtitle>{subtitle}</Avatar.Subtitle>}
    </Avatar>
  </Flex>
);

/** Compact avatar group (names in tooltips), at most `max` avatars plus a "+n" count. */
export const CellPeople = ({ names, max = 5 }: { names: string[]; max?: number }) => {
  if (!names.length) return <CellEmpty>No one</CellEmpty>;
  const shown = names.slice(0, max);
  return (
    <Flex alignItems="center" gap={4}>
      <AvatarGroup>
        {shown.map((n, i) => (
          <AvatarGroup.Item key={`${n}-${i}`} abbreviation={initials(n)} tooltipText={n} />
        ))}
      </AvatarGroup>
      {names.length > max && <Text textStyle="small">+{names.length - max}</Text>}
    </Flex>
  );
};
