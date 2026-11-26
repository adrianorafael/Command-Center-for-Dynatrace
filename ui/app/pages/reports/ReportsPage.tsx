import React, { useMemo, useState } from "react";
import { Flex, Grid, PageLayout, Surface } from "@dynatrace/strato-components/layouts";
import {
  CategoricalBarChart,
  DonutChart,
  GaugeChart,
  HistogramChart,
  SingleValueGrid,
  TimeseriesChart,
  TopList,
  type HistogramSeries,
  type Timeseries,
} from "@dynatrace/strato-components/charts";
import { TimeframeSelector } from "@dynatrace/strato-components/filters";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import type { Timeframe } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { PRIORITIES, type DailyRollup, type Priority } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { onCallHoursByUser, rollupsFromIncidents, summarizeRollups } from "../../hooks/domain";
import { PageTitle } from "../../components/PageTitle";
import { ErrorMessage, SimpleEmpty } from "../../components/QueryState";
import { PRIORITY_COLOR } from "../../components/PriorityChip";
import { SOURCE_LABEL } from "../console/filters";
import { formatDuration, pickerToMs } from "../../components/format";

const DAY = 86_400_000;

const Panel = ({
  title,
  question,
  span,
  children,
}: {
  title: string;
  question: string;
  span: number;
  children: React.ReactNode;
}) => (
  <Surface padding={16} style={{ gridColumn: `span ${span}`, minWidth: 0 }}>
    <Flex flexDirection="column" gap={8}>
      <Heading level={3}>{title}</Heading>
      <Text textStyle="small">{question}</Text>
      {children}
    </Flex>
  </Surface>
);

const Empty = () => <SimpleEmpty size="small" title="No incidents in this timeframe" />;

function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** R7: assert numeric values before handing data to a chart (loud instead of blank). */
function assertNumeric<T extends Record<string, unknown>>(rows: T[], key: keyof T): T[] {
  const bad = rows.find((r) => typeof r[key] !== "number" || !Number.isFinite(r[key] as number));
  if (bad) throw new Error(`Chart value "${String(key)}" is not numeric: ${JSON.stringify(bad)}`);
  return rows;
}

interface LoadRow {
  uid: string;
  name: string;
  team: string;
  hours: number;
  pages: number;
  offHours: number;
  night: number;
  acks: number;
  avgAckMs?: number;
}

