/** Details panel of one incident: actions, escalation progress, notification ledger, entities and timeline. */
import { CreatedMarker, markCreated } from "../../components/NewItemHighlight";
import { WarRoomModal, type WarRoomRequest } from "../warrooms/WarRoomModal";
import { isSafeHttpsUrl, openRoomsForIncident } from "../../domain/warrooms";
import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text, ExternalLink } from "@dynatrace/strato-components/typography";
import { Menu, Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { FormField, Label, TextArea } from "@dynatrace/strato-components/forms";
import { Avatar, Chip, ChipGroup, Markdown } from "@dynatrace/strato-components/content";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import {
  AccountIcon,
  ArrowUpIcon,
  CheckmarkIcon,
  CopyIcon,
  AiIcon,
  DescriptionIcon,
  DotMenuIcon,
  HostsIcon,
  NotificationActiveIcon,
  PauseIcon,
  StepIcon,
  SuccessIcon,
  TimelineEventIcon,
  GroupIcon,
} from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { EntityRef, Incident, NotificationRecord } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { PriorityChip } from "../../components/PriorityChip";
import { DeliveryStatus, StatusIndicator } from "../../components/StatusIndicator";
import { IncidentTimeline } from "../../components/IncidentTimeline";
import { EscalationSteps } from "../../components/EscalationProgress";
import { IconButton } from "../../components/IconButton";
import { ChannelIcon, CHANNEL_LABEL } from "../../components/ChannelIcon";
import { SimpleEmpty } from "../../components/QueryState";
import { formatDateTime, formatDuration, formatTime, initials, zoneAbbr } from "../../components/format";
import { SOURCE_LABEL } from "./filters";
import { SNOOZE_PRESETS, useIncidentCommands } from "./useIncidentCommands";
import type { ModalRequest } from "./ActionModals";
import { incidentLink, problemUrl } from "./links";

const EntitiesTable = ({ entities }: { entities: EntityRef[] }) => {
  const columns: DataTableColumnDef<EntityRef>[] = [
    {
      id: "name",
      header: "Entity",
      accessor: (e) => e.name ?? e.id,
      cell: ({ rowData }) => (
        <Flex alignItems="center" gap={4}>
          <HostsIcon />
          <Text>{rowData.name ?? rowData.id}</Text>
        </Flex>
      ),
    },
    { id: "type", header: "Type", accessor: (e) => e.type ?? "–", width: 120 },
    { id: "id", header: "Entity ID", accessor: "id", width: 200, cell: ({ value }) => <Text fontStyle="code">{String(value)}</Text> },
  ];
  if (!entities.length)
    return <SimpleEmpty size="small" title="No affected entities" details="This event wasn't linked to a Dynatrace entity." />;
  return <DataTable data={entities} columns={columns} rowId={(e) => e.id} fullWidth variant={{ rowDensity: "condensed" }} />;
};

/** NotificationRecord.step is an ordinal across passes: pass * steps + stepIndex. */
function stepLabel(ordinal: number, steps: number | undefined): string {
  if (!steps) return `${ordinal + 1}`;
  const pass = Math.floor(ordinal / steps);
  return pass > 0 ? `${(ordinal % steps) + 1} (repeat ${pass})` : `${(ordinal % steps) + 1}`;
}

const LedgerTable = ({ records, steps }: { records: NotificationRecord[]; steps?: number }) => {
  const { data, userName } = useAppData();
  const tz = data?.settings.ui.timeZone;
  const columns: DataTableColumnDef<NotificationRecord>[] = [
    {
      id: "channel",
      header: "Channel",
      accessor: (r) => CHANNEL_LABEL[r.channel],
      width: 140,
      cell: ({ rowData }) => (
        <Flex alignItems="center" gap={4}>
          <ChannelIcon channel={rowData.channel} />
          <Text>{CHANNEL_LABEL[rowData.channel]}</Text>
        </Flex>
      ),
    },
    { id: "to", header: "Recipient", accessor: (r) => r.to.name ?? userName(r.to.uid), width: 150 },
    { id: "step", header: "Step", accessor: (r) => `${stepLabel(r.step, steps)} · try ${r.attempt}`, width: 150 },
    { id: "status", header: "Status", accessor: "status", width: 140, cell: ({ rowData }) => <DeliveryStatus status={rowData.status} /> },
    { id: "at", header: "Time", accessor: (r) => r.reportedAt ?? r.plannedAt, width: 90, cell: ({ value }) => <Text>{formatTime(Number(value), tz)}</Text> },
    { id: "error", header: "Details", accessor: (r) => r.error ?? r.providerRef ?? "", width: "1fr" },
  ];
  if (!records.length)
    return (
      <SimpleEmpty
        size="small"
        title="No notifications yet"
        details="Notifications appear here once the escalation policy pages someone through the engine workflow."
      />
    );
  return (
    <DataTable
      data={[...records].sort((a, b) => (b.reportedAt ?? b.plannedAt) - (a.reportedAt ?? a.plannedAt))}
      columns={columns}
      rowId={(r) => r.key}
      fullWidth
      variant={{ rowDensity: "condensed" }}
    />
  );
};

export const IncidentDetails = ({ incident, onModal }: { incident: Incident; onModal: (r: ModalRequest) => void }) => {
  const { data, now, act, userName } = useAppData();
  const cmd = useIncidentCommands();
  const [warRoom, setWarRoom] = useState<WarRoomRequest>();
  const rooms = openRoomsForIncident(data?.warRooms ?? [], incident.id).filter((r) => isSafeHttpsUrl(r.url));
  const [tab, setTab] = useState(0);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const tz = data?.settings.ui.timeZone;
  const ids = [incident.id];
  const service = data?.services.find((s) => s.id === incident.serviceId);
  const team = data?.teams.find((t) => t.id === incident.teamId);
  const policy = data?.policies.find((p) => p.id === incident.policyId);
  const notes = incident.timeline.filter((t) => t.type === "note").sort((a, b) => b.at - a.at);
  const ledger = (data?.notifications ?? []).filter((n) => n.incidentId === incident.id);
  const davis = problemUrl(incident);

  const meta = [
    `Opened ${formatTime(incident.createdAt, tz)} ${zoneAbbr(incident.createdAt, tz)}`,
    `${formatDuration(now - incident.createdAt)} ago`,
    service && `Service: ${service.name}`,
    team && `Team: ${team.name}`,
    `Source: ${SOURCE_LABEL[incident.alert.source] ?? incident.alert.source}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const addNote = () => {
    if (!note.trim()) return;
    setSavingNote(true);
    markCreated("note", incident.id);
    act(ids, { type: "note", text: note.trim() })
      .then(() => setNote(""))
      .catch(() => undefined)
      .finally(() => setSavingNote(false));
  };

  return (
    <Flex flexDirection="column" gap={16} padding={16}>
      <Flex alignItems="center" gap={8} flexWrap="wrap">
        <PriorityChip priority={incident.priority} />
        <StatusIndicator status={incident.status} visual="icon" />
        <Text fontStyle="code">#{incident.alert.displayId ?? incident.id}</Text>
        <IconButton label="Copy link" icon={<CopyIcon />} size="condensed" onClick={() => void navigator.clipboard?.writeText(incidentLink(incident.id))} />
      </Flex>
      <Heading level={2}>{incident.alert.title}</Heading>
      <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
        {meta}
      </Text>
      {incident.status === "snoozed" && incident.snoozedUntil && (
        <Text textStyle="small">Snoozed until {formatDateTime(incident.snoozedUntil, tz)}</Text>
      )}
      {incident.alert.underMaintenance && <Chip color="warning" size="condensed">Under maintenance: paging suppressed</Chip>}

      <Flex gap={8} flexWrap="wrap">
        {incident.status === "triggered" && (
          <Button color="primary" variant="accent" onClick={() => void cmd.ack(ids)}>
            <Button.Prefix>
              <CheckmarkIcon />
            </Button.Prefix>
            Acknowledge
          </Button>
        )}
        {(incident.status === "acknowledged" || incident.status === "snoozed") && (
          <Button color="primary" variant="accent" onClick={() => void cmd.resolve(ids)}>
            <Button.Prefix>
              <SuccessIcon />
            </Button.Prefix>
            Resolve
          </Button>
        )}
        {incident.status === "triggered" && (
          <Button onClick={() => void cmd.resolve(ids)}>
            <Button.Prefix>
              <SuccessIcon />
            </Button.Prefix>
            Resolve
          </Button>
        )}
        {incident.status === "resolved" && (
          <Button color="primary" variant="accent" onClick={() => void cmd.reopen(ids)}>
            Reopen
          </Button>
        )}
        <Button onClick={() => onModal({ kind: "reassign", ids })}>
          <Button.Prefix>
            <AccountIcon />
          </Button.Prefix>
          Reassign
        </Button>
        {rooms.length > 0 ? (
          <Button onClick={() => window.open(rooms[0].url, "_blank", "noopener,noreferrer")}>
            <Button.Prefix>
              <GroupIcon />
            </Button.Prefix>
            Join war room
          </Button>
        ) : (
          <Button onClick={() => setWarRoom({ mode: "create", incidentId: incident.id })}>
            <Button.Prefix>
              <GroupIcon />
            </Button.Prefix>
            Open war room
          </Button>
        )}
        {warRoom && <WarRoomModal request={warRoom} onClose={() => setWarRoom(undefined)} />}
        <Button disabled={incident.status === "resolved"} onClick={() => void cmd.escalate(ids)}>
          <Button.Prefix>
            <ArrowUpIcon />
          </Button.Prefix>
          Escalate now
        </Button>
        <Menu>
          <Menu.Trigger>
            <Button disabled={incident.status === "resolved"}>
              <Button.Prefix>
                <PauseIcon />
              </Button.Prefix>
              Snooze
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            {SNOOZE_PRESETS.map((p) => (
              <Menu.Item key={p.label} onSelect={() => void cmd.snoozeFor(ids, p.ms)}>
                {p.label}
              </Menu.Item>
            ))}
            <Menu.Item onSelect={() => onModal({ kind: "snooze", ids })}>Custom…</Menu.Item>
          </Menu.Content>
        </Menu>
        <Menu>
          <Menu.Trigger>
            <Button aria-label="More actions">
              <Button.Prefix>
                <DotMenuIcon />
              </Button.Prefix>
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item onSelect={() => onModal({ kind: "priority", ids })}>Change priority</Menu.Item>
            <Menu.Item onSelect={() => onModal({ kind: "note", ids })}>Add note</Menu.Item>
            {incident.status === "acknowledged" && <Menu.Item onSelect={() => void act(ids, { type: "unack" })}>Undo acknowledgement</Menu.Item>}
            <Menu.Item onSelect={() => void navigator.clipboard?.writeText(incidentLink(incident.id))}>Copy link</Menu.Item>
          </Menu.Content>
        </Menu>
      </Flex>
      {davis && (
        <Flex alignItems="center" gap={4}>
          <AiIcon />
          <ExternalLink href={davis}>Open in Problems app</ExternalLink>
        </Flex>
      )}
      {incident.assignee && (
        <Flex alignItems="center" gap={8}>
          <Text textStyle="small">Assigned to</Text>
          <Avatar size="small" abbreviation={initials(incident.assignee.type === "team" ? team?.name : userName(incident.assignee.id))}>
            <Avatar.Label>
              {incident.assignee.type === "team" ? (data?.teams.find((t) => t.id === incident.assignee?.id)?.name ?? "Team") : userName(incident.assignee.id)}
            </Avatar.Label>
          </Avatar>
        </Flex>
      )}
      {incident.acknowledgedBy && (
        <Flex alignItems="center" gap={8}>
          <Text textStyle="small">Acknowledged by</Text>
          <Avatar size="small" abbreviation={initials(userName(incident.acknowledgedBy))}>
            <Avatar.Label>{userName(incident.acknowledgedBy)}</Avatar.Label>
          </Avatar>
          {incident.acknowledgedAt && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              {formatDateTime(incident.acknowledgedAt, tz)}
            </Text>
          )}
        </Flex>
      )}
      {incident.alert.description && <Markdown>{incident.alert.description}</Markdown>}
      {incident.tags.length > 0 && (
        <ChipGroup>
          {incident.tags.map((t) => (
            <Chip key={t} size="condensed">
              {t}
            </Chip>
          ))}
        </ChipGroup>
      )}

      <Tabs selectedIndex={tab} onChange={setTab}>
        <Tab title="Timeline" prefixIcon={<TimelineEventIcon />}>
          <Flex paddingTop={12} flexDirection="column">
            <IncidentTimeline entries={incident.timeline} />
          </Flex>
        </Tab>
        <Tab title="Escalation" prefixIcon={<StepIcon />}>
          <Flex paddingTop={12} flexDirection="column" gap={12}>
            {policy && <Text textStyle="small">Policy: {policy.name}</Text>}
            <EscalationSteps incident={incident} policy={policy} now={now} timeZone={tz} />
            <Flex>
              <Button disabled={incident.status === "resolved"} onClick={() => void cmd.escalate(ids)}>
                <Button.Prefix>
                  <ArrowUpIcon />
                </Button.Prefix>
                Escalate now
              </Button>
            </Flex>
          </Flex>
        </Tab>
        <Tab title={`Notifications (${ledger.length})`} prefixIcon={<NotificationActiveIcon />}>
          <Flex paddingTop={12} flexDirection="column">
            <LedgerTable records={ledger} steps={policy?.steps.length} />
          </Flex>
        </Tab>
        <Tab title={`Entities (${incident.alert.entities.length})`} prefixIcon={<HostsIcon />}>
          <Flex paddingTop={12} flexDirection="column">
            <EntitiesTable entities={incident.alert.entities} />
          </Flex>
        </Tab>
        <Tab title={`Notes (${notes.length})`} prefixIcon={<DescriptionIcon />}>
          <Flex paddingTop={12} flexDirection="column" gap={16}>
            <FormField>
              <Label>Add note</Label>
              <TextArea value={note} onChange={(v) => setNote(v)} placeholder="What did you find or do? Markdown is supported." />
            </FormField>
            <Flex>
              <Button variant="emphasized" loading={savingNote} disabled={!note.trim()} onClick={addNote}>
                Add note
              </Button>
            </Flex>
            {notes.length === 0 && <Text>No notes yet. Notes are append-only and part of the audit trail.</Text>}
            {notes.map((n, i) => (
              <Flex key={i} flexDirection="column" gap={4} data-created-scope>
                {i === 0 && <CreatedMarker kind="note" id={incident.id} />}
                <Flex alignItems="center" gap={8}>
                  <Avatar size="small" abbreviation={initials(userName(n.by))}>
                    <Avatar.Label>{userName(n.by)}</Avatar.Label>
                  </Avatar>
                  <Text textStyle="small">{formatDateTime(n.at, tz)}</Text>
                </Flex>
                <Markdown>{n.detail ?? ""}</Markdown>
              </Flex>
            ))}
          </Flex>
        </Tab>
      </Tabs>
    </Flex>
  );
};
