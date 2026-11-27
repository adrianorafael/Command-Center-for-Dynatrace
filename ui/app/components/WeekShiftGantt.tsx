/**
 * Week view of on-call shifts (On-call → Now → "Upcoming shifts").
 *
 * One row per schedule shows the final schedule (layers + overrides) with the on-call person's
 * name inside each bar and gaps marked; expanding a row lists one row per person with only
 * their shifts. Columns are the days of one calendar week in the display time zone.
 *
 * Why not the Strato `gantt` column type used by `ShiftGantt`: it has no labels inside the
 * segments, formats its axis in the platform zone rather than the app's display zone, and a
 * continuous time axis cannot show day columns of equal width. The bars here are positioned
 * with the pure helpers in `domain/time/week.ts`; the table, expansion, tooltips and colours
 * are all Strato (DataTable, Tooltip, design tokens).
 */
import React, { useMemo } from "react";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Schedule } from "../domain/contracts";
import { daysRange, isInDays, onCallHoursByUser, placeSpan, positionIn, scheduleTimeline, type ShiftSegment, type WeekDay } from "../hooks/domain";
import { useAppData } from "../hooks/AppDataContext";
import { gapsOf } from "./ShiftGantt";
import { formatDayTime, formatDuration, formatTime, plural, zoneAbbr } from "./format";

/** A bar in a week row: a rotation shift, an override, or a gap (nobody on call). */
interface WeekBar {
  kind: "shift" | "override" | "gap";
  from: number;
  to: number;
  /** Person on call; undefined for gaps. */
  uid?: string;
  /** Layer that produced a rotation shift (for the tooltip). */
  layerName?: string;
}

interface WeekRow {
  id: string;
  /** Text shown in the first column, also used for sorting and aria labels. */
  who: string;
  /** Second line under `who`. */
  detail?: string;
  bars: WeekBar[];
  subRows?: WeekRow[];
}

const BAR_STYLE: Record<WeekBar["kind"], React.CSSProperties> = {
  shift: {
    background: Colors.Background.Container.Primary.Emphasized,
    color: Colors.Text.Primary.Default,
    borderLeft: `3px solid ${Colors.Border.Primary.Accent}`,
  },
  // Overrides differ by more than colour (WCAG 1.4.1): dashed outline and the word "override".
  override: {
    background: Colors.Background.Container.Success.Emphasized,
    color: Colors.Text.Success.Default,
    border: `1px dashed ${Colors.Border.Success.Accent}`,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
  },
  gap: {
    background: `repeating-linear-gradient(135deg, ${Colors.Background.Container.Warning.Emphasized} 0 6px, ${Colors.Background.Container.Warning.Default} 6px 12px)`,
    color: Colors.Text.Warning.Default,
    border: `1px solid ${Colors.Border.Warning.Accent}`,
  },
};

const TRACK_HEIGHT = 28;

/** Header of the week column: one equal-width label per visible day; today is emphasised. */
const DayHeader = ({ days, today }: { days: WeekDay[]; today?: string }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, width: "100%" }}>
    {days.map((d) => {
      const isToday = d.key === today;
      // Format from the civil date at noon UTC so the label never depends on the browser zone.
      const at = Date.UTC(d.date.year, d.date.month - 1, d.date.day, 12);
      const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(at);
      const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(at);
      return (
        <Flex key={d.key} flexDirection="column" gap={0} paddingLeft={6} style={{ minWidth: 0 }}>
          <Text textStyle={isToday ? "small-emphasized" : "small"} style={{ color: isToday ? Colors.Text.Primary.Default : Colors.Text.Neutral.Subdued }}>
            {weekday}
            {isToday ? " · Today" : ""}
          </Text>
          <Text textStyle={isToday ? "base-emphasized" : "base"} style={{ color: isToday ? Colors.Text.Primary.Default : undefined, whiteSpace: "nowrap" }}>
            {date}
          </Text>
        </Flex>
      );
    })}
  </div>
);

