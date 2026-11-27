import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { CreatedMarker } from "./NewItemHighlight";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { Link, Text, TextEllipsis } from "@dynatrace/strato-components/typography";
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
/**
 * Custom cells don't get the default cell inset; DataTable.DefaultCell restores it so custom and
 * plain cells line up with their headers.
 */
export const Cell = ({ children }: { children: React.ReactNode }) => <DataTable.DefaultCell>{children}</DataTable.DefaultCell>;

export const CellText = ({ children, subdued, code }: { children: string; subdued?: boolean; code?: boolean }) => (
  <Cell>
  <Tooltip text={children}>
    <Text
      fontStyle={code ? "code" : undefined}
      style={{ display: "block", minWidth: 0, maxWidth: "100%", ...(subdued ? { color: Colors.Text.Neutral.Subdued } : {}) }}
    >
      <TextEllipsis>{children}</TextEllipsis>
    </Text>
  </Tooltip>
  </Cell>
);

/** In-app link cell (context switch to a detail page), truncated with tooltip. */
export const CellLink = ({ to, children }: { to: string; children: string }) => (
  <Cell>
    <Tooltip text={children}>
      <Link as={RouterLink} to={to} style={{ display: "block", minWidth: 0, maxWidth: "100%" }}>
        <TextEllipsis>{children}</TextEllipsis>
      </Link>
    </Tooltip>
  </Cell>
);

/** Muted placeholder for empty cells ("None", "–"). */
export const CellEmpty = ({ children = "–" }: { children?: string }) => (
  <Cell>
    <Text style={{ color: Colors.Text.Neutral.Subdued }}>{children}</Text>
  </Cell>
);

/** Small avatar + name, vertically centred, truncated with tooltip. */
export const CellPerson = ({ name, subtitle }: { name: string; subtitle?: string }) => (
  <Cell>
    <Avatar size="small" abbreviation={initials(name)}>
      <Avatar.Label>{name}</Avatar.Label>
      {subtitle && <Avatar.Subtitle>{subtitle}</Avatar.Subtitle>}
    </Avatar>
  </Cell>
);

/** Compact avatar group (names in tooltips), at most `max` avatars plus a "+n" count. */
export const CellPeople = ({ names, max = 5 }: { names: string[]; max?: number }) => {
  if (!names.length) return <CellEmpty>No one</CellEmpty>;
  const shown = names.slice(0, max);
  return (
    <Cell>
    <Flex alignItems="center" gap={4}>
      <AvatarGroup>
        {shown.map((n, i) => (
          <AvatarGroup.Item key={`${n}-${i}`} abbreviation={initials(n)} tooltipText={n} />
        ))}
      </AvatarGroup>
      {names.length > max && <Text textStyle="small">+{names.length - max}</Text>}
    </Flex>
    </Cell>
  );
};

/**
 * Adds the "just created" marker to the first column with a custom cell, so a row created by a button
 * pulses once when it appears (see components/NewItemHighlight). Visuals are unchanged.
 */
export function withCreatedMarker<T>(
  cols: DataTableColumnDef<T>[],
  kind: string,
  idOf: (row: T) => string,
): DataTableColumnDef<T>[] {
  const target = cols.findIndex((c) => typeof c.cell === "function");
  if (target < 0) return cols;
  return cols.map((col, i) => {
    const render = col.cell;
    if (i !== target || typeof render !== "function") return col;
    const marked: typeof render = (ctx) => (
      <>
        {render(ctx)}
        <CreatedMarker kind={kind} id={idOf(ctx.rowData)} />
      </>
    );
    return { ...col, cell: marked } as DataTableColumnDef<T>;
  });
}
