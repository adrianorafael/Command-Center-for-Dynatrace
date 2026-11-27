/** On-call (route `/on-call`): who is on call now, the shifts of one week (`?week=`), schedules and overrides. */
import { markCreated } from "../../components/NewItemHighlight";
import React, { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface, Container } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Heading, Link, Text } from "@dynatrace/strato-components/typography";
import { Avatar, Chip } from "@dynatrace/strato-components/content";
import { DateTimePicker, Select, Switch, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, GanttChartIcon, PlusIcon, XmarkIcon, MobileIcon, CallIcon, ChatIcon, HttpIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Channel, Schedule, ScheduleOverride } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { newId, onCallAt, onCallNowAndNext } from "../../hooks/domain";
import { CellEmpty, CellPerson, CellText, LIST_TABLE_VARIANT, CellLink, withCreatedMarker } from "../../components/tableKit";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { coverage } from "../../components/ShiftGantt";
import { WeekShiftGantt, WeekShiftLegend } from "../../components/WeekShiftGantt";
import { readPrefs, writePrefs } from "../../hooks/prefs";
import {
  addWeeks,
  civilDate,
  formatCivilDate,
  formatDaysRange,
  pickedCivilDate,
  resolveWeekParam,
  safeTimeZone,
  weekDays,
  weekStartAt,
  weekStartOfDate,
  type CivilDate,
} from "../../hooks/domain";
import { ConfirmModal } from "../../components/ConfirmModal";
import { IconButton } from "../../components/IconButton";
import { browserTimeZone, formatDateTime, formatDayTime, formatRelative, initials, zoneAbbr } from "../../components/format";
import { OverrideModal } from "./OverrideModal";

const DAY = 86_400_000;
const TABS = ["now", "schedules", "overrides"] as const;

const CONTACT_ICONS: { channels: Channel[]; icon: React.ReactElement; label: string }[] = [
  { channels: ["sms"], icon: <MobileIcon />, label: "SMS" },
  { channels: ["voice"], icon: <CallIcon />, label: "Voice" },
  { channels: ["slack", "teams", "telegram", "whatsapp"], icon: <ChatIcon />, label: "Chat" },
  { channels: ["webhook", "ifttt"], icon: <HttpIcon />, label: "Webhook" },
];

/** One icon per channel group (SMS, voice, chat, webhook); dimmed where the person has no contact method for it. */
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
    <Surface padding={16} style={{ height: "100%", boxSizing: "border-box" }}>
      <Flex flexDirection="column" gap={12} style={{ height: "100%" }}>
        {/* Title on its own line and chips on the next, so every card starts its content at the same height. */}
        <Heading level={4}>{team?.name ?? schedule.name}</Heading>
        <Flex alignItems="center" gap={8} flexWrap="wrap" style={{ marginTop: -4 }}>
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
        <Flex style={{ marginTop: "auto" }}>
          <Link as={RouterLink} to={`/on-call/schedules/${schedule.id}`}>
            View schedule
          </Link>
        </Flex>
      </Flex>
    </Surface>
  );
};

/** Value type of the Strato date picker (a "YYYY-MM-DD" string or TimeValue for `type="date"`). */
type PickerValue = React.ComponentProps<typeof DateTimePicker>["value"];