/** Tooltip body for a bar: who, what, and the exact interval in the display zone. */
const BarTooltip = ({ bar, name, tz }: { bar: WeekBar; name: string; tz: string }) => (
  <Flex flexDirection="column" gap={2}>
    <Text textStyle="base-emphasized">{bar.kind === "gap" ? "No one on call" : name}</Text>
    <Text textStyle="small">
      {formatDayTime(bar.from, tz)} – {formatDayTime(bar.to, tz)} {zoneAbbr(bar.from, tz)} ({formatDuration(bar.to - bar.from)})
    </Text>
    {bar.kind === "override" && <Text textStyle="small">Override</Text>}
    {bar.kind === "shift" && bar.layerName && <Text textStyle="small">Layer: {bar.layerName}</Text>}
  </Flex>
);

/** Text inside a bar; overflow is cut with an ellipsis, the tooltip always has the full text. */
function barLabel(bar: WeekBar, name: string, showNames: boolean, tz: string): string {
  if (bar.kind === "gap") return "No one on call";
  // A person row already says who it is, so its bars show the hours instead of the name.
  const text = showNames ? name : `${formatTime(bar.from, tz)}–${formatTime(bar.to, tz)}`;
  return bar.kind === "override" ? `${text} · override` : text;
}

/** The week track of one row: day grid, today's column, the bars and the "Now" line. */
const WeekTrack = ({
  bars,
  days,
  today,
  now,
  tz,
  showNames,
}: {
  bars: WeekBar[];
  days: WeekDay[];
  today?: string;
  now: number;
  tz: string;
  showNames: boolean;
}) => {
  const { userName } = useAppData();
  const n = days.length;
  const todayIdx = days.findIndex((d) => d.key === today);
  return (
    <div style={{ position: "relative", height: TRACK_HEIGHT, width: "100%" }}>
      {todayIdx >= 0 && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -8,
            bottom: -8,
            left: `${(todayIdx / n) * 100}%`,
            width: `${100 / n}%`,
            background: Colors.Background.Container.Primary.Default,
          }}
        />
      )}
      {days.slice(1).map((d, i) => (
        <div
          key={d.key}
          aria-hidden
          style={{ position: "absolute", top: -8, bottom: -8, left: `${((i + 1) / n) * 100}%`, borderLeft: `1px solid ${Colors.Border.Neutral.Default}` }}
        />
      ))}
      {bars.map((bar) => {
        const span = placeSpan(bar.from, bar.to, days);
        if (!span) return null;
        const name = bar.uid ? userName(bar.uid) : "";
        const label = barLabel(bar, name, showNames, tz);
        const aria = `${bar.kind === "gap" ? "No one on call" : name}${bar.kind === "override" ? " (override)" : ""}, ${formatDayTime(bar.from, tz)} to ${formatDayTime(bar.to, tz)}`;
        return (
          <Tooltip key={`${bar.kind}-${bar.from}`} text={<BarTooltip bar={bar} name={name} tz={tz} />}>
            <div
              role="img"
              aria-label={aria}
              tabIndex={0}
              style={{
                position: "absolute",
                top: 2,
                bottom: 2,
                // 1 px inset on each side keeps back-to-back handoffs visibly separate.
                left: `calc(${span.left * 100}% + 1px)`,
                width: `max(2px, calc(${span.width * 100}% - 2px))`,
                boxSizing: "border-box",
                borderRadius: 4,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                paddingInline: 6,
                ...BAR_STYLE[bar.kind],
              }}
            >
              <Text textStyle="small-emphasized" style={{ color: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {label}
              </Text>
            </div>
          </Tooltip>
        );
      })}
      {isInDays(now, days) && (
        <div
          aria-label="Now"
          style={{
            position: "absolute",
            top: -8,
            bottom: -8,
            left: `${positionIn(now, days) * 100}%`,
            borderLeft: `2px solid ${Colors.Border.Critical.Accent}`,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
};

/** Legend under the chart: what the bar styles mean (also explained without colour by their labels). */
export const WeekShiftLegend = () => (
  <Flex gap={16} flexWrap="wrap" alignItems="center">
    {(
      [
        ["shift", "Shift"],
        ["override", "Override (dashed)"],
        ["gap", "No one on call"],
      ] as const
    ).map(([kind, text]) => (
      <Flex key={kind} gap={6} alignItems="center">
        <span aria-hidden style={{ display: "inline-block", width: 24, height: 12, borderRadius: 3, boxSizing: "border-box", ...BAR_STYLE[kind] }} />
        <Text textStyle="small">{text}</Text>
      </Flex>
    ))}
    <Flex gap={6} alignItems="center">
      <span aria-hidden style={{ display: "inline-block", width: 0, height: 14, borderLeft: `2px solid ${Colors.Border.Critical.Accent}` }} />
      <Text textStyle="small">Now</Text>
    </Flex>
  </Flex>
);

/**
 * Shifts of `schedules` over the visible `days` of one week (see the module header).
 * `openRows` / `onOpenRowsChange` control which schedules are expanded to one row per person.
 */
export const WeekShiftGantt = ({
  schedules,
  days,
  today,
  now,
  timeZone,
  openRows,
  onOpenRowsChange,
}: {
  schedules: Schedule[];
  /** Visible day columns, from `weekDays()`. */
  days: WeekDay[];
  /** Key ("YYYY-MM-DD") of today in the display zone, to highlight its column. */
  today?: string;
  now: number;
  /** Display time zone (settings.ui.timeZone) used for tooltips; `days` must be in the same zone. */
  timeZone: string;
  openRows: Record<string, boolean>;
  onOpenRowsChange: (open: Record<string, boolean>) => void;
}) => {
  const { data, userName } = useAppData();
  const { from, to } = daysRange(days);

  // Depends on the range and the schedules only: `now` moves the marker, not the bars.
  const rows = useMemo<WeekRow[]>(() => {
    if (!(to > from)) return [];
    return schedules.map((sch) => {
      let final: ShiftSegment[] = [];
      try {
        final = scheduleTimeline(sch, from, to);
      } catch {
        final = [];
      }
      const layerName = (id?: string) => sch.layers.find((l) => l.id === id)?.name;
      const toBar = (s: ShiftSegment): WeekBar => ({
        kind: s.source === "override" ? "override" : "shift",
        from: s.from,
        to: s.to,
        uid: s.uid,
        layerName: layerName(s.layerId),
      });
      const gaps: WeekBar[] = gapsOf(final, from, to).map((g) => ({ kind: "gap", from: g.from, to: g.to }));
      const hours = onCallHoursByUser(sch, from, to);

      // People: everyone on call this week (first shift first), then rotation members who are not.
      const order: string[] = [];
      for (const s of final) if (!order.includes(s.uid)) order.push(s.uid);
      for (const l of sch.layers) for (const p of l.participants) if (!order.includes(p)) order.push(p);
      const people: WeekRow[] = order.map((uid) => {
        const h = Math.round((hours[uid] ?? 0) * 10) / 10;
        return {
          id: `${sch.id}:${uid}`,
          who: userName(uid),
          detail: h > 0 ? `${h} h on call` : "Not on call",
          bars: final.filter((s) => s.uid === uid).map(toBar),
        };
      });
      const team = data?.teams.find((t) => t.id === sch.teamId)?.name;
      return {
        id: sch.id,
        who: team ?? sch.name,
        detail: `${team ? `${sch.name} · ` : ""}${plural(people.length, "person", "people")}`,
        bars: [...final.map(toBar), ...gaps].sort((a, b) => a.from - b.from),
        subRows: people,
      };
    });
  }, [schedules, from, to, userName, data?.teams]);

  const columns = useMemo<DataTableColumnDef<WeekRow>[]>(
    () => [
      {
        id: "who",
        header: "Schedule / person",
        accessor: "who",
        width: 240,
        cell: ({ rowData }) => (
          <Flex flexDirection="column" gap={0} style={{ minWidth: 0 }}>
            <Text textStyle={rowData.subRows ? "base-emphasized" : "base"} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {rowData.who}
            </Text>
            {rowData.detail && (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {rowData.detail}
              </Text>
            )}
          </Flex>
        ),
      },
      {
        id: "week",
        label: "Week",
        header: () => <DayHeader days={days} today={today} />,
        accessor: "bars",
        width: "1fr",
        minWidth: 640,
        cell: ({ rowData }) => (
          <WeekTrack bars={rowData.bars} days={days} today={today} now={now} tz={timeZone} showNames={!!rowData.subRows} />
        ),
      },
    ],
    [days, today, now, timeZone],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      rowId={(r) => r.id}
      fullWidth
      subRows
      openSubRows={openRows}
      onOpenSubRowsChange={onOpenRowsChange}
      variant={{ verticalDividers: true, rowDensity: "default", verticalAlignment: "center" }}
    >
      <DataTable.EmptyState>
        <Text>No schedules match the filter.</Text>
      </DataTable.EmptyState>
    </DataTable>
  );
};
