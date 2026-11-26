import React, { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface, Container } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Heading, Link, Text } from "@dynatrace/strato-components/typography";
import { Avatar, AvatarGroup, Chip } from "@dynatrace/strato-components/content";
import { Select, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { CalendarIcon, GanttChartIcon, PlusIcon, XmarkIcon, MobileIcon, CallIcon, ChatIcon, HttpIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Channel, Schedule, ScheduleOverride } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { newId, onCallAt, onCallNowAndNext } from "../../hooks/domain";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { ShiftGantt, coverage } from "../../components/ShiftGantt";
import { ConfirmModal } from "../../components/ConfirmModal";
import { IconButton } from "../../components/IconButton";
import { formatDateTime, formatDayTime, formatRelative, initials, zoneAbbr } from "../../components/format";
import { OverrideModal } from "./OverrideModal";

const DAY = 86_400_000;
const TABS = ["now", "schedules", "overrides"] as const;

const CONTACT_ICONS: { channels: Channel[]; icon: React.ReactElement; label: string }[] = [
  { channels: ["sms"], icon: <MobileIcon />, label: "SMS" },
  { channels: ["voice"], icon: <CallIcon />, label: "Voice" },
  { channels: ["slack", "teams", "telegram", "whatsapp"], icon: <ChatIcon />, label: "Chat" },
  { channels: ["webhook", "ifttt"], icon: <HttpIcon />, label: "Webhook" },
];

export const ContactIcons = ({ uid }: { uid: string }) => {
  const { data } = useAppData();
  const methods = data?.contacts.find((c) => c.uid === uid)?.methods ?? [];
  return (
    <Flex gap={4} alignItems="center">
      {CONTACT_ICONS.map((ci) => {
        const has = methods.some((m) => ci.channels.includes(m.channel));
        return (
          <Tooltip key={ci.label} text={has ? ci.label : `${ci.label}: not configured`}>
            <span style={{ display: "inline-flex", color: has ? Colors.Icon.Neutral.Default : Colors.Icon.Neutral.Disabled }} aria-label={has ? ci.label : `${ci.label} not configured`}>
              {ci.icon}
            </span>
          </Tooltip>
        );
      })}
    </Flex>
  );
};

/** One card per schedule: who is on call now, until when, and gaps (DESIGN §6.1). */
export const OnCallCard = ({ schedule, onAddOverride }: { schedule: Schedule; onAddOverride: (s: Schedule) => void }) => {
  const { data, now, userName } = useAppData();
  const team = data?.teams.find((t) => t.id === schedule.teamId);
  const tz = schedule.timeZone;
  const { current, next } = onCallNowAndNext(schedule, now);
  const oc = onCallAt(schedule, now);
  const override = oc?.source === "override" ? schedule.overrides.find((o) => o.id === oc.overrideId) : undefined;
  const layerNow = schedule.layers.map((l) => {
    const o = onCallAt({ ...schedule, layers: [l], overrides: [] }, now);
    return { layer: l, oc: o };
  });
  return (
    <Surface padding={16}>
      <Flex flexDirection="column" gap={12}>
        <Flex alignItems="center" gap={8} flexWrap="wrap">
          <Heading level={3}>{team?.name ?? schedule.name}</Heading>
          <Chip size="condensed">
            <Chip.Prefix>
              <CalendarIcon />
            </Chip.Prefix>
            {schedule.name}
          </Chip>
          {override && (
            <Tooltip text={`Covers until ${formatDayTime(override.to, tz)} ${zoneAbbr(override.to, tz)}`}>
              <Chip color="primary" size="condensed">
                Override
              </Chip>
            </Tooltip>
          )}
        </Flex>
        {oc ? (
          <Flex alignItems="center" justifyContent="space-between" gap={8}>
            <Avatar abbreviation={initials(userName(oc.uid))}>
              <Avatar.Label>{userName(oc.uid)}</Avatar.Label>
              <Avatar.Subtitle>
                On call now · until {formatDayTime(current?.to ?? oc.to, tz)} {zoneAbbr(oc.to, tz)}
              </Avatar.Subtitle>
            </Avatar>
            <ContactIcons uid={oc.uid} />
          </Flex>
        ) : (
          <Container color="warning" padding={12}>
            <Flex flexDirection="column" gap={8}>
              <Text>
                No one is on call{next ? ` until ${formatDayTime(next.from, tz)} ${zoneAbbr(next.from, tz)}` : ""}.
              </Text>
              <Flex>
                <Button onClick={() => onAddOverride(schedule)}>Add override</Button>
              </Flex>
            </Flex>
          </Container>
        )}
        {schedule.layers.length > 1 && (
          <Flex flexDirection="column" gap={4}>
            {layerNow.map(({ layer, oc: l }) => (
              <Text key={layer.id} textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                {layer.name}: {l ? userName(l.uid) : "no one"}
              </Text>
            ))}
          </Flex>
        )}
        {next && (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
            Next: {userName(next.uid)} from {formatDayTime(next.from, tz)} {zoneAbbr(next.from, tz)}
          </Text>
        )}
        <Link as={RouterLink} to={`/on-call/schedules/${schedule.id}`}>
          View schedule
        </Link>
      </Flex>
    </Surface>
  );
};

const NowTab = ({ onAddOverride }: { onAddOverride: (s: Schedule) => void }) => {
  const { data, now, currentUser } = useAppData();
  const navigate = useNavigate();
  const myTeams = useMemo(
    () => (data?.teams ?? []).filter((t) => t.members.some((m) => m.uid === currentUser.uid)).map((t) => t.id),
    [data, currentUser.uid],
  );
  const [teams, setTeams] = useState<string[] | null>(null);
  const [range, setRange] = useState("7");
  const chosen = teams ?? [];
  const schedules = (data?.schedules ?? []).filter((s) => chosen.length === 0 || chosen.includes(s.teamId ?? ""));
  const days = Number(range);
  const from = now - 2 * 3_600_000;
  if (data && data.schedules.length === 0)
    return (
      <SimpleEmpty
        title="No on-call schedules yet"
        details="Create a schedule to define who gets notified and when."
        actions={
          <Button variant="accent" color="primary" onClick={() => navigate("/on-call/schedules/new")}>
            New schedule
          </Button>
        }
      />
    );
  return (
    <Flex flexDirection="column" gap={16}>
      <Flex gap={16} alignItems="flex-end" flexWrap="wrap">
        <Flex flexDirection="column" gap={4}>
          <Text textStyle="small-emphasized">Team</Text>
          <Select multiple clearable value={chosen} onChange={(v) => setTeams(v ?? [])} aria-label="Team">
            <Select.Content>
              {(data?.teams ?? []).map((t) => (
                <Select.Option key={t.id} value={t.id}>
                  {t.name}
                  {myTeams.includes(t.id) ? " (my team)" : ""}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Flex>
        <Flex flexDirection="column" gap={4}>
          <Text textStyle="small-emphasized">Range</Text>
          <ToggleButtonGroup value={range} onChange={(v: string) => setRange(v)}>
            <ToggleButtonGroup.Item value="1">24 h</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="7">7 days</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="14">14 days</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
        </Flex>
      </Flex>
      <Grid gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={12}>
        {schedules.map((s) => (
          <OnCallCard key={s.id} schedule={s} onAddOverride={onAddOverride} />
        ))}
      </Grid>
      <Flex alignItems="center" gap={8}>
        <GanttChartIcon />
        <Heading level={3}>Upcoming shifts</Heading>
      </Flex>
      <ShiftGantt schedules={schedules} from={from} to={from + days * DAY} now={now} />
    </Flex>
  );
};

interface ScheduleRow {
  id: string;
  name: string;
  team: string;
  timeZone: string;
  layers: number;
  onCall: string[];
  nextHandoff?: number;
  coverage: number;
  schedule: Schedule;
}

const SchedulesTab = () => {
  const { data, now, userName, mutate } = useAppData();
  const navigate = useNavigate();
  const [toDelete, setToDelete] = useState<Schedule>();
  const rows = useMemo<ScheduleRow[]>(
    () =>
      (data?.schedules ?? []).map((s) => {
        const oc = onCallAt(s, now);
        const nn = onCallNowAndNext(s, now);
        return {
          id: s.id,
          name: s.name,
          team: data?.teams.find((t) => t.id === s.teamId)?.name ?? "–",
          timeZone: s.timeZone,
          layers: s.layers.length,
          onCall: oc ? [oc.uid] : [],
          nextHandoff: nn.current?.to ?? nn.next?.from,
          coverage: coverage(s, now, now + 7 * DAY).pct,
          schedule: s,
        };
      }),
    [data, now],
  );
  const columns: DataTableColumnDef<ScheduleRow>[] = [
    {
      id: "name",
      header: "Name",
      accessor: "name",
      width: "1fr",
      cell: ({ rowData }) => (
        <Link as={RouterLink} to={`/on-call/schedules/${rowData.id}`}>
          {rowData.name}
        </Link>
      ),
    },
    { id: "team", header: "Team", accessor: "team", width: 150 },
    { id: "tz", header: "Time zone", accessor: "timeZone", width: 170 },
    { id: "layers", header: "Layers", accessor: "layers", width: 80, sortType: "number" },
    {
      id: "oncall",
      header: "On call now",
      accessor: (r) => r.onCall.map(userName).join(", "),
      width: 170,
      cell: ({ rowData }) =>
        rowData.onCall.length ? (
          <AvatarGroup>
            {rowData.onCall.map((u) => (
              <AvatarGroup.Item key={u} abbreviation={initials(userName(u))} tooltipText={userName(u)} />
            ))}
          </AvatarGroup>
        ) : (
          <Text style={{ color: Colors.Text.Critical.Default }}>No one</Text>
        ),
    },
    {
      id: "next",
      header: "Next handoff",
      accessor: (r) => r.nextHandoff ?? 0,
      sortType: "number",
      width: 130,
      cell: ({ rowData }) => <Text>{rowData.nextHandoff ? formatRelative(rowData.nextHandoff, now) : "–"}</Text>,
    },
    {
      id: "coverage",
      header: "Coverage next 7 days",
      accessor: "coverage",
      width: 200,
      columnType: "meterbar",
      config: {
        min: 0,
        max: 100,
        showValue: "right",
        thresholds: [
          { value: 0, color: Colors.Charts.Threshold.Bad.Default },
          { value: 99.9, color: Colors.Charts.Threshold.Good.Default },
        ],
      },
    },
  ];
  if (data && rows.length === 0)
    return (
      <SimpleEmpty
        title="No on-call schedules yet"
        details="Create a schedule to define who gets notified and when."
        actions={
          <Button variant="accent" color="primary" onClick={() => navigate("/on-call/schedules/new")}>
            New schedule
          </Button>
        }
      />
    );
  return (
    <>
      <DataTable data={rows} columns={columns} rowId={(r) => r.id} fullWidth sortable variant={{ rowDensity: "condensed" }}>
        <DataTable.RowActions>
          {(row) => {
            const r = row as ScheduleRow;
            return (
              <Flex gap={4}>
                <Button size="condensed" onClick={() => navigate(`/on-call/schedules/${r.id}`)}>
                  Edit
                </Button>
                <Button
                  size="condensed"
                  onClick={() =>
                    void mutate(
                      (s) => s.saveSchedule({ ...r.schedule, id: newId(r.schedule.name), name: `${r.schedule.name} (copy)`, rev: 0, overrides: [] }),
                      "Schedule duplicated",
                    ).catch(() => undefined)
                  }
                >
                  Duplicate
                </Button>
                <Button size="condensed" color="critical" onClick={() => setToDelete(r.schedule)}>
                  Delete
                </Button>
              </Flex>
            );
          }}
        </DataTable.RowActions>
      </DataTable>
      <ConfirmModal
        show={!!toDelete}
        title={`Delete ${toDelete?.name ?? "schedule"}?`}
        onDismiss={() => setToDelete(undefined)}
        onConfirm={() => (toDelete ? mutate((s) => s.deleteSchedule(toDelete.id), "Schedule deleted").catch(() => undefined) : undefined)}
      >
        Escalation steps that target this schedule will no longer page anyone.
      </ConfirmModal>
    </>
  );
};

interface OverrideRow extends ScheduleOverride {
  scheduleId: string;
  scheduleName: string;
  coversFor?: string;
  timeZone: string;
}

const OverridesTab = ({ onNew }: { onNew: () => void }) => {
  const { data, now, userName, mutate } = useAppData();
  const [when, setWhen] = useState("upcoming");
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const rows = useMemo<OverrideRow[]>(() => {
    const out: OverrideRow[] = [];
    (data?.schedules ?? []).forEach((s) => {
      if (scheduleId && s.id !== scheduleId) return;
      s.overrides.forEach((o) => {
        if (when === "upcoming" ? o.to < now : o.to >= now) return;
        const under = onCallAt({ ...s, overrides: [] }, o.from);
        out.push({ ...o, scheduleId: s.id, scheduleName: s.name, coversFor: under?.uid, timeZone: s.timeZone });
      });
    });
    return out.sort((a, b) => a.from - b.from);
  }, [data, now, when, scheduleId]);
  const columns: DataTableColumnDef<OverrideRow>[] = [
    {
      id: "who",
      header: "Who covers",
      accessor: (r) => userName(r.uid),
      width: 200,
      cell: ({ rowData }) => (
        <Avatar size="small" abbreviation={initials(userName(rowData.uid))}>
          <Avatar.Label>{userName(rowData.uid)}</Avatar.Label>
        </Avatar>
      ),
    },
    { id: "for", header: "For", accessor: (r) => (r.coversFor ? userName(r.coversFor) : "Gap"), width: 170 },
    { id: "schedule", header: "Schedule", accessor: "scheduleName", width: 180 },
    { id: "from", header: "From", accessor: "from", width: 210, sortType: "number", cell: ({ rowData }) => <Text>{formatDateTime(rowData.from, rowData.timeZone)}</Text> },
    { id: "to", header: "To", accessor: "to", width: 210, sortType: "number", cell: ({ rowData }) => <Text>{formatDateTime(rowData.to, rowData.timeZone)}</Text> },
    { id: "note", header: "Reason", accessor: (r) => r.note ?? "", width: "1fr" },
  ];
  const remove = (r: OverrideRow) => {
    const s = data?.schedules.find((x) => x.id === r.scheduleId);
    if (!s) return;
    void mutate((st) => st.saveSchedule(nextRev({ ...s, overrides: s.overrides.filter((o) => o.id !== r.id) })), "Override removed").catch(
      () => undefined,
    );
  };
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex gap={16} alignItems="flex-end" flexWrap="wrap">
        <Flex flexDirection="column" gap={4}>
          <Text textStyle="small-emphasized">Schedule</Text>
          <Select value={scheduleId} onChange={(v) => setScheduleId(v)} clearable aria-label="Schedule">
            <Select.Content>
              {(data?.schedules ?? []).map((s) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.name}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Flex>
        <ToggleButtonGroup value={when} onChange={(v: string) => setWhen(v)}>
          <ToggleButtonGroup.Item value="upcoming">Upcoming</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="past">Past</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </Flex>
      <DataTable data={rows} columns={columns} rowId={(r) => `${r.scheduleId}.${r.id}`} fullWidth sortable variant={{ rowDensity: "condensed" }}>
        <DataTable.RowActions>
          {(row) => <IconButton size="condensed" label="Remove override" icon={<XmarkIcon />} onClick={() => remove(row as OverrideRow)} />}
        </DataTable.RowActions>
        <DataTable.EmptyState>
          <SimpleEmpty
            size="small"
            title={when === "upcoming" ? "No upcoming overrides" : "No past overrides"}
            details="Overrides let someone cover a shift, for example during vacation."
            actions={<Button onClick={onNew}>New override</Button>}
          />
        </DataTable.EmptyState>
      </DataTable>
    </Flex>
  );
};

export const OnCallPage = () => {
  const { isLoading, error, refresh } = useAppData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = Math.max(0, TABS.indexOf((params.get("tab") ?? "now") as (typeof TABS)[number]));
  const [override, setOverride] = useState<{ scheduleId?: string } | undefined>();
  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          title="On-call"
          subtitle="Who's responsible right now and who's next"
          action={
            tab === 1 ? (
              <Button color="primary" variant="accent" onClick={() => navigate("/on-call/schedules/new")}>
                <Button.Prefix>
                  <PlusIcon />
                </Button.Prefix>
                New schedule
              </Button>
            ) : (
              <Button color="primary" variant="accent" onClick={() => setOverride({})}>
                <Button.Prefix>
                  <PlusIcon />
                </Button.Prefix>
                New override
              </Button>
            )
          }
        />
        <QueryState isLoading={isLoading} error={error} errorTitle="Couldn't load schedules" onRetry={() => void refresh()}>
          <Tabs selectedIndex={tab} onChange={(i) => setParams({ tab: TABS[i] }, { replace: true })}>
            <Tab title="Now">
              <Flex paddingTop={16} flexDirection="column">
                <NowTab onAddOverride={(s) => setOverride({ scheduleId: s.id })} />
              </Flex>
            </Tab>
            <Tab title="Schedules">
              <Flex paddingTop={16} flexDirection="column">
                <SchedulesTab />
              </Flex>
            </Tab>
            <Tab title="Overrides">
              <Flex paddingTop={16} flexDirection="column">
                <OverridesTab onNew={() => setOverride({})} />
              </Flex>
            </Tab>
          </Tabs>
        </QueryState>
      </Flex>
      <OverrideModal request={override} onClose={() => setOverride(undefined)} />
    </PageLayout.Content>
  );
};