/** Week toolbar + week view of the shifts: the week lives in `?week=`, "workdays only" in browser prefs. */
const ShiftsByWeek = ({ schedules }: { schedules: Schedule[] }) => {
  const { data, now } = useAppData();
  const [params, setParams] = useSearchParams();
  const tz = safeTimeZone(data?.settings.ui.timeZone ?? browserTimeZone());
  const week = resolveWeekParam(params.get("week"), now, tz);
  const weekKey = formatCivilDate(week);
  const thisWeekKey = formatCivilDate(weekStartAt(now, tz));
  const todayKey = formatCivilDate(civilDate(now, tz));
  const [workdaysOnly, setWorkdaysOnly] = useState(() => readPrefs().shiftsWorkdaysOnly);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  // The picker shows the date that was picked; when the week changes some other way (buttons,
  // link) it falls back to the week's Sunday.
  const [picked, setPicked] = useState<PickerValue>(() => weekKey);
  useEffect(() => {
    const d = pickedCivilDate(picked, browserTimeZone());
    if (!d || formatCivilDate(weekStartOfDate(d)) !== weekKey) setPicked(weekKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);
  // weekKey (a string) instead of `week` (a new object every render) keeps the memo stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => weekDays(week, tz, workdaysOnly), [weekKey, tz, workdaysOnly]);

  /** Shows the week containing `d`; the current week clears the parameter so the link stays "this week". */
  const goTo = (d: CivilDate) => {
    const key = formatCivilDate(weekStartOfDate(d));
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (key === thisWeekKey) next.delete("week");
        else next.set("week", key);
        return next;
      },
      { replace: true },
    );
  };
  const toggleWorkdays = (v: boolean) => {
    setWorkdaysOnly(v);
    // Re-read before writing so preferences changed elsewhere in this session are kept.
    writePrefs({ ...readPrefs(), shiftsWorkdaysOnly: v });
  };
  const allOpen = schedules.length > 0 && schedules.every((s) => openRows[s.id]);

  return (
    <Flex flexDirection="column" gap={12}>
      <Flex alignItems="center" gap={8} flexWrap="wrap">
        <GanttChartIcon />
        <Heading level={3}>Shifts</Heading>
        <Text style={{ color: Colors.Text.Neutral.Subdued }}>
          {formatDaysRange(days)} · {tz}
        </Text>
      </Flex>
      <Flex gap={12} alignItems="center" flexWrap="wrap">
        <Flex gap={4} alignItems="center">
          <IconButton label="Previous week" icon={<ChevronLeftIcon />} onClick={() => goTo(addWeeks(week, -1))} />
          <Button onClick={() => goTo(weekStartAt(now, tz))} disabled={weekKey === thisWeekKey}>
            This week
          </Button>
          <IconButton label="Next week" icon={<ChevronRightIcon />} onClick={() => goTo(addWeeks(week, 1))} />
        </Flex>
        <Flex gap={6} alignItems="center">
          <Text textStyle="small-emphasized">Week of</Text>
          <DateTimePicker
            type="date"
            aria-label="Go to the week of a date"
            value={picked}
            onChange={(v) => {
              // The picker reports every edited segment, including half-typed years ("0002-01-14"):
              // keep its value as typed, and move the week only once the date is plausible.
              // Clearing the field (it emits "") puts the week's Sunday back.
              setPicked(v ? v : weekKey);
              const d = pickedCivilDate(v, browserTimeZone());
              if (d) goTo(d);
            }}
          />
        </Flex>
        <Switch value={workdaysOnly} onChange={toggleWorkdays}>
          Workdays only
        </Switch>
        <Flex style={{ marginLeft: "auto" }}>
          <Button
            variant="emphasized"
            disabled={schedules.length === 0}
            onClick={() => setOpenRows(allOpen ? {} : Object.fromEntries(schedules.map((s) => [s.id, true])))}
          >
            {allOpen ? "Hide people" : "Show people"}
          </Button>
        </Flex>
      </Flex>
      <WeekShiftGantt
        schedules={schedules}
        days={days}
        today={todayKey}
        now={now}
        timeZone={tz}
        openRows={openRows}
        onOpenRowsChange={setOpenRows}
      />
      <WeekShiftLegend />
    </Flex>
  );
};

