import React, { useMemo } from "react";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import type { GanttSegmentData } from "@dynatrace/strato-components/charts";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Schedule } from "../domain/contracts";
import { layerTimeline, scheduleTimeline, type ShiftSegment } from "../hooks/domain";
import { useAppData } from "../hooks/AppDataContext";
import { formatDayTime, formatDuration, zoneAbbr } from "./format";

export type SegmentKind = "Shift" | "Override" | "Gap";

export interface GanttSeg extends GanttSegmentData {
  name: string;
  kind: SegmentKind;
  start: number;
  end: number;
  timeZone: string;
}

interface GanttRow {
  id: string;
  who: string;
  shifts: GanttSeg[];
  subRows?: GanttRow[];
}

/** Uncovered intervals of [from, to) given covering segments. */
export function gapsOf(segs: { from: number; to: number }[], from: number, to: number): { from: number; to: number }[] {
  const sorted = [...segs].sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  let cursor = from;
  for (const s of sorted) {
    if (s.from > cursor) out.push({ from: cursor, to: Math.min(s.from, to) });
    cursor = Math.max(cursor, s.to);
    if (cursor >= to) break;
  }
  if (cursor < to) out.push({ from: cursor, to });
  return out.filter((g) => g.to - g.from > 60_000);
}

export function coverage(schedule: Schedule, from: number, to: number): { pct: number; gaps: { from: number; to: number }[] } {
  const segs = scheduleTimeline(schedule, from, to);
  const gaps = gapsOf(segs, from, to);
  const uncovered = gaps.reduce((a, g) => a + (g.to - g.from), 0);
  return { pct: Math.round((1 - uncovered / (to - from)) * 1000) / 10, gaps };
}

const PALETTE: Record<SegmentKind, string> = {
  Shift: Colors.Charts.Status.Good.Default,
  Override: Colors.Charts.Categorical.Color05.Default,
  Gap: Colors.Charts.Status.Warning.Default,
};

const ShiftTooltip = ({ seg }: { seg: GanttSegmentData }) => {
  const s = seg as GanttSeg;
  return (
    <Flex flexDirection="column" gap={2} padding={4}>
      <Text textStyle="base-emphasized">{s.kind === "Gap" ? "No one on call" : s.name}</Text>
      <Text textStyle="small">
        {formatDayTime(s.start, s.timeZone)} – {formatDayTime(s.end, s.timeZone)} {zoneAbbr(s.start, s.timeZone)} ({formatDuration(s.end - s.start)})
      </Text>
      {s.kind === "Override" && <Text textStyle="small">Override</Text>}
    </Flex>
  );
};

/**
 * Gantt of shifts (DESIGN §6.1): one row per schedule ("Final schedule": layers + overrides,
 * gaps in the warning color), sub-rows per layer. Segment start/end are epoch ms (U8).
 */
export const ShiftGantt = ({
  schedules,
  from,
  to,
  now,
  showLayers = true,
  draft = false,
}: {
  schedules: Schedule[];
  from: number;
  to: number;
  now: number;
  showLayers?: boolean;
  /** Editor preview: rows are the layers + final schedule of one schedule. */
  draft?: boolean;
}) => {
  const { userName } = useAppData();

  const rows = useMemo<GanttRow[]>(() => {
    const toSeg = (s: ShiftSegment, tz: string): GanttSeg => ({
      name: userName(s.uid),
      kind: s.source === "override" ? "Override" : "Shift",
      start: Math.max(from, s.from),
      end: Math.min(to, s.to),
      timeZone: tz,
    });
    const gapSegs = (segs: ShiftSegment[], tz: string): GanttSeg[] =>
      gapsOf(segs, from, to).map((g) => ({ name: "Gap", kind: "Gap", start: g.from, end: g.to, timeZone: tz }));

    return schedules.map((sch) => {
      let final: ShiftSegment[] = [];
      try {
        final = scheduleTimeline(sch, from, to);
      } catch {
        final = [];
      }
      const layers: GanttRow[] = sch.layers.map((l) => {
        let segs: ShiftSegment[] = [];
        try {
          segs = layerTimeline(sch, l.id, from, to);
        } catch {
          segs = [];
        }
        return { id: `${sch.id}:${l.id}`, who: l.name, shifts: segs.map((s) => toSeg(s, sch.timeZone)) };
      });
      const finalRow: GanttRow = {
        id: `${sch.id}:final`,
        who: draft ? "Final schedule" : sch.name,
        shifts: [...final.map((s) => toSeg(s, sch.timeZone)), ...gapSegs(final, sch.timeZone)],
      };
      if (draft) return { ...finalRow, subRows: layers };
      return showLayers ? { ...finalRow, subRows: layers } : finalRow;
    });
  }, [schedules, from, to, userName, showLayers, draft]);

  const data = draft && rows[0] ? [...(rows[0].subRows ?? []), { ...rows[0], subRows: undefined }] : rows;

  const columns = useMemo<DataTableColumnDef<GanttRow>[]>(
    () => [
      { id: "who", header: "Who", accessor: "who", width: 240 },
      {
        id: "shifts",
        header: "Shifts",
        accessor: "shifts",
        columnType: "gantt",
        width: "1fr",
        minWidth: 600,
        config: {
          xAxisType: "time",
          min: from,
          max: to,
          nameAccessor: "name",
          colorAccessor: "kind",
          colorPalette: PALETTE,
          showBackground: true,
          tooltip: (seg) => <ShiftTooltip seg={seg} />,
          annotationsHeader: {
            tracks: [{ markers: [{ title: "Now", start: now }] }],
          },
        },
      },
    ],
    [from, to, now],
  );

  return (
    <DataTable
      data={data}
      columns={columns}
      rowId={(r) => r.id}
      fullWidth
      subRows={!draft}
      defaultOpenSubRows={true}
      variant={{ verticalDividers: true, rowDensity: "condensed" }}
    />
  );
};
