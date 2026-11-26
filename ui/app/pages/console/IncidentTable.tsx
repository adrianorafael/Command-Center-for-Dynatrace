import React, { useMemo } from "react";
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
} from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { EscalationPolicy, Incident, NotificationRecord } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { PriorityChip } from "../../components/PriorityChip";
import { StatusIndicator } from "../../components/StatusIndicator";
import { AgeText } from "../../components/AgeText";
import { AssigneeView } from "../../components/UserAvatar";
import { EscalationCell, EscalationSteps } from "../../components/EscalationProgress";
import { ChannelIcon, CHANNEL_LABEL } from "../../components/ChannelIcon";
import { IconButton } from "../../components/IconButton";
import { formatRelative, formatTime } from "../../components/format";
import { PRIORITY_RANK, SOURCE_LABEL } from "./filters";
import { SNOOZE_PRESETS, useIncidentCommands } from "./useIncidentCommands";
import type { ModalRequest } from "./ActionModals";
import { incidentLink, problemUrl } from "./links";

export interface IncidentRow extends Incident {
  ageMs: number;
  rank: number;
  serviceName: string;
  teamName: string;
  assigneeName: string;
  lastNotification?: NotificationRecord;
}

const MoreActions = ({
  incident,
  onModal,
  size,
}: {
  incident: Incident;
  onModal: (r: ModalRequest) => void;
  size: "default" | "condensed";
}) => {
  const cmd = useIncidentCommands();
  const ids = [incident.id];
  const davis = problemUrl(incident);
  return (
    <Menu>
      <Menu.Trigger>
        <Button aria-label="More actions" size={size}>
          <Button.Prefix>
            <DotMenuIcon />
          </Button.Prefix>
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item onSelect={() => onModal({ kind: "reassign", ids })}>
          <Menu.Prefix>
            <AccountIcon />
          </Menu.Prefix>
          Reassign…
        </Menu.Item>
        <Menu.Item disabled={incident.status === "resolved"} onSelect={() => void cmd.escalate(ids)}>
          <Menu.Prefix>
            <ArrowUpIcon />
          </Menu.Prefix>
          Escalate now
        </Menu.Item>
        <Menu.Sub>
          <Menu.SubTrigger>
            <Menu.Prefix>
              <PauseIcon />
            </Menu.Prefix>
            Snooze
          </Menu.SubTrigger>
          <Menu.SubContent>
            {SNOOZE_PRESETS.map((p) => (
              <Menu.Item key={p.label} onSelect={() => void cmd.snoozeFor(ids, p.ms)}>
                {p.label}
              </Menu.Item>
            ))}
            <Menu.Item onSelect={() => onModal({ kind: "snooze", ids })}>Custom…</Menu.Item>
          </Menu.SubContent>
        </Menu.Sub>
        <Menu.Item onSelect={() => onModal({ kind: "priority", ids })}>
          <Menu.Prefix>
            <EditIcon />
          </Menu.Prefix>
          Change priority…
        </Menu.Item>
        <Menu.Item onSelect={() => onModal({ kind: "note", ids })}>
          <Menu.Prefix>
            <DescriptionIcon />
          </Menu.Prefix>
          Add note
        </Menu.Item>
        {davis && (
          <Menu.Item onSelect={() => window.open(davis, "_blank", "noopener,noreferrer")}>
            <Menu.Prefix>
              <AiIcon />
            </Menu.Prefix>
            Open Davis problem
          </Menu.Item>
        )}
        <Menu.Item onSelect={() => void navigator.clipboard?.writeText(incidentLink(incident.id))}>
          <Menu.Prefix>
            <CopyIcon />
          </Menu.Prefix>
          Copy link
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
};

const RowQuickActions = ({
  incident,
  size,
  onModal,
}: {
  incident: Incident;
  size: "default" | "condensed";
  onModal: (r: ModalRequest) => void;
}) => {
  const cmd = useIncidentCommands();
  return (
    <Flex gap={4}>
      <IconButton
        label="Acknowledge"
        icon={<CheckmarkIcon />}
        size={size}
        disabled={incident.status !== "triggered"}
        disabledReason={incident.status === "resolved" ? "Already resolved" : "Already acknowledged"}
        onClick={() => void cmd.ack([incident.id])}
      />
      <IconButton
        label="Resolve"
        icon={<SuccessIcon />}
        size={size}
        disabled={incident.status === "resolved"}
        disabledReason="Already resolved"
        onClick={() => void cmd.resolve([incident.id])}
      />
      <MoreActions incident={incident} onModal={onModal} size={size} />
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
}) => {
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
      lastNotification: lastNtf.get(i.id),
    }));
  }, [incidents, data, now, userName]);

  const columns = useMemo<DataTableColumnDef<IncidentRow>[]>(
    () => [
      {
        id: "priority",
        header: "Priority",
        accessor: "rank",
        width: 92,
        sortType: "number",
        cell: ({ rowData }) => <PriorityChip priority={rowData.priority} size="condensed" />,
      },
      {
        id: "status",
        header: "Status",
        accessor: "status",
        width: 150,
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
        width: 100,
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
      { id: "service", header: "Service", accessor: "serviceName", width: 140 },
      { id: "team", header: "Team", accessor: "teamName", width: 120 },
      {
        id: "assignee",
        header: "Assignee",
        accessor: "assigneeName",
        width: 160,
        cell: ({ rowData }) => <AssigneeView assignee={rowData.assignee} />,
      },
      {
        id: "escalation",
        header: "Escalation",
        accessor: (r) => (r.escalation.exhausted ? 99 : r.escalation.lastStepIndex),
        sortType: "number",
        width: 150,
        cell: ({ rowData }) => (
          <EscalationCell incident={rowData} policy={data?.policies.find((p) => p.id === rowData.policyId)} />
        ),
      },
      {
        id: "notified",
        header: "Last notified",
        accessor: (r) => r.lastNotification?.reportedAt ?? r.lastNotification?.plannedAt ?? 0,
        sortType: "number",
        width: 150,
        cell: ({ rowData }) => {
          const n = rowData.lastNotification;
          if (!n) return <Text style={{ color: Colors.Text.Neutral.Subdued }}>–</Text>;
          const failed = n.status === "failed" || n.status === "timeout";
          return (
            <Tooltip text={`${CHANNEL_LABEL[n.channel]} to ${n.to.name ?? userName(n.to.uid)} · ${failed ? "failed" : n.status}`}>
              <Flex alignItems="center" gap={4}>
                {failed ? <CriticalFailedIcon style={{ color: Colors.Icon.Critical.Default }} /> : <ChannelIcon channel={n.channel} />}
                <Text>{formatRelative(n.reportedAt ?? n.plannedAt, now)}</Text>
              </Flex>
            </Tooltip>
          );
        },
      },
      { id: "createdAt", header: "Created", accessor: (r) => new Date(r.createdAt), columnType: "datetime", width: 170 },
    ],
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
      variant={{ rowDensity: density, rowSeparation: "horizontalDividers" }}
      selectableRows
      selectedRows={selected}
      onRowSelectionChange={onSelect}
      interactiveRows
      activeRow={activeId}
      // DataTable reports `null` when the active row id is not among its rows (data still loading, or a deep-linked
      // incident hidden by the filters); ignore that so /incidents/:id keeps the details panel open.
      onActiveRowChange={(id) => {
        if (id === null && activeId && !rows.some((r) => r.id === activeId)) return;
        onActivate(id);
      }}
      loading={loading}
      columnVisibility={{ createdAt: false, source: false }}
    >
      <DataTable.Toolbar>
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
          <RowQuickActions incident={row as IncidentRow} size={rowDensity === "comfortable" ? "default" : rowDensity} onModal={onModal} />
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
