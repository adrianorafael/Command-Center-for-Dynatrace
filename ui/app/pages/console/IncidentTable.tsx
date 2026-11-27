/** The Console's incident table: columns, row and bulk actions (inline ones chosen per viewer), preview and the per-browser column choice. */
import React, { useMemo, useState } from "react";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Grid } from "@dynatrace/strato-components/layouts";
import { Menu } from "@dynatrace/strato-components/navigation";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { ChipGroup, Chip } from "@dynatrace/strato-components/content";
import { Text, TextEllipsis, Heading, Paragraph } from "@dynatrace/strato-components/typography";
import {
  AccountIcon,
  ArrowUpIcon,
  CheckmarkIcon,
  CopyIcon,
  CriticalFailedIcon,
  AiIcon,
  DescriptionIcon,
  DotMenuIcon,
  EditIcon,
  EventIcon,
  PauseIcon,
  SuccessIcon,
  GroupIcon,
} from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { EscalationPolicy, Incident, NotificationRecord } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { Cell } from "../../components/tableKit";
import { Avatar } from "@dynatrace/strato-components/content";
import { WarRoomModal } from "../warrooms/WarRoomModal";
import { isSafeHttpsUrl, openRoomsForIncident } from "../../domain/warrooms";
import { PriorityChip } from "../../components/PriorityChip";
import { DELIVERY, StatusIndicator } from "../../components/StatusIndicator";
import { AgeText } from "../../components/AgeText";
import { AssigneeView } from "../../components/UserAvatar";
import { EscalationCell, EscalationSteps } from "../../components/EscalationProgress";
import { ChannelIcon, CHANNEL_LABEL } from "../../components/ChannelIcon";
import { IconButton } from "../../components/IconButton";
import { formatDateTime, formatRelative, formatTime, initials } from "../../components/format";
import { PRIORITY_RANK, SOURCE_LABEL } from "./filters";
import { SNOOZE_PRESETS, useIncidentCommands } from "./useIncidentCommands";
import type { ModalRequest } from "./ActionModals";
import { incidentLink, problemUrl } from "./links";
import { menuActions, ROW_ACTION_LABEL, type RowActionId } from "./rowActions";

/** An incident plus the display fields the table sorts and filters on. */
export interface IncidentRow extends Incident {
  ageMs: number;
  rank: number;
  serviceName: string;
  teamName: string;
  assigneeName: string;
  /** Display name of who acknowledged; "" when not acknowledged (sorts first, downloads as an empty cell). */
  ackByName: string;
  lastNotification?: NotificationRecord;
}

/** One row action as this row shows it: a hidden action is left out, a disabled one says why on hover. */
interface RowActionView {
  label: string;
  icon: React.ReactElement;
  hidden?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Snooze is a submenu (presets + Custom…), the others run on select. */
  run?: () => void;
}

/**
 * Every row action with its per-row state, keyed by id, so the inline buttons and the "⋯" menu share one definition
 * and an action behaves the same wherever the person put it.
 */
