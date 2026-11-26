import React, { useMemo } from "react";
import { Grid, Surface, Flex } from "@dynatrace/strato-components/layouts";
import { MeterBarChart, MultiMeterBarChart, SingleValue, type Timeseries } from "@dynatrace/strato-components/charts";
import { Text } from "@dynatrace/strato-components/typography";
import { AccountIcon, CheckmarkIcon, CriticalIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { PRIORITIES, type Incident, type Priority } from "../../domain/contracts";
import { PRIORITY_COLOR } from "../../components/PriorityChip";
import { formatDuration } from "../../components/format";
import type { ConsoleFilters } from "./filters";

const HOUR = 3_600_000;

function hourlyCreated(incidents: Incident[], now: number): Timeseries {
  const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  const buckets = Array.from({ length: 24 }, (_, i) => ({ start: start + i * HOUR, value: 0 }));
  incidents.forEach((i) => {
    const idx = Math.floor((i.createdAt - start) / HOUR);
    if (idx >= 0 && idx < 24) buckets[idx].value++;
  });
  return {
    name: "Incidents created",
    datapoints: buckets.map((b) => ({ start: new Date(b.start), end: new Date(b.start + HOUR), value: b.value })),
  };
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Height of the SingleValue area under a tile header; header + gap + value ≈ the 110 px meter tiles. */
const VALUE_HEIGHT = 84;

/**
 * Tile title row (icon + label) rendered outside SingleValue: SingleValue sizes a ReactNode `prefixIcon` to 2ch
 * (≈1.15 em) inside a 1 em-high `overflow: hidden` value row, which clips the icon top and bottom, and its auto-fitted
 * label size differs from tile to tile. A fixed 16 px icon and `Text` keep every tile title identical.
 */
const TileHeader = ({ icon, children }: { icon?: React.ReactElement; children: React.ReactNode }) => (
  <Flex alignItems="center" gap={4}>
    {icon}
    <Text textStyle="base-emphasized">{children}</Text>
  </Flex>
);

const Tile = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) =>
  onClick ? (
    <Surface as="button" elevation="raised" padding={16} aria-label={label} onClick={onClick} style={{ textAlign: "start" }}>
      <Flex flexDirection="column" gap={8}>
        {children}
      </Flex>
    </Surface>
  ) : (
    <Surface elevation="raised" padding={16} aria-label={label}>
      {children}
    </Surface>
  );

export const KpiStrip = ({
  incidents,
  now,
  me,
  ackTargetMs,
  loading,
  onFilter,
}: {
  incidents: Incident[];
  now: number;
  me: string;
  ackTargetMs: number;
  loading: boolean;
  onFilter: (patch: Partial<ConsoleFilters>) => void;
}) => {
  const k = useMemo(() => {
    const open = incidents.filter((i) => i.status !== "resolved");
    const triggered = incidents.filter((i) => i.status === "triggered");
    const acknowledged = incidents.filter((i) => i.status === "acknowledged");
    const p1 = open.filter((i) => i.priority === "P1");
    const mine = open.filter((i) => i.assignee?.type === "user" && i.assignee.id === me);
    const dayStart = new Date(now).setHours(0, 0, 0, 0);
    const mtta = median(
      incidents
        .filter((i) => i.acknowledgedAt && i.acknowledgedAt >= dayStart)
        .map((i) => (i.acknowledgedAt ?? 0) - i.createdAt),
    );
    const ackLastHour = incidents.filter((i) => i.acknowledgedAt && i.acknowledgedAt >= now - HOUR).length;
    const ackPrevHour = incidents.filter(
      (i) => i.acknowledgedAt && i.acknowledgedAt >= now - 2 * HOUR && i.acknowledgedAt < now - HOUR,
    ).length;
    const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, open.filter((i) => i.priority === p).length])) as Record<
      Priority,
      number
    >;
    return { open, triggered, acknowledged, p1, mine, mtta, ackLastHour, ackPrevHour, byPriority, spark: hourlyCreated(incidents, now) };
  }, [incidents, now, me]);

  const trendDelta = k.ackLastHour - k.ackPrevHour;
  const mttaValue = k.mtta ?? 0;

  return (
    <Grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={12}>
      <Tile label="Show triggered incidents" onClick={() => onFilter({ status: ["triggered"] })}>
        <TileHeader icon={<CriticalIcon size="small" />}>Triggered</TileHeader>
        <SingleValue data={k.triggered.length} aria-label="Triggered" loading={loading} height={VALUE_HEIGHT}>
          <SingleValue.Sparkline data={k.spark} variant="area" color={Colors.Charts.Status.Critical.Default} />
        </SingleValue>
      </Tile>
      <Tile label="Show acknowledged incidents" onClick={() => onFilter({ status: ["acknowledged"] })}>
        <TileHeader icon={<CheckmarkIcon size="small" />}>Acknowledged</TileHeader>
        <SingleValue data={k.acknowledged.length} aria-label="Acknowledged" loading={loading} height={VALUE_HEIGHT}>
          <SingleValue.Trend
            direction={trendDelta > 0 ? "upward" : trendDelta < 0 ? "downward" : "neutral"}
            value={trendDelta}
            label="acks vs. previous hour"
          />
        </SingleValue>
      </Tile>
      <Tile label="Show open P1 incidents" onClick={() => onFilter({ status: ["triggered", "acknowledged", "snoozed"], priority: ["P1"] })}>
        <TileHeader icon={<CriticalIcon size="small" />}>Open P1</TileHeader>
        <SingleValue
          data={k.p1.length}
          aria-label="Open P1"
          loading={loading}
          height={VALUE_HEIGHT}
          applyThresholdBackground
        >
          <SingleValue.ColorRule comparator="greater-than" matchValue={0} color={Colors.Charts.Status.Critical.Default} />
        </SingleValue>
      </Tile>
      <Tile label="MTTA today">
        <Flex flexDirection="column" gap={8} style={{ minHeight: 110 }}>
          <MeterBarChart value={mttaValue} min={0} max={ackTargetMs * 2} unit="millisecond" loading={loading}>
            <MeterBarChart.Label>MTTA today</MeterBarChart.Label>
            <MeterBarChart.Value>{k.mtta === undefined ? "–" : formatDuration(k.mtta)}</MeterBarChart.Value>
            <MeterBarChart.ThresholdIndicator value={ackTargetMs} color={Colors.Charts.Threshold.Bad.Default} name="Target" />
            <MeterBarChart.ColorRule comparator="greater-than" matchValue={ackTargetMs} color={Colors.Charts.Threshold.Bad.Default} />
            <MeterBarChart.ColorRule comparator="less-or-equal" matchValue={ackTargetMs} color={Colors.Charts.Threshold.Good.Default} />
          </MeterBarChart>
          <Text textStyle="small">Target {formatDuration(ackTargetMs)}</Text>
        </Flex>
      </Tile>
      <Tile label="Show incidents assigned to me" onClick={() => onFilter({ assignee: ["me"] })}>
        <TileHeader icon={<AccountIcon size="small" />}>Assigned to me</TileHeader>
        <SingleValue data={k.mine.length} aria-label="Assigned to me" loading={loading} height={VALUE_HEIGHT} />
      </Tile>
      <Tile label="Open incidents by priority">
        <Flex flexDirection="column" gap={8} style={{ minHeight: 110 }}>
          <MultiMeterBarChart loading={loading} max="auto">
            <MultiMeterBarChart.Label>Open by priority</MultiMeterBarChart.Label>
            {PRIORITIES.map((p) => (
              <MultiMeterBarChart.Segment key={p} name={p} value={k.byPriority[p]} color={PRIORITY_COLOR[p]} />
            ))}
          </MultiMeterBarChart>
          <Text textStyle="small">
            {k.open.length === 0 ? "All clear" : PRIORITIES.map((p) => `${p} ${k.byPriority[p]}`).join(" · ")}
          </Text>
        </Flex>
      </Tile>
    </Grid>
  );
};