export const ReportsPage = () => {
  const { data, isLoading, error, refresh, now, userName } = useAppData();
  const [tf, setTf] = useState<Timeframe | null>({
    from: { value: "now()-30d", absoluteDate: new Date(now - 30 * DAY).toISOString(), type: "expression" },
    to: { value: "now()", absoluteDate: new Date(now).toISOString(), type: "expression" },
  });
  const from = (tf && pickerToMs(tf.from)) ?? now - 30 * DAY;
  const to = (tf && pickerToMs(tf.to)) ?? now;
  const fromDay = new Date(from).toISOString().slice(0, 10);
  const toDay = new Date(to).toISOString().slice(0, 10);

  const model = useMemo(() => {
    if (!data) return undefined;
    try {
      // Stored daily rollups first; fall back to incidents when no rollup exists yet (fresh tenant).
      const rollups: DailyRollup[] = data.rollups.length ? data.rollups : rollupsFromIncidents(data.incidents, from, to);
      const s = summarizeRollups(rollups, fromDay, toDay);
      const days = rollups.filter((r) => r.day >= fromDay && r.day <= toDay).sort((a, b) => a.day.localeCompare(b.day));
      // Minutes read better than "10M millisecond" on the axis.
      const mtta: Timeseries = {
        name: "MTTA (min)",
        datapoints: s.daily.filter((d) => d.mttaMs !== undefined).map((d) => ({ start: dayStart(d.day), end: new Date(dayStart(d.day).getTime() + DAY), value: Math.round((d.mttaMs ?? 0) / 600) / 100 })),
      };
      const mttr: Timeseries = {
        name: "MTTR (min)",
        datapoints: s.daily.filter((d) => d.mttrMs !== undefined).map((d) => ({ start: dayStart(d.day), end: new Date(dayStart(d.day).getTime() + DAY), value: Math.round((d.mttrMs ?? 0) / 600) / 100 })),
      };
      // Every day of the range, zero-filled, so bars line up with the calendar.
      const allDays: string[] = [];
      for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += DAY) allDays.push(new Date(t).toISOString().slice(0, 10));
      const byDay = new Map(days.map((r) => [r.day, r]));
      const byPrioritySeries: { p: Priority; ts: Timeseries }[] = PRIORITIES.map((p) => ({
        p,
        ts: {
          name: p,
          datapoints: allDays.map((d) => ({ start: dayStart(d), end: new Date(dayStart(d).getTime() + DAY), value: byDay.get(d)?.byPriority[p] ?? 0 })),
        },
      }));
      const teamName = (id: string) => data.teams.find((t) => t.id === id)?.name ?? (id || "No team");
      const serviceName = (id: string) => data.services.find((x) => x.id === id)?.name ?? (id || "No service");
      const teams = assertNumeric(
        Object.entries(s.byTeam)
          .map(([k, v]) => ({ category: teamName(k), value: v }))
          .sort((a, b) => b.value - a.value),
        "value",
      );
      const noisy = assertNumeric(
        [
          ...Object.entries(s.byService).map(([k, v]) => ({ label: serviceName(k), count: v })),
          ...Object.entries(s.bySource).map(([k, v]) => ({ label: `Source: ${SOURCE_LABEL[k] ?? k}`, count: v })),
        ]
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        "count",
      );
      const donut = assertNumeric(
        PRIORITIES.map((p) => ({ priority: p, count: s.byPriority[p] ?? 0 })).filter((d) => d.count > 0),
        "count",
      );
      // Time-to-acknowledge distribution (minutes), from incidents in range.
      const inRange = data.incidents.filter((i) => i.createdAt >= from && i.createdAt <= to);
      const ttaMin = inRange.filter((i) => i.acknowledgedAt).map((i) => ((i.acknowledgedAt ?? 0) - i.createdAt) / 60_000);
      const edges = [0, 1, 2, 5, 10, 15, 30, 60, 120];
      const bins = edges.map((lo, k) => {
        const hi = edges[k + 1] ?? Math.max(240, Math.ceil(Math.max(0, ...ttaMin)));
        return { from: lo, to: hi, value: ttaMin.filter((m) => m >= lo && m < hi).length };
      });
      const histogram: HistogramSeries[] = [{ name: "Incidents", bins }];
      // On-call load per person.
      const hours: Record<string, number> = {};
      data.schedules.forEach((sch) => {
        try {
          Object.entries(onCallHoursByUser(sch, from, to)).forEach(([u, h]) => (hours[u] = (hours[u] ?? 0) + h));
        } catch {
          // a broken schedule shouldn't blank the report
        }
      });
      const ntf = data.notifications.filter((n) => n.plannedAt >= from && n.plannedAt <= to);
      const uids = new Set([...Object.keys(hours), ...Object.keys(s.pagesByUser), ...ntf.map((n) => n.to.uid)]);
      const load: LoadRow[] = [...uids].map((uid) => {
        const mine = ntf.filter((n) => n.to.uid === uid);
        const hourOf = (t: number) => new Date(t).getHours();
        const dayOf = (t: number) => new Date(t).getDay();
        const acked = inRange.filter((i) => i.acknowledgedBy === uid && i.acknowledgedAt);
        return {
          uid,
          name: userName(uid),
          team: data.teams.find((t) => t.members.some((m) => m.uid === uid))?.name ?? "–",
          hours: Math.round((hours[uid] ?? 0) * 10) / 10,
          pages: s.pagesByUser[uid] ?? mine.length,
          offHours: mine.filter((n) => hourOf(n.plannedAt) < 8 || hourOf(n.plannedAt) >= 18 || dayOf(n.plannedAt) % 6 === 0).length,
          night: mine.filter((n) => hourOf(n.plannedAt) < 6).length,
          acks: acked.length,
          avgAckMs: acked.length ? acked.reduce((a, i) => a + ((i.acknowledgedAt ?? 0) - i.createdAt), 0) / acked.length : undefined,
        };
      });
      const kpis = [
        { label: "MTTA", value: s.mttaMs !== undefined ? formatDuration(s.mttaMs) : "–" },
        { label: "MTTR", value: s.mttrMs !== undefined ? formatDuration(s.mttrMs) : "–" },
        { label: "Incidents", value: s.created },
        { label: "Delivery success", value: s.deliverySuccessRate !== undefined ? `${(s.deliverySuccessRate * 100).toFixed(1)} %` : "–" },
      ];
      return { s, mtta, mttr, byPrioritySeries, teams, noisy, donut, histogram, ttaCount: ttaMin.length, load, kpis };
    } catch (e: unknown) {
      return { error: e as Error };
    }
  }, [data, from, to, fromDay, toDay, userName]);

  const loadColumns: DataTableColumnDef<LoadRow>[] = [
    { id: "name", header: "Person", accessor: "name", width: 180 },
    { id: "team", header: "Team", accessor: "team", width: 140 },
    {
      id: "hours",
      header: "On-call hours",
      accessor: "hours",
      width: 220,
      columnType: "meterbar",
      config: { min: 0, max: "data-max", showValue: "right", color: Colors.Charts.Categorical.Color01.Default },
    },
    { id: "pages", header: "Pages", accessor: "pages", width: 90, sortType: "number" },
    { id: "off", header: "Off-hours pages", accessor: "offHours", width: 130, sortType: "number" },
    { id: "night", header: "Night pages (00–06)", accessor: "night", width: 150, sortType: "number" },
    { id: "acks", header: "Acks", accessor: "acks", width: 80, sortType: "number" },
    {
      id: "avg",
      header: "Avg time to ack",
      accessor: (r) => r.avgAckMs ?? -1,
      sortType: "number",
      width: "1fr",
      cell: ({ rowData }) => <Text>{rowData.avgAckMs !== undefined ? formatDuration(rowData.avgAckMs) : "–"}</Text>,
    },
  ];

  const loading = isLoading || !model;
  const failed = model && "error" in model ? model.error : undefined;
  const m = model && !("error" in model) ? model : undefined;
  const empty = !!m && m.s.created === 0;

  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          title="Reports"
          subtitle="Response times, volume, noise, and on-call load from daily rollups"
          suffix={<TimeframeSelector value={tf} onChange={setTf} />}
        />
        {error ? <ErrorMessage title="Couldn't load report data" error={error} onRetry={() => void refresh()} /> : null}
        {failed ? <ErrorMessage title="Couldn't build the report" error={failed} /> : null}
        <Grid gridTemplateColumns="repeat(12, minmax(0, 1fr))" gap={16}>
          <Panel span={12} title="Response at a glance" question="Are we fast enough?">
            <SingleValueGrid data={m?.kpis ?? []} labelAccessor="label" loading={loading} style={{ height: 120 }}>
              <SingleValueGrid.Value dataAccessor="value" />
            </SingleValueGrid>
          </Panel>
          <Panel span={8} title="MTTA and MTTR" question="How are acknowledge and resolve times changing?">
            {empty ? (
              <Empty />
            ) : (
              <TimeseriesChart loading={loading} height={260}>
                {m && <TimeseriesChart.Line data={m.mtta} color={Colors.Charts.Categorical.Color01.Default} />}
                {m && <TimeseriesChart.Line data={m.mttr} color={Colors.Charts.Categorical.Color03.Default} />}
                <TimeseriesChart.Legend />
              </TimeseriesChart>
            )}
          </Panel>
          <Panel span={4} title="Load by priority" question="How is the load split across priorities?">
            {empty ? (
              <Empty />
            ) : (
              <DonutChart
                data={m?.donut ?? []}
                labelAccessor="priority"
                valueAccessor="count"
                loading={loading}
                height={300}
                colorPalette={PRIORITY_COLOR}
              >
                <DonutChart.Legend />
              </DonutChart>
            )}
          </Panel>
          <Panel span={12} title="Incidents per day" question="When do incidents arrive, and how urgent are they?">
            {empty ? (
              <Empty />
            ) : (
              <TimeseriesChart loading={loading} height={240}>
                {(m?.byPrioritySeries ?? []).map(({ p, ts }) => (
                  <TimeseriesChart.Bar key={p} data={ts} color={PRIORITY_COLOR[p]} />
                ))}
                <TimeseriesChart.Legend />
              </TimeseriesChart>
            )}
          </Panel>
          <Panel span={6} title="Incidents by team" question="Which teams get the most incidents?">
            {empty ? (
              <Empty />
            ) : (
              <CategoricalBarChart data={m?.teams ?? []} layout="horizontal" loading={loading} height={240} />
            )}
          </Panel>
          <Panel span={6} title="Noisiest services and sources" question="Where do incidents come from?">
            {empty ? <Empty /> : <TopList data={m?.noisy ?? []} labelAccessor="label" valueAccessor="count" loading={loading} />}
          </Panel>
          <Panel span={6} title="Time to acknowledge" question="How long until someone acknowledges? (minutes)">
            {m && m.ttaCount === 0 ? (
              <Empty />
            ) : (
              <HistogramChart data={m?.histogram ?? []} loading={loading} height={240} />
            )}
          </Panel>
          <Panel span={6} title="Notification delivery" question="Do notifications reach people?">
            {m && m.s.notificationsSent + m.s.notificationsFailed === 0 ? (
              <SimpleEmpty size="small" title="No notifications in this timeframe" />
            ) : (
              <Flex flexDirection="column" gap={8} alignItems="center">
                <GaugeChart value={(m?.s.deliverySuccessRate ?? 0) * 100} min={0} max={100} unit="percent" loading={loading} height={200}>
                  <GaugeChart.Label>Delivered</GaugeChart.Label>
                </GaugeChart>
                <Text textStyle="small">
                  {m?.s.notificationsSent ?? 0} delivered · {m?.s.notificationsFailed ?? 0} failed
                </Text>
              </Flex>
            )}
          </Panel>
          <Panel span={12} title="On-call load" question="Who carries the on-call load?">
            <DataTable data={m?.load ?? []} columns={loadColumns} rowId={(r) => r.uid} fullWidth sortable loading={loading} variant={{ rowDensity: "condensed" }}>
              <DataTable.Toolbar>
                <DataTable.DownloadData />
              </DataTable.Toolbar>
              <DataTable.EmptyState>
                <Text>No on-call shifts or pages in this timeframe.</Text>
              </DataTable.EmptyState>
            </DataTable>
          </Panel>
        </Grid>
      </Flex>
    </PageLayout.Content>
  );
};