function useRowActionViews(incident: Incident, onModal: (r: ModalRequest) => void, onWarRoom: () => void): Record<RowActionId, RowActionView> {
  const cmd = useIncidentCommands();
  const { data } = useAppData();
  const ids = [incident.id];
  const davis = problemUrl(incident);
  const room = openRoomsForIncident(data?.warRooms ?? [], incident.id).find((r) => isSafeHttpsUrl(r.url));
  const resolved = incident.status === "resolved";
  return {
    ack: {
      label: ROW_ACTION_LABEL.ack,
      icon: <CheckmarkIcon />,
      disabled: incident.status !== "triggered",
      disabledReason: resolved ? "Already resolved" : "Already acknowledged",
      run: () => void cmd.ack(ids),
    },
    resolve: {
      label: ROW_ACTION_LABEL.resolve,
      icon: <SuccessIcon />,
      disabled: resolved,
      disabledReason: "Already resolved",
      run: () => void cmd.resolve(ids),
    },
    reassign: { label: "Reassign…", icon: <AccountIcon />, run: () => onModal({ kind: "reassign", ids }) },
    escalate: {
      label: ROW_ACTION_LABEL.escalate,
      icon: <ArrowUpIcon />,
      disabled: resolved,
      disabledReason: "Already resolved",
      run: () => void cmd.escalate(ids),
    },
    snooze: { label: ROW_ACTION_LABEL.snooze, icon: <PauseIcon /> },
    priority: { label: "Change priority…", icon: <EditIcon />, run: () => onModal({ kind: "priority", ids }) },
    note: { label: ROW_ACTION_LABEL.note, icon: <DescriptionIcon />, run: () => onModal({ kind: "note", ids }) },
    warroom: room
      ? { label: "Join war room", icon: <GroupIcon />, run: () => window.open(room.url, "_blank", "noopener,noreferrer") }
      : { label: "Open war room…", icon: <GroupIcon />, run: onWarRoom },
    davis: {
      label: ROW_ACTION_LABEL.davis,
      icon: <AiIcon />,
      // Hidden in the menu as before; inline it stays as a disabled button so the buttons line up across rows.
      hidden: !davis,
      disabledReason: "Not from a Davis problem",
      run: davis ? () => window.open(davis, "_blank", "noopener,noreferrer") : undefined,
    },
    copylink: {
      label: ROW_ACTION_LABEL.copylink,
      icon: <CopyIcon />,
      run: () => void navigator.clipboard?.writeText(incidentLink(incident.id)),
    },
  };
}

const SnoozeItems = ({ ids, onModal }: { ids: string[]; onModal: (r: ModalRequest) => void }) => {
  const cmd = useIncidentCommands();
  return (
    <>
      {SNOOZE_PRESETS.map((p) => (
        <Menu.Item key={p.label} onSelect={() => void cmd.snoozeFor(ids, p.ms)}>
          {p.label}
        </Menu.Item>
      ))}
      <Menu.Item onSelect={() => onModal({ kind: "snooze", ids })}>Custom…</Menu.Item>
    </>
  );
};

/** The buttons the person chose to show inline (in their order), then "⋯" with every other action. */
const RowQuickActions = ({
  incident,
  size,
  onModal,
  inline,
}: {
  incident: Incident;
  size: "default" | "condensed";
  onModal: (r: ModalRequest) => void;
  inline: readonly RowActionId[];
}) => {
  // Lives here, not in the menu, so an inline war-room button can open the dialog too.
  const [warRoom, setWarRoom] = useState(false);
  const views = useRowActionViews(incident, onModal, () => setWarRoom(true));
  const ids = [incident.id];
  const menu = menuActions(inline).filter((id) => !views[id].hidden);
  return (
    <Flex gap={4}>
      {inline.map((id) => {
        const v = views[id];
        if (id === "snooze") {
          return (
            <Menu key={id}>
              <Menu.Trigger>
                <Tooltip text={v.label}>
                  <Button aria-label={v.label} size={size}>
                    <Button.Prefix>{v.icon}</Button.Prefix>
                  </Button>
                </Tooltip>
              </Menu.Trigger>
              <Menu.Content>
                <SnoozeItems ids={ids} onModal={onModal} />
              </Menu.Content>
            </Menu>
          );
        }
        return (
          <IconButton
            key={id}
            label={v.label}
            icon={v.icon}
            size={size}
            disabled={v.disabled || v.hidden}
            disabledReason={v.disabledReason}
            onClick={v.run}
          />
        );
      })}
      {menu.length > 0 && (
        <Menu>
          <Menu.Trigger>
            <Button aria-label="More actions" size={size}>
              <Button.Prefix>
                <DotMenuIcon />
              </Button.Prefix>
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            {menu.map((id) => {
              const v = views[id];
              if (id === "snooze") {
                return (
                  <Menu.Sub key={id}>
                    <Menu.SubTrigger>
                      <Menu.Prefix>{v.icon}</Menu.Prefix>
                      {v.label}
                    </Menu.SubTrigger>
                    <Menu.SubContent>
                      <SnoozeItems ids={ids} onModal={onModal} />
                    </Menu.SubContent>
                  </Menu.Sub>
                );
              }
              return (
                <Menu.Item key={id} disabled={v.disabled} onSelect={() => v.run?.()}>
                  <Menu.Prefix>{v.icon}</Menu.Prefix>
                  {v.label}
                </Menu.Item>
              );
            })}
          </Menu.Content>
        </Menu>
      )}
      {warRoom && <WarRoomModal request={{ mode: "create", incidentId: incident.id }} onClose={() => setWarRoom(false)} />}
    </Flex>
  );
};

