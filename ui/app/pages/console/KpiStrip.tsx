import React, { useMemo } from "react";
import { Grid, Surface, Flex } from "@dynatrace/strato-components/layouts";
import { MeterBarChart, MultiMeterBarChart, Sparkline, type Timeseries } from "@dynatrace/strato-components/charts";
import { Skeleton } from "@dynatrace/strato-components/content";
import { Text } from "@dynatrace/strato-components/typography";
import {
  AccountIcon,
  CheckmarkIcon,
  ClockIcon,
  CriticalIcon,
  NotificationActiveIcon,
  StackedBarChartIcon,
} from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Typography from "@dynatrace/strato-design-tokens/typography";
import { PRIORITIES, type Incident, type Priority } from "../../domain/contracts";
import { PRIORITY_COLOR } from "../../components/PriorityChip";
import { formatDuration } from "../../components/format";
import type { ConsoleFilters } from "./filters";

const HOUR = 3_600_000;

function hourlyCreated(incidents: Incident[], now: number): Timeseries {
  const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  const buckets = Array.from({ length: 24 }, (_, i) => ({
    start: start + i * HOUR,
    value: 0,
  }));
  incidents.forEach((i) => {
    const idx = Math.floor((i.createdAt - start) / HOUR);
    if (idx >= 0 && idx < 24) buckets[idx].value++;
  });
  return {
    name: "Incidents created",
    datapoints: buckets.map((b) => ({
      start: new Date(b.start),
      end: new Date(b.start + HOUR),
      value: b.value,
    })),
  };
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Every tile has the same three rows: header (icon + label), value, footer. */
const VALUE_HEIGHT = 40;
const FOOTER_MIN_HEIGHT = 36;

/**
 * Tile title row rendered outside SingleValue: SingleValue sizes a ReactNode `prefixIcon` to 2ch (≈1.15 em) inside a
 * 1 em-high `overflow: hidden` value row, which clipped the icon top and bottom, and its auto-fitted label size
 * differed from tile to tile. A fixed 16 px icon and `Text` keep every tile title identical.
 */
const TileHeader = ({ icon, children }: { icon: React.ReactElement; children: React.ReactNode }) => (
  <Flex alignItems="center" gap={4}>
    {icon}
    <Text textStyle="base-emphasized">{children}</Text>
  </Flex>
);

const TileFooter = ({ children }: { children: React.ReactNode }) => (
  <Flex flexDirection="column" justifyContent="flex-end" gap={4} style={{ minHeight: FOOTER_MIN_HEIGHT }}>
    {children}
  </Flex>
);

/**
 * KPI number in the Heading Level 1 type tokens. Not `SingleValue`: its auto-fit sizes each tile's number from that
 * tile's own box and text length (measured 33/42/60 px side by side), so a strip of tiles never matched.
 */
const KpiValue = ({
  value,
  label,
  loading,
  color,
}: {
  value: string | number;
  label: string;
  loading: boolean;
  color?: string;
}) =>
  loading ? (
    <Skeleton width={64} height={VALUE_HEIGHT} />
  ) : (
    <Text
      aria-label={`${label}: ${value}`}
      style={{
        display: "block",
        fontFamily: Typography.Heading.Level1.Family,
        fontWeight: Typography.Heading.Level1.Weight,
        fontSize: Typography.Heading.Level1.Size,
        lineHeight: `${VALUE_HEIGHT}px`,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        ...(color ? { color } : {}),
      }}
    >
      {value}
    </Text>
  );

const Subdued = ({ children }: { children: React.ReactNode }) => (
  <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
    {children}
  </Text>
);

const Tile = ({
  label,
  onClick,
  header,
  value,
  footer,
}: {
  label: string;
  onClick?: () => void;
  header: React.ReactNode;
  value: React.ReactNode;
  footer: React.ReactNode;
}) => {
  const body = (
    <Flex flexDirection="column" gap={8}>
      {header}
      {value}
      <TileFooter>{footer}</TileFooter>
    </Flex>
  );
  return onClick ? (
    <Surface as="button" elevation="raised" padding={16} aria-label={label} onClick={onClick} style={{ textAlign: "start" }}>
      {body}
    </Surface>
  ) : (
    <Surface elevation="raised" padding={16} aria-label={label}>
      {body}
    </Surface>
  );
};

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
      incidents.filter((i) => i.acknowledgedAt && i.acknowledgedAt >= dayStart).map((i) => (i.acknowledgedAt ?? 0) - i.createdAt),
    );
    const ackLastHour = incidents.filter((i) => i.acknowledgedAt && i.acknowledgedAt >= now - HOUR).length;
    const ackPrevHour = incidents.filter(
      (i) => i.acknowledgedAt && i.acknowledgedAt >= now - 2 * HOUR && i.acknowledgedAt < now - HOUR,
    ).length;
    const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, open.filter((i) => i.priority === p).length])) as Record<
      Priority,
      number
    >;
    return {
      open,
      triggered,
      acknowledged,
      p1,
      mine,
      mtta,
      ackLastHour,
      ackPrevHour,
      byPriority,
      spark: hourlyCreated(incidents, now),
    };
  }, [incidents, now, me]);

  const trendDelta = k.ackLastHour - k.ackPrevHour;
  const mttaOver = k.mtta !== undefined && k.mtta > ackTargetMs;
  const p1Unacked = k.p1.filter((i) => i.status === "triggered").length;
  const mineTriggered = k.mine.filter((i) => i.status === "triggered").length;
  const critical = Colors.Text.Critical.Default;

  return (
    <Grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={12}>
      <Tile
        label="Show triggered incidents"
        onClick={() => onFilter({ status: ["triggered"] })}
        header={<TileHeader icon={<NotificationActiveIcon size="small" />}>Triggered</TileHeader>}
        value={<KpiValue value={k.triggered.length} label="Triggered" loading={loading} />}
        footer={
          <Sparkline
            data={k.spark}
            variant="area"
            color={Colors.Charts.Status.Critical.Default}
            height={FOOTER_MIN_HEIGHT}
            loading={loading}
            aria-label="Incidents created per hour, last 24 hours"
          />
        }
      />
      <Tile
        label="Show acknowledged incidents"
        onClick={() => onFilter({ status: ["acknowledged"] })}
        header={<TileHeader icon={<CheckmarkIcon size="small" />}>Acknowledged</TileHeader>}
        value={<KpiValue value={k.acknowledged.length} label="Acknowledged" loading={loading} />}
        footer={
          <Subdued>
            {trendDelta === 0
              ? "Same as previous hour"
              : `${trendDelta > 0 ? "+" : "−"}${Math.abs(trendDelta)} ${Math.abs(trendDelta) === 1 ? "ack" : "acks"} vs. previous hour`}
          </Subdued>
        }
      />
      <Tile
        label="Show open P1 incidents"
        onClick={() =>
          onFilter({
            status: ["triggered", "acknowledged", "snoozed"],
            priority: ["P1"],
          })
        }
        header={
          <TileHeader
            icon={<CriticalIcon size="small" style={k.p1.length > 0 ? { color: Colors.Icon.Critical.Default } : undefined} />}
          >
            Open P1
          </TileHeader>
        }
        value={<KpiValue value={k.p1.length} label="Open P1" loading={loading} color={k.p1.length > 0 ? critical : undefined} />}
        footer={
          <Subdued>
            {k.p1.length === 0 ? "All clear" : p1Unacked > 0 ? `${p1Unacked} not acknowledged` : "All acknowledged"}
          </Subdued>
        }
      />
      <Tile
        label="MTTA today"
        header={<TileHeader icon={<ClockIcon size="small" />}>MTTA today</TileHeader>}
        value={
          <KpiValue
            value={k.mtta === undefined ? "–" : formatDuration(k.mtta)}
            label="Median time to acknowledge today"
            loading={loading}
            color={mttaOver ? critical : undefined}
          />
        }
        footer={
          <>
            <MeterBarChart value={k.mtta ?? 0} min={0} max={ackTargetMs * 2} unit="millisecond" loading={loading} size="size8">
              <MeterBarChart.ThresholdIndicator value={ackTargetMs} color={Colors.Charts.Threshold.Bad.Default} name="Target" />
              <MeterBarChart.ColorRule
                comparator="greater-than"
                matchValue={ackTargetMs}
                color={Colors.Charts.Threshold.Bad.Default}
              />
              <MeterBarChart.ColorRule
                comparator="less-or-equal"
                matchValue={ackTargetMs}
                color={Colors.Charts.Threshold.Good.Default}
              />
            </MeterBarChart>
            <Subdued>Target {formatDuration(ackTargetMs)}</Subdued>
          </>
        }
      />
      <Tile
        label="Show incidents assigned to me"
        onClick={() => onFilter({ assignee: ["me"] })}
        header={<TileHeader icon={<AccountIcon size="small" />}>Assigned to me</TileHeader>}
        value={<KpiValue value={k.mine.length} label="Assigned to me" loading={loading} />}
        footer={<Subdued>{k.mine.length === 0 ? "Nothing assigned to you" : `${mineTriggered} not acknowledged`}</Subdued>}
      />
      <Tile
        label="Open incidents by priority"
        header={<TileHeader icon={<StackedBarChartIcon size="small" />}>Open incidents</TileHeader>}
        value={<KpiValue value={k.open.length} label="Open incidents" loading={loading} />}
        footer={
          <>
            <MultiMeterBarChart loading={loading} max="auto" size="size8">
              {PRIORITIES.map((p) => (
                <MultiMeterBarChart.Segment key={p} name={p} value={k.byPriority[p]} color={PRIORITY_COLOR[p]} />
              ))}
            </MultiMeterBarChart>
            <Subdued>{k.open.length === 0 ? "All clear" : PRIORITIES.map((p) => `${p} ${k.byPriority[p]}`).join(" · ")}</Subdued>
          </>
        }
      />
    </Grid>
  );
};
