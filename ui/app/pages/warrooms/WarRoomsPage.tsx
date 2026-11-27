/** War rooms (route `/war-rooms`): open and closed rooms with their incidents and notebooks. */
import React, { useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Flex, PageLayout } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { ExternalLink, Link, Text, TextEllipsis } from "@dynatrace/strato-components/typography";
import { Chip } from "@dynatrace/strato-components/content";
import { ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { PlusIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { closeWarRoom, isTodaysRoom, reopenWarRoom, warRoomDuration, type WarRoom } from "../../domain/warrooms";
import { useAppData } from "../../hooks/AppDataContext";
import { Cell, CellPerson, LIST_TABLE_VARIANT, withCreatedMarker } from "../../components/tableKit";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { Health } from "../../components/StatusIndicator";
import { ConfirmModal } from "../../components/ConfirmModal";
import { formatDateTime, formatDayTime, formatDuration } from "../../components/format";
import { WarRoomModal, type WarRoomRequest } from "./WarRoomModal";

type Filter = "today" | "open" | "closed" | "all";

interface Row {
  id: string;
  room: WarRoom;
  title: string;
  status: WarRoom["status"];
  openedBy: string;
  openedAt: number;
  closedAt: number;
  durationMs: number;
}

/** The meeting link: clickable while the room is open; plain, non-clickable text once closed. */
const RoomLink = ({ room }: { room: WarRoom }) =>
  room.status === "open" ? (
    <Tooltip text={room.url}>
      <ExternalLink href={room.url} style={{ display: "block", minWidth: 0, maxWidth: "100%" }}>
        <TextEllipsis>{`Join · ${room.url}`}</TextEllipsis>
      </ExternalLink>
    </Tooltip>
  ) : (
    <Tooltip text="This room is closed: the link is shown for reference only">
      <Text style={{ display: "block", minWidth: 0, maxWidth: "100%", color: Colors.Text.Neutral.Disabled, userSelect: "text" }} aria-disabled>
        <TextEllipsis>{room.url}</TextEllipsis>
      </Text>
    </Tooltip>
  );

export const WarRoomsPage = () => {
  const { data, isLoading, error, refresh, mutate, userName, currentUser, now } = useAppData();
  const tz = data?.settings.ui.timeZone;
  const [filter, setFilter] = useState<Filter>("today");
  const [modal, setModal] = useState<WarRoomRequest>();
  const [closing, setClosing] = useState<WarRoom>();

  const rooms = data?.warRooms ?? [];
  const incidentsById = useMemo(() => new Map((data?.incidents ?? []).map((i) => [i.id, i])), [data]);

  const rows = useMemo<Row[]>(
    () =>
      rooms
        .filter((r) =>
          filter === "today" ? isTodaysRoom(r, now) : filter === "open" ? r.status === "open" : filter === "closed" ? r.status === "closed" : true,
        )
        .map((r) => ({
          id: r.id,
          room: r,
          title: r.title,
          status: r.status,
          openedBy: userName(r.openedBy),
          openedAt: r.openedAt,
          closedAt: r.closedAt ?? 0,
          durationMs: warRoomDuration(r, now),
        })),
    [rooms, filter, now, userName],
  );

  const columns = useMemo<DataTableColumnDef<Row>[]>(
    () => [
      {
        id: "status",
        header: "Status",
        accessor: "status",
        width: 150,
        cell: ({ rowData }) => (
          <Cell>
            {rowData.status === "open" ? (
              <Health status="critical">Open · {formatDuration(rowData.durationMs)}</Health>
            ) : (
              <Health status="neutral">Closed</Health>
            )}
          </Cell>
        ),
      },
      {
        id: "title",
        header: "War room",
        accessor: "title",
        width: "1fr",
        minWidth: 280,
        cell: ({ rowData }) => (
          <Cell>
            <Flex flexDirection="column" gap={2} style={{ minWidth: 0, width: "100%" }}>
              <Text textStyle="base-emphasized" style={{ display: "block", minWidth: 0 }}>
                <TextEllipsis>{rowData.title}</TextEllipsis>
              </Text>
              <RoomLink room={rowData.room} />
            </Flex>
          </Cell>
        ),
      },
      {
        id: "incidents",
        header: "Incidents",
        accessor: (r) => r.room.incidentIds.length,
        sortType: "number",
        width: 190,
        cell: ({ rowData }) => (
          <Cell>
            <Flex gap={4} flexWrap="wrap">
              {rowData.room.incidentIds.map((id) => {
                const inc = incidentsById.get(id);
                return (
                  <Tooltip key={id} text={inc ? inc.alert.title : "Incident no longer listed (archived)"}>
                    <Link as={RouterLink} to={`/incidents/${id}`}>
                      <Chip size="condensed">{inc?.alert.displayId ?? id}</Chip>
                    </Link>
                  </Tooltip>
                );
              })}
            </Flex>
          </Cell>
        ),
      },
      {
        id: "notebooks",
        header: "Notebooks",
        accessor: (r) => r.room.notebooks.length,
        sortType: "number",
        width: 150,
        cell: ({ rowData }) => (
          <Cell>
            {rowData.room.notebooks.length === 0 ? (
              <Text style={{ color: Colors.Text.Neutral.Subdued }}>None</Text>
            ) : (
              <Flex flexDirection="column" gap={2} style={{ minWidth: 0, width: "100%" }}>
                {rowData.room.notebooks.map((n, i) => (
                  <ExternalLink key={i} href={n.url} style={{ display: "block", minWidth: 0 }}>
                    <TextEllipsis>{n.title}</TextEllipsis>
                  </ExternalLink>
                ))}
              </Flex>
            )}
          </Cell>
        ),
      },
      { id: "openedBy", header: "Opened by", accessor: "openedBy", width: 160, cell: ({ rowData }) => <CellPerson name={rowData.openedBy} /> },
      {
        id: "openedAt",
        header: "Started",
        accessor: "openedAt",
        sortType: "number",
        width: 120,
        cell: ({ rowData }) => (
          <Cell>
            <Tooltip text={formatDateTime(rowData.openedAt, tz)}>
              <Text>{formatDayTime(rowData.openedAt, tz)}</Text>
            </Tooltip>
          </Cell>
        ),
      },
      {
        id: "closedAt",
        header: "Ended",
        accessor: "closedAt",
        sortType: "number",
        width: 120,
        cell: ({ rowData }) => (
          <Cell>
            {rowData.closedAt ? <Text>{formatDayTime(rowData.closedAt, tz)}</Text> : <Text style={{ color: Colors.Text.Neutral.Subdued }}>–</Text>}
          </Cell>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        accessor: "durationMs",
        sortType: "number",
        width: 100,
        cell: ({ rowData }) => (
          <Cell>
            <Text>{formatDuration(rowData.durationMs)}</Text>
          </Cell>
        ),
      },
    ],
    [incidentsById, tz],
  );

  const openCount = rooms.filter((r) => r.status === "open").length;

  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          title="War rooms"
          subtitle={`Meeting rooms opened from incidents, with the incidents they handle and their notebooks · ${openCount} in progress`}
          action={
            <Button color="primary" variant="accent" onClick={() => setModal({ mode: "create" })}>
              <Button.Prefix>
                <PlusIcon />
              </Button.Prefix>
              Open war room
            </Button>
          }
        />
        <Flex flexDirection="column" gap={4}>
          <Text textStyle="small-emphasized">Show</Text>
          <ToggleButtonGroup value={filter} onChange={(v: string) => setFilter(v as Filter)}>
            <ToggleButtonGroup.Item value="today">Today</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="open">In progress</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="closed">Closed</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
        </Flex>
        <QueryState
          isLoading={isLoading}
          error={error}
          errorTitle="Couldn't load war rooms"
          onRetry={() => void refresh()}
          isEmpty={!!data && rows.length === 0}
          empty={
            <SimpleEmpty
              title={filter === "today" ? "No war rooms today" : "No war rooms"}
              details="Open a war room from an incident (Incident details → Open war room) or with the button above."
            />
          }
        >
          <DataTable data={rows} columns={withCreatedMarker(columns, "war-room", (r) => r.id)} rowId={(r) => r.id} fullWidth sortable variant={LIST_TABLE_VARIANT}>
            <DataTable.RowActions>
              {(row) => {
                const r = (row as Row).room;
                return (
                  <Flex gap={4}>
                    <Button size="condensed" onClick={() => setModal({ mode: "edit", room: r })}>
                      Edit
                    </Button>
                    {r.status === "open" ? (
                      <Button size="condensed" onClick={() => setClosing(r)}>
                        Close
                      </Button>
                    ) : (
                      <Button
                        size="condensed"
                        onClick={() => void mutate((s) => s.saveWarRoom(reopenWarRoom(r)), "War room reopened").catch(() => undefined)}
                      >
                        Reopen
                      </Button>
                    )}
                  </Flex>
                );
              }}
            </DataTable.RowActions>
          </DataTable>
        </QueryState>
      </Flex>
      {modal && <WarRoomModal request={modal} onClose={() => setModal(undefined)} />}
      {closing && (
        <ConfirmModal
          show
          title={`Close "${closing.title}"?`}
          confirmLabel="Close war room"
          destructive={false}
          onConfirm={() =>
            mutate((s) => s.saveWarRoom(closeWarRoom(closing, currentUser.uid, Date.now())), "War room closed").then(() => setClosing(undefined))
          }
          onDismiss={() => setClosing(undefined)}
        >
          The meeting link stays visible for reference but can no longer be used to join from here.
        </ConfirmModal>
      )}
    </PageLayout.Content>
  );
};