const BulkActions = ({ rows, onModal }: { rows: Incident[]; onModal: (r: ModalRequest) => void }) => {
  const cmd = useIncidentCommands();
  const ids = rows.map((r) => r.id);
  const resolved = rows.filter((r) => r.status === "resolved").length;
  const notTriggered = rows.filter((r) => r.status !== "triggered").length;
  const reason = (n: number, what: string) => `${n} of ${rows.length} are ${what}`;
  const wrap = (disabled: boolean, why: string, el: React.ReactElement) =>
    disabled ? <Tooltip text={why}>{el}</Tooltip> : el;
  return (
    <Flex gap={8} alignItems="center">
      <DataTable.SelectionChip />
      {wrap(
        notTriggered > 0,
        reason(notTriggered, "not triggered"),
        <Button disabled={notTriggered > 0} onClick={() => void cmd.ack(ids)}>
          <Button.Prefix>
            <CheckmarkIcon />
          </Button.Prefix>
          Acknowledge
        </Button>,
      )}
      {wrap(
        resolved > 0,
        reason(resolved, "already resolved"),
        <Button
          disabled={resolved > 0}
          onClick={() => (ids.length > 10 ? onModal({ kind: "resolve-many", ids }) : void cmd.resolve(ids))}
        >
          <Button.Prefix>
            <SuccessIcon />
          </Button.Prefix>
          Resolve
        </Button>,
      )}
      <Button onClick={() => onModal({ kind: "reassign", ids })}>Reassign…</Button>
      {wrap(
        resolved > 0,
        reason(resolved, "already resolved"),
        <Button disabled={resolved > 0} onClick={() => onModal({ kind: "snooze", ids })}>
          Snooze…
        </Button>,
      )}
      <Menu>
        <Menu.Trigger>
          <Button aria-label="More bulk actions">
            <Button.Prefix>
              <DotMenuIcon />
            </Button.Prefix>
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item disabled={resolved > 0} onSelect={() => void cmd.escalate(ids)}>
            Escalate now
          </Menu.Item>
          <Menu.Item onSelect={() => onModal({ kind: "priority", ids })}>Set priority…</Menu.Item>
        </Menu.Content>
      </Menu>
    </Flex>
  );
};

const IncidentPreview = ({
  incident,
  policy,
  onOpen,
}: {
  incident: Incident;
  policy?: EscalationPolicy;
  onOpen: () => void;
}) => {
  const { now, userName, data } = useAppData();
  const tz = data?.settings.ui.timeZone;
  const last = [...incident.timeline].sort((a, b) => b.at - a.at).slice(0, 3);
  return (
    <DataTable.ExpandableRowWrapper>
      <Grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap={16} padding={8}>
        <Flex flexDirection="column" gap={8}>
          <Heading level={6}>Description</Heading>
          <Paragraph>{incident.alert.description || "No description."}</Paragraph>
          {incident.alert.entities.length > 0 && (
            <ChipGroup>
              {incident.alert.entities.slice(0, 6).map((e) => (
                <Chip key={e.id} size="condensed">
                  {e.name ?? e.id}
                </Chip>
              ))}
            </ChipGroup>
          )}
        </Flex>
        <Flex flexDirection="column" gap={8}>
          <Heading level={6}>Latest activity</Heading>
          {last.map((t, i) => (
            <Text key={i} textStyle="small">
              {formatTime(t.at, tz)} · {t.detail ?? t.type} · {userName(t.by)}
            </Text>
          ))}
        </Flex>
        <Flex flexDirection="column" gap={8}>
          <Heading level={6}>Escalation</Heading>
          <EscalationSteps incident={incident} policy={policy} now={now} timeZone={tz} />
          <Flex>
            <Button variant="emphasized" onClick={onOpen}>
              Open details
            </Button>
          </Flex>
        </Flex>
      </Grid>
    </DataTable.ExpandableRowWrapper>
  );
};