const NowTab = ({ onAddOverride }: { onAddOverride: (s: Schedule) => void }) => {
  const { data, currentUser } = useAppData();
  const myTeams = useMemo(
    () => (data?.teams ?? []).filter((t) => t.members.some((m) => m.uid === currentUser.uid)).map((t) => t.id),
    [data, currentUser.uid],
  );
  const [teams, setTeams] = useState<string[] | null>(null);
  const chosen = teams ?? [];
  const schedules = useMemo(
    () => (data?.schedules ?? []).filter((s) => chosen.length === 0 || chosen.includes(s.teamId ?? "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.schedules, chosen.join(",")],
  );
  if (data && data.schedules.length === 0)
    return (
      <NoSchedules />
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
      </Flex>
      <Grid gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={12}>
        {schedules.map((s) => (
          <OnCallCard key={s.id} schedule={s} onAddOverride={onAddOverride} />
        ))}
      </Grid>
      <ShiftsByWeek schedules={schedules} />
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
      cell: ({ rowData }) => <CellLink to={`/on-call/schedules/${rowData.id}`}>{rowData.name}</CellLink>,
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
          <CellPerson name={userName(rowData.onCall[0])} />
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
      cell: ({ rowData }) => <CellText>{rowData.nextHandoff ? formatRelative(rowData.nextHandoff, now) : "–"}</CellText>,
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
        formatter: (v: number) => `${v}%`,
        thresholds: [
          { value: 0, color: Colors.Charts.Threshold.Bad.Default },
          { value: 99.9, color: Colors.Charts.Threshold.Good.Default },
        ],
      },
    },
  ];
  if (data && rows.length === 0)
    return (
      <NoSchedules />
    );
  return (
    <>
      <DataTable data={rows} columns={withCreatedMarker(columns, "schedule", (r) => r.id)} rowId={(r) => r.id} fullWidth sortable variant={LIST_TABLE_VARIANT}>
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
                      (s) => {
                        const id = newId(r.schedule.name);
                        markCreated("schedule", id);
                        return s.saveSchedule({ ...r.schedule, id, name: `${r.schedule.name} (copy)`, rev: 0, overrides: [] });
                      },
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
      cell: ({ rowData }) => <CellPerson name={userName(rowData.uid)} />,
    },
    { id: "for", header: "For", accessor: (r) => (r.coversFor ? userName(r.coversFor) : "Gap"), width: 170 },
    { id: "schedule", header: "Schedule", accessor: "scheduleName", width: 180 },
    { id: "from", header: "From", accessor: "from", width: 210, sortType: "number", cell: ({ rowData }) => <CellText>{formatDateTime(rowData.from, rowData.timeZone)}</CellText> },
    { id: "to", header: "To", accessor: "to", width: 210, sortType: "number", cell: ({ rowData }) => <CellText>{formatDateTime(rowData.to, rowData.timeZone)}</CellText> },
    { id: "note", header: "Reason", accessor: (r) => r.note ?? "", width: "1fr", cell: ({ rowData }) => (rowData.note ? <CellText>{rowData.note}</CellText> : <CellEmpty />) },
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
      <DataTable data={rows} columns={withCreatedMarker(columns, "override", (r) => r.id)} rowId={(r) => `${r.scheduleId}.${r.id}`} fullWidth sortable variant={LIST_TABLE_VARIANT}>
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

/** Empty state shared by the Now and Schedules tabs: a schedule needs a team with people first. */
const NoSchedules = () => {
  const { data } = useAppData();
  const navigate = useNavigate();
  return data && data.teams.length === 0 ? (
    <SimpleEmpty
      title="Start with a team"
      details="A schedule rotates the people of a team. Create the team and add its people first."
      actions={
        <Button variant="accent" color="primary" onClick={() => navigate("/teams?new=1")}>
          New team
        </Button>
      }
    />
  ) : (
    <SimpleEmpty
      title="No on-call schedules yet"
      details="A schedule decides who is on call at any moment. Escalation policies page that person."
      actions={
        <Button variant="accent" color="primary" onClick={() => navigate("/on-call/schedules/new")}>
          New schedule
        </Button>
      }
    />
  );
};

export const OnCallPage = () => {
  const { isLoading, error, refresh, data } = useAppData();
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
            data && data.teams.length === 0 ? undefined : tab === 1 || (data && data.schedules.length === 0) ? (
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
          <Tabs
            selectedIndex={tab}
            onChange={(i) =>
              // Functional update: keep ?week= (and anything else) when switching tabs.
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("tab", TABS[i]);
                  return next;
                },
                { replace: true },
              )
            }
          >
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