/** Room kept at the right of the table toolbar for the "Row actions" gear ConsolePage lays over it (button 36 + gap 4). */
export const TOOLBAR_GEAR_SPACE = 40;

const VISIBILITY_KEY = "command-center.console-columns.v1";
/**
 * Columns hidden until the person shows them. A column missing here and in the stored choice is visible, so new
 * columns (e.g. "Acknowledged by") appear for people who saved a choice before they existed.
 */
const DEFAULT_VISIBILITY: Record<string, boolean> = { createdAt: false, source: false };

/** Column visibility chosen in the table's column settings, kept per browser (survives refresh and reloads). */
function useColumnVisibility(): [Record<string, boolean>, (v: Record<string, boolean>) => void] {
  const [v, setV] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(VISIBILITY_KEY);
      return raw ? { ...DEFAULT_VISIBILITY, ...(JSON.parse(raw) as Record<string, boolean>) } : DEFAULT_VISIBILITY;
    } catch {
      return DEFAULT_VISIBILITY;
    }
  });
  const update = (next: Record<string, boolean>) => {
    setV(next);
    try {
      window.localStorage.setItem(VISIBILITY_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: the choice lasts for this session only
    }
  };
  return [v, update];
}

/**
 * Custom cells don't get the default cell inset; DataTable.DefaultCell restores it so every column keeps
 * the same distance from its dividers as plain text cells (measured: content x == header text x).
 */
function withCellInset(cols: DataTableColumnDef<IncidentRow>[]): DataTableColumnDef<IncidentRow>[] {
  return cols.map((col) => {
    const render = col.cell;
    if (typeof render !== "function") return col;
    const padded: typeof render = (ctx) => <Cell>{render(ctx)}</Cell>;
    return { ...col, cell: padded } as DataTableColumnDef<IncidentRow>;
  });
}

export const IncidentTable = ({
  incidents,
  loading,
  activeId,
  onActivate,
  selected,
  onSelect,
  onModal,
  empty,
  density,
  ackTargetMs,
  inlineActions,
}: {
  incidents: Incident[];
  loading: boolean;
  activeId: string | null;
  onActivate: (id: string | null) => void;
  selected: Record<string, boolean>;
  onSelect: (s: Record<string, boolean>) => void;
  onModal: (r: ModalRequest) => void;
  empty: React.ReactNode;
  density: "default" | "condensed";
  ackTargetMs: number;
  /** Row actions shown as buttons (the person's choice, see rowActions.ts); the rest go in "⋯". */
  inlineActions: readonly RowActionId[];
}) => {
  const [columnVisibility, setColumnVisibility] = useColumnVisibility();
  const { data, now, userName } = useAppData();
  const tz = data?.settings.ui.timeZone;

  const rows = useMemo<IncidentRow[]>(() => {
    const lastNtf = new Map<string, NotificationRecord>();
    (data?.notifications ?? []).forEach((n) => {
      const cur = lastNtf.get(n.incidentId);
      const at = n.reportedAt ?? n.plannedAt;
      if (!cur || (cur.reportedAt ?? cur.plannedAt) < at) lastNtf.set(n.incidentId, n);
    });
    return incidents.map((i) => ({
      ...i,
      ageMs: now - i.createdAt,
      rank: PRIORITY_RANK[i.priority],
      serviceName: data?.services.find((s) => s.id === i.serviceId)?.name ?? "–",
      teamName: data?.teams.find((t) => t.id === i.teamId)?.name ?? "–",
      assigneeName: i.assignee ? (i.assignee.type === "team" ? (data?.teams.find((t) => t.id === i.assignee?.id)?.name ?? "") : userName(i.assignee.id)) : "Unassigned",
      // Guard: userName(undefined) answers "Unassigned", which is wrong here.
      ackByName: i.acknowledgedBy ? userName(i.acknowledgedBy) : "",
      lastNotification: lastNtf.get(i.id),
    }));
  }, [incidents, data, now, userName]);

  const columns = useMemo<DataTableColumnDef<IncidentRow>[]>(
    () => withCellInset([
      {
        id: "priority",
        header: "Priority",
        accessor: "rank",
        width: 100,
        sortType: "number",
        cell: ({ rowData }) => <PriorityChip priority={rowData.priority} size="condensed" />,
      },
      {
        id: "status",
        header: "Status",
        accessor: "status",
        width: 128,
        cell: ({ rowData }) => (
          <Flex flexDirection="column" gap={0}>
            <StatusIndicator status={rowData.status} />
            {rowData.status === "snoozed" && rowData.snoozedUntil && (
              <Text textStyle="small">until {formatTime(rowData.snoozedUntil, tz)}</Text>
            )}
          </Flex>
        ),
      },
      {
        id: "title",
        header: "Incident",
        accessor: (r) => r.alert.title,
        width: "1fr",
        minWidth: 260,
        cell: ({ rowData }) => (
          <Flex flexDirection="column" gap={0} style={{ minWidth: 0 }}>
            <Text textStyle="base-emphasized">
              <TextEllipsis>{rowData.alert.title}</TextEllipsis>
            </Text>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              <TextEllipsis>
                {`#${rowData.alert.displayId ?? rowData.id}${rowData.alert.entities[0] ? ` · ${rowData.alert.entities[0].name ?? rowData.alert.entities[0].id}` : ""}`}
              </TextEllipsis>
            </Text>
          </Flex>
        ),
      },
      {
        id: "age",
        header: "Age",
        accessor: "ageMs",
        width: 90,
        sortType: "number",
        cell: ({ rowData }) => (
          <AgeText
            since={rowData.createdAt}
            now={now}
            timeZone={tz}
            overdueAfterMs={rowData.status === "triggered" ? ackTargetMs : undefined}
          />
        ),
      },
      {
        id: "source",
        header: "Source",
        accessor: (r) => SOURCE_LABEL[r.alert.source] ?? r.alert.source,
        width: 130,
        cell: ({ rowData }) => (
          <Flex alignItems="center" gap={4}>
            {rowData.alert.source === "davis-problem" ? <AiIcon /> : <EventIcon />}
            <Text>{SOURCE_LABEL[rowData.alert.source] ?? rowData.alert.source}</Text>
          </Flex>
        ),
      },
      { id: "service", header: "Service", accessor: "serviceName", width: 130 },
      { id: "team", header: "Team", accessor: "teamName", width: 120 },
      {
        id: "assignee",
        header: "Assignee",
        accessor: "assigneeName",
        width: 130,
        cell: ({ rowData }) =>
          rowData.assignee ? (
            <Cell>
              <Tooltip text={rowData.assigneeName}>
                <Flex alignItems="center" gap={6} style={{ minWidth: 0, width: "100%" }}>
                  <Avatar size="small" abbreviation={initials(rowData.assigneeName)} />
                  <Text style={{ minWidth: 0, flex: "1 1 auto" }}>
                    <TextEllipsis>{rowData.assigneeName}</TextEllipsis>
                  </Text>
                </Flex>
              </Tooltip>
            </Cell>
          ) : (
            <Cell>
              <AssigneeView assignee={undefined} />
            </Cell>
          ),
      },
      {
        // Kept after resolve (domain clears it only on unack/reopen), so resolved rows still show who took them.
        id: "acknowledgedBy",
        header: "Acknowledged by",
        accessor: "ackByName",
        width: 140,
        cell: ({ rowData }) =>
          rowData.acknowledgedBy ? (
            <Tooltip
              text={`${rowData.ackByName}${rowData.acknowledgedAt ? ` · ${formatDateTime(rowData.acknowledgedAt, tz)}` : ""}`}
            >
              <Flex flexDirection="column" gap={0} style={{ minWidth: 0, width: "100%" }}>
                <Text>
                  <TextEllipsis>{rowData.ackByName}</TextEllipsis>
                </Text>
                {rowData.acknowledgedAt && (
                  <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                    {formatTime(rowData.acknowledgedAt, tz)}
                  </Text>
                )}
              </Flex>
            </Tooltip>
          ) : (
            // Empty on purpose: a dash in every unacknowledged row would be noise. DataTable cells must return an element.
            <></>
          ),
      },
      {
        id: "escalation",
        header: "Escalation",
        accessor: (r) => (r.escalation.exhausted ? 99 : r.escalation.lastStepIndex),
        sortType: "number",
        width: 120,
        cell: ({ rowData }) => (
          <div style={{ width: "100%", paddingRight: 12, boxSizing: "border-box" }}>
            <EscalationCell incident={rowData} policy={data?.policies.find((p) => p.id === rowData.policyId)} />
          </div>
        ),
      },
      {
        id: "notified",
        header: "Last notified",
        accessor: (r) => r.lastNotification?.reportedAt ?? r.lastNotification?.plannedAt ?? 0,
        sortType: "number",
        width: 130,
        cell: ({ rowData }) => {
          const n = rowData.lastNotification;
          if (!n) return <Text style={{ color: Colors.Text.Neutral.Subdued }}>–</Text>;
          const failed = n.status === "failed" || n.status === "timeout";
          return (
            <Tooltip text={`${CHANNEL_LABEL[n.channel]} to ${n.to.name ?? userName(n.to.uid)} · ${DELIVERY[n.status].label}`}>
              <Flex alignItems="center" gap={4} style={{ minWidth: 0, width: "100%", overflow: "hidden" }}>
                {failed ? <CriticalFailedIcon style={{ color: Colors.Icon.Critical.Default, flexShrink: 0 }} /> : <ChannelIcon channel={n.channel} />}
                <Text style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "1 1 auto" }}>{formatRelative(n.reportedAt ?? n.plannedAt, now)}</Text>
              </Flex>
            </Tooltip>
          );
        },
      },
      { id: "createdAt", header: "Created", accessor: (r) => new Date(r.createdAt), columnType: "datetime", width: 170 },
    ]),
    [data, now, tz, ackTargetMs, userName],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      rowId={(r) => r.id}
      fullWidth
      sortable
      resizable
      columnOrdering
      defaultSortBy={[
        { id: "priority", desc: false },
        { id: "age", desc: true },
      ]}
      variant={{ rowDensity: density, rowSeparation: "horizontalDividers", verticalAlignment: { header: "center", body: "center" } }}
      selectableRows
      selectedRows={selected}
      onRowSelectionChange={onSelect}
      interactiveRows
      activeRow={activeId}
      // DataTable resets the active row to `null` (with no event) whenever `data` changes: first load, every
      // auto-refresh and every filter change. Ignore that reset so /incidents/:id deep links and the open details
      // panel survive polling; user deactivation always carries an event.
      onActiveRowChange={(id, event) => {
        if (id === null && !event) return;
        onActivate(id);
      }}
      loading={loading}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={setColumnVisibility}
    >
      <DataTable.Toolbar style={{ marginRight: TOOLBAR_GEAR_SPACE }}>
        <DataTable.LineWrap />
        <DataTable.VisibilitySettings />
        <DataTable.ColumnOrderSettings />
        <DataTable.DownloadData />
      </DataTable.Toolbar>
      <DataTable.SelectedRowsActions>
        {(sel) => <BulkActions rows={sel.map((s) => s.originalRow as IncidentRow)} onModal={onModal} />}
      </DataTable.SelectedRowsActions>
      <DataTable.RowActions>
        {(row, { rowDensity }) => (
          <RowQuickActions
            incident={row as IncidentRow}
            size={rowDensity === "comfortable" ? "default" : rowDensity}
            onModal={onModal}
            inline={inlineActions}
          />
        )}
      </DataTable.RowActions>
      <DataTable.ExpandableRow>
        {({ row }) => (
          <IncidentPreview
            incident={row as IncidentRow}
            policy={data?.policies.find((p) => p.id === (row as IncidentRow).policyId)}
            onOpen={() => onActivate((row as IncidentRow).id)}
          />
        )}
      </DataTable.ExpandableRow>
      <DataTable.EmptyState>{empty}</DataTable.EmptyState>
      <DataTable.Pagination defaultPageSize={50} />
    </DataTable>
  );
};
